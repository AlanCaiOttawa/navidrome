package server

// Per-playlist ordering rules. These rules never create playlists or change song tags.
// Scheduled jobs run after the existing nightly M3U sync; file-backed playlists
// are exported with an M3U backup only when the source and DB are in agreement.
import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type experimentalPlaylistSortRule struct {
	Enabled bool   `json:"enabled"`
	By      string `json:"by"`
}
type experimentalPlaylistSortEntry struct {
	ID       string                       `json:"id"`
	Name     string                       `json:"name"`
	Count    int                          `json:"count"`
	Editable bool                         `json:"editable"`
	Reason   string                       `json:"reason,omitempty"`
	Rule     experimentalPlaylistSortRule `json:"rule"`
}

func experimentalPlaylistSortPath() string {
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", "playlist-sort.json")
}
func loadExperimentalPlaylistSort() (map[string]experimentalPlaylistSortRule, error) {
	b, err := os.ReadFile(experimentalPlaylistSortPath())
	if os.IsNotExist(err) {
		return map[string]experimentalPlaylistSortRule{}, nil
	}
	if err != nil {
		return nil, err
	}
	var data map[string]experimentalPlaylistSortRule
	if err = json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	if data == nil {
		data = map[string]experimentalPlaylistSortRule{}
	}
	return data, nil
}
func saveExperimentalPlaylistSort(data map[string]experimentalPlaylistSortRule) error {
	p := experimentalPlaylistSortPath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return atomicExperimentalWrite(p, b)
}
func validateExperimentalSortBy(by string) bool {
	return by == "title" || by == "artist" || by == "album"
}

func (s *Server) experimentalPlaylistSortSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	if !user.IsAdmin {
		http.Error(w, "administrator required", 403)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	rules, err := loadExperimentalPlaylistSort()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if r.Method == http.MethodPut {
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		var body struct {
			PlaylistID string `json:"playlistId"`
			Enabled    bool   `json:"enabled"`
			By         string `json:"by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON", 400)
			return
		}
		if !validateExperimentalSortBy(body.By) {
			http.Error(w, "invalid sorting criterion", 400)
			return
		}
		pl, err := s.ds.Playlist().Get(r.Context(), body.PlaylistID)
		if err != nil || pl == nil {
			http.Error(w, "playlist not found", 404)
			return
		}
		if body.Enabled && !pl.TracksEditable() {
			http.Error(w, "smart or auto-import playlist is read-only", 400)
			return
		}
		rules[pl.ID] = experimentalPlaylistSortRule{Enabled: body.Enabled, By: body.By}
		if err := saveExperimentalPlaylistSort(rules); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	all, err := s.ds.Playlist().GetAll(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	entries := make([]experimentalPlaylistSortEntry, 0, len(all))
	for _, pl := range all {
		rule := rules[pl.ID]
		if !validateExperimentalSortBy(rule.By) {
			rule.By = "title"
		}
		entry := experimentalPlaylistSortEntry{ID: pl.ID, Name: pl.Name, Count: pl.SongCount, Editable: pl.TracksEditable(), Rule: rule}
		if !entry.Editable {
			entry.Reason = "Smart playlist or native auto-import: editing is locked"
		}
		entries = append(entries, entry)
	}
	experimentalRespond(w, 200, map[string]any{"playlists": entries})
}

// Locale-aware comparison keeps Chinese names in a natural collation rather than byte order.
func sortExperimentalTracks(tracks model.PlaylistTracks, by string) model.PlaylistTracks {
	result := slices.Clone(tracks)
	c := collate.New(language.MustParse("zh-u-co-pinyin"))
	value := func(t model.PlaylistTrack) string {
		switch by {
		case "artist":
			return t.MediaFile.Artist
		case "album":
			return t.MediaFile.Album
		default:
			return t.MediaFile.Title
		}
	}
	slices.SortStableFunc(result, func(a, b model.PlaylistTrack) int {
		x, y := strings.TrimSpace(value(a)), strings.TrimSpace(value(b))
		if n := c.CompareString(x, y); n != 0 {
			return n
		}
		return 0
	})
	return result
}

func (s *Server) sortExperimentalPlaylist(ctx context.Context, id string, by string) (string, error) {
	if !validateExperimentalSortBy(by) {
		return "", fmt.Errorf("invalid criterion")
	}
	pl, err := s.ds.Playlist().GetWithTracks(ctx, id, false, false)
	if err != nil || pl == nil {
		return "", fmt.Errorf("playlist unavailable: %w", err)
	}
	if !pl.TracksEditable() {
		return "", fmt.Errorf("smart or native auto-import playlist cannot be sorted")
	}
	if len(pl.Tracks) < 2 {
		return "already-short", nil
	}
	sorted := sortExperimentalTracks(pl.Tracks, by)
	unchanged := true
	for i := range sorted {
		if sorted[i].MediaFileID != pl.Tracks[i].MediaFileID {
			unchanged = false
			break
		}
	}
	if unchanged {
		return "already-sorted", nil
	}

	// File-backed playlists must not have concurrent/out-of-sync changes. The
	// sync inspector enforces writable-root, path and M3U security checks.
	var before *syncInspection
	if pl.Path != "" {
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", pl.ID)
		ownerCtx := request.WithUser(ctx, model.User{ID: pl.OwnerID, IsAdmin: true})
		ownerCtx = context.WithValue(ownerCtx, chi.RouteCtxKey, rc)
		req, _ := http.NewRequestWithContext(ownerCtx, http.MethodGet, "/internal/sync", nil)
		before, err = s.syncInspect(req)
		if err != nil {
			return "", fmt.Errorf("M3U validation: %w", err)
		}
		if before.Status != "already-equal" && before.Status != "initialize" {
			return "", fmt.Errorf("M3U is not synchronized (%s); resolve in Playlist Setting first", before.Status)
		}
	}
	original := slices.Clone(pl.Tracks)
	pl.SetTracks(sorted)
	if err := s.ds.Playlist().Put(ctx, pl); err != nil {
		return "", err
	}
	if before != nil {
		// Build fresh inspector after DB reorder so the export uses the new order.
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", pl.ID)
		ownerCtx := request.WithUser(ctx, model.User{ID: pl.OwnerID, IsAdmin: true})
		ownerCtx = context.WithValue(ownerCtx, chi.RouteCtxKey, rc)
		req, _ := http.NewRequestWithContext(ownerCtx, http.MethodGet, "/internal/sync", nil)
		after, inspectErr := s.syncInspect(req)
		if inspectErr == nil && after.Status != "export-nav" {
			inspectErr = fmt.Errorf("unexpected post-sort status: %s", after.Status)
		}
		if inspectErr == nil {
			inspectErr = s.syncExport(after)
		}
		if inspectErr != nil {
			// Best-effort restoration on writeback failure. The M3U backup remains
			// available if the file write succeeded but saving the baseline failed.
			pl.SetTracks(original)
			if rollbackErr := s.ds.Playlist().Put(ctx, pl); rollbackErr != nil {
				return "", fmt.Errorf("writeback failed: %v; rollback failed: %v", inspectErr, rollbackErr)
			}
			return "", fmt.Errorf("writeback failed, playlist order restored: %w", inspectErr)
		}
		return "sorted-and-exported", nil
	}
	return "sorted", nil
}

func (s *Server) experimentalPlaylistSortNow(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	if !user.IsAdmin {
		http.Error(w, "administrator required", 403)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	id := chi.URLParam(r, "id")
	rules, err := loadExperimentalPlaylistSort()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	rule, ok := rules[id]
	if !ok || !rule.Enabled || !validateExperimentalSortBy(rule.By) {
		http.Error(w, "enable and save an auto-sort rule first", 400)
		return
	}
	result, err := s.sortExperimentalPlaylist(r.Context(), id, rule.By)
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	experimentalRespond(w, 200, map[string]any{"status": result})
}

func (s *Server) runExperimentalPlaylistSorts(ctx context.Context, run *experimentalSyncRun) {
	rules, err := loadExperimentalPlaylistSort()
	if err != nil {
		run.Skipped++
		run.Outcomes = append(run.Outcomes, experimentalSyncOutcome{Action: "sort-error", Detail: err.Error()})
		return
	}
	for id, rule := range rules {
		if ctx.Err() != nil {
			return
		}
		if !rule.Enabled || !validateExperimentalSortBy(rule.By) {
			continue
		}
		action, err := s.sortExperimentalPlaylist(ctx, id, rule.By)
		outcome := experimentalSyncOutcome{FileName: id, Action: "playlist-sort"}
		if err != nil {
			run.Skipped++
			outcome.Action = "sort-skipped"
			outcome.Detail = err.Error()
		} else {
			run.Applied++
			outcome.Detail = action + " by " + rule.By
		}
		run.Outcomes = append(run.Outcomes, outcome)
		_ = saveExperimentalRun(*run)
	}
}

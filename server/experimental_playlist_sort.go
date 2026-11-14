package server

// Per-playlist ordering rules. These rules never create playlists or change song tags.
// Scheduled jobs run after the existing nightly M3U sync; file-backed playlists
// are exported with an M3U backup only when the source and DB are in agreement.
import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type experimentalPlaylistSortRule struct {
	Enabled   bool   `json:"enabled"`
	By        string `json:"by"`
	Direction string `json:"direction"`
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
func validateExperimentalSortDirection(direction string) bool {
	return direction == "asc" || direction == "desc"
}
func normalizedExperimentalDirection(direction string) string {
	if direction == "desc" {
		return "desc"
	}
	return "asc"
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
			Direction  string `json:"direction"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON", 400)
			return
		}
		if body.Direction == "" {
			body.Direction = "asc"
		}
		if !validateExperimentalSortDirection(body.Direction) {
			http.Error(w, "invalid direction", 400)
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
		rules[pl.ID] = experimentalPlaylistSortRule{Enabled: body.Enabled, By: body.By, Direction: body.Direction}
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
		if !validateExperimentalSortDirection(rule.Direction) {
			rule.Direction = "asc"
		}
		entry := experimentalPlaylistSortEntry{ID: pl.ID, Name: pl.Name, Count: pl.SongCount, Editable: pl.TracksEditable(), Rule: rule}
		if !entry.Editable {
			entry.Reason = "Smart playlist or native auto-import: editing is locked"
		}
		entries = append(entries, entry)
	}
	experimentalRespond(w, 200, map[string]any{"playlists": entries})
}

// The same comprehensive Han-to-pinyin dictionary used by the Catalogue UI.
//
//go:embed experimental_han_pinyin.json
var experimentalHanPinyinJSON []byte
var experimentalPinyinOnce sync.Once
var experimentalPinyinMap map[string]string

func experimentalPinyinKey(raw string) string {
	experimentalPinyinOnce.Do(func() {
		if err := json.Unmarshal(experimentalHanPinyinJSON, &experimentalPinyinMap); err != nil {
			experimentalPinyinMap = map[string]string{}
		}
	})
	var sb strings.Builder
	for _, char := range strings.TrimSpace(raw) {
		if p, ok := experimentalPinyinMap[string(char)]; ok {
			sb.WriteString(p)
		} else {
			sb.WriteRune(unicode.ToLower(char))
		}
	}
	return sb.String()
}

// Stable sort of the ENTIRE playlist, using the same Han-to-pinyin dictionary as
// album collections. New tracks are not treated specially or left at the tail.
func sortExperimentalTracks(tracks model.PlaylistTracks, by, direction string) model.PlaylistTracks {
	result := slices.Clone(tracks)
	c := collate.New(language.English, collate.Numeric, collate.IgnoreCase)
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
		n := c.CompareString(experimentalPinyinKey(value(a)), experimentalPinyinKey(value(b)))
		if direction == "desc" {
			return -n
		}
		return n
	})
	return result
}

// Compare the actual persisted sequence (not the old client-side list or a
// single page). Compare IDs at each position to preserve duplicate songs.
func verifyExperimentalPlaylistOrder(expected, actual model.PlaylistTracks) error {
	if len(actual) != len(expected) {
		return fmt.Errorf("expected %d tracks, found %d", len(expected), len(actual))
	}
	for i := range expected {
		if expected[i].MediaFileID != actual[i].MediaFileID {
			return fmt.Errorf("track %d is not in the requested position", i+1)
		}
	}
	return nil
}

func (s *Server) sortExperimentalPlaylist(ctx context.Context, id string, by string, direction string) (string, error) {
	if !validateExperimentalSortBy(by) || !validateExperimentalSortDirection(direction) {
		return "", fmt.Errorf("invalid sorting rule")
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
	sorted := sortExperimentalTracks(pl.Tracks, by, direction)
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
	// A successful Put must actually persist the requested position of EVERY
	// track, including tracks at the end of a paginated playlist. Do not report
	// success just because the in-memory slice was sorted.
	persisted, readErr := s.ds.Playlist().GetWithTracks(ctx, id, false, false)
	if readErr != nil || persisted == nil {
		return "", fmt.Errorf("playlist sort saved but verification read failed: %v", readErr)
	}
	if err := verifyExperimentalPlaylistOrder(sorted, persisted.Tracks); err != nil {
		return "", fmt.Errorf("playlist sort verification failed: %w", err)
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
	result, err := s.sortExperimentalPlaylist(r.Context(), id, rule.By, normalizedExperimentalDirection(rule.Direction))
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	// Return read-back evidence for the user-facing Sort Now action. In
	// particular, this makes a stale playlist page distinguishable from a
	// server-side ordering problem.
	verified, err := s.ds.Playlist().GetWithTracks(r.Context(), id, false, false)
	if err != nil || verified == nil {
		http.Error(w, fmt.Sprintf("sort completed but verification read failed: %v", err), 500)
		return
	}
	first, last := "", ""
	if len(verified.Tracks) > 0 {
		first = experimentalPinyinKey(verified.Tracks[0].MediaFile.Artist)
		last = experimentalPinyinKey(verified.Tracks[len(verified.Tracks)-1].MediaFile.Artist)
	}
	experimentalRespond(w, 200, map[string]any{"status": result, "verified": true, "trackCount": len(verified.Tracks), "firstArtistKey": first, "lastArtistKey": last})
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
		action, err := s.sortExperimentalPlaylist(ctx, id, rule.By, normalizedExperimentalDirection(rule.Direction))
		outcome := experimentalSyncOutcome{FileName: id, Action: "playlist-sort"}
		if err != nil {
			run.Skipped++
			outcome.Action = "sort-skipped"
			outcome.Detail = err.Error()
		} else {
			run.Applied++
			outcome.Detail = action + " by " + rule.By + " (" + normalizedExperimentalDirection(rule.Direction) + ")"
		}
		run.Outcomes = append(run.Outcomes, outcome)
		_ = saveExperimentalRun(*run)
	}
}

// Apply one shared rule to all editable playlists. Per-playlist overrides remain
// available through the existing single-rule endpoint. Never affect smart or
// locked auto-import playlists.
func (s *Server) experimentalPlaylistSortBulk(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !user.IsAdmin {
		http.Error(w, "administrator required", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var req struct {
		Enabled   bool   `json:"enabled"`
		By        string `json:"by"`
		Direction string `json:"direction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", 400)
		return
	}
	if !validateExperimentalSortBy(req.By) || !validateExperimentalSortDirection(req.Direction) {
		http.Error(w, "invalid bulk sorting rule", 400)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	playlists, err := s.ds.Playlist().GetAll(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	rules, err := loadExperimentalPlaylistSort()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	updated, skipped := 0, 0
	for _, pl := range playlists {
		if !pl.TracksEditable() {
			skipped++
			continue
		}
		rules[pl.ID] = experimentalPlaylistSortRule{Enabled: req.Enabled, By: req.By, Direction: req.Direction}
		updated++
	}
	if err := saveExperimentalPlaylistSort(rules); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"updated": updated, "skipped": skipped})
}

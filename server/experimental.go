package server

// Experimental per-user album collections and playback-context history.
// The data is intentionally kept separate from the Navidrome database so that
// testing does not mutate an existing installation's core schema.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

type experimentalCollection struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Albums []string `json:"albums"`
}
type experimentalPosition struct {
	Type       string    `json:"type"`
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	TrackID    string    `json:"trackId"`
	Seconds    float64   `json:"seconds"`
	Duration   float64   `json:"duration"`
	UpdatedAt  time.Time `json:"updatedAt"`
	RecordedAt time.Time `json:"recordedAt,omitempty"`
}
type experimentalRecentSong struct {
	ID       string    `json:"id"`
	Pinned   bool      `json:"pinned"`
	PlayedAt time.Time `json:"playedAt"`
}
type experimentalCatalogueArtist struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Count     int      `json:"count"`
	ArtistIDs []string `json:"artistIds"`
}
type experimentalState struct {
	RecentSongs     []experimentalRecentSong      `json:"recentSongs"`
	Collections     []experimentalCollection      `json:"collections"`
	Progress        []experimentalPosition        `json:"progress"`
	CatalogueOrders map[string][]string           `json:"catalogueOrders"`
	CataloguePins   []string                      `json:"cataloguePins"`
	CatalogueIndex  []experimentalCatalogueArtist `json:"catalogueIndex"`
}

var experimentalMu sync.Mutex

// playlistFolderSetting is global: the NAS folder is selected by an administrator.
// The directory must already be present under the container's mounted music root.
type playlistFolderSetting struct {
	Folder string `json:"folder"`
}

func playlistFolderSettingFile() string {
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", "playlist-folder.json")
}
func normalizedPlaylistFolder(folder string) (string, error) {
	folder = filepath.ToSlash(strings.TrimSpace(folder))
	if folder == "" || path.IsAbs(folder) || strings.Contains(folder, "\\") {
		return "", fmt.Errorf("enter a folder relative to the music library")
	}
	clean := path.Clean(folder)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.ContainsAny(clean, "*?[]") {
		return "", fmt.Errorf("invalid folder")
	}
	music := conf.Server.MusicFolder
	root, err := filepath.EvalSymlinks(music)
	if err != nil {
		return "", fmt.Errorf("music root unavailable: %w", err)
	}
	candidate, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(clean)))
	if err != nil {
		return "", fmt.Errorf("playlist folder unavailable: %w", err)
	}
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("folder outside music root")
	}
	info, err := os.Stat(candidate)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("not a directory")
	}
	return filepath.ToSlash(rel), nil
}

// LoadExperimentalPlaylistFolder is called once before scanning starts.
// Settings take effect on the next Navidrome restart, preventing live scanner races.
func LoadExperimentalPlaylistFolder() error {
	b, err := os.ReadFile(playlistFolderSettingFile())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var settings playlistFolderSetting
	if err := json.Unmarshal(b, &settings); err != nil {
		return err
	}
	folder, err := normalizedPlaylistFolder(settings.Folder)
	if err != nil {
		return err
	}
	conf.Server.PlaylistsPath = folder
	conf.Server.AutoImportPlaylists = true
	return nil
}
func (s *Server) experimentalPlaylistFolder(w http.ResponseWriter, req *http.Request) {
	user, ok := request.UserFrom(req.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	if !user.IsAdmin {
		http.Error(w, "administrator required", 403)
		return
	}
	switch req.Method {
	case http.MethodGet:
		var saved playlistFolderSetting
		b, err := os.ReadFile(playlistFolderSettingFile())
		if err == nil {
			_ = json.Unmarshal(b, &saved)
		} else if !errors.Is(err, os.ErrNotExist) {
			http.Error(w, "read failed", 500)
			return
		}
		experimentalRespond(w, 200, map[string]any{"folder": saved.Folder, "activeFolder": conf.Server.PlaylistsPath, "restartRequired": saved.Folder != "" && saved.Folder != conf.Server.PlaylistsPath})
	case http.MethodPut:
		req.Body = http.MaxBytesReader(w, req.Body, 4096)
		var selected playlistFolderSetting
		if err := json.NewDecoder(req.Body).Decode(&selected); err != nil {
			http.Error(w, "invalid JSON", 400)
			return
		}
		folder, err := normalizedPlaylistFolder(selected.Folder)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		experimentalMu.Lock()
		defer experimentalMu.Unlock()
		file := playlistFolderSettingFile()
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			http.Error(w, "create settings folder failed", 500)
			return
		}
		settings, _ := json.Marshal(playlistFolderSetting{Folder: folder})
		if err := os.WriteFile(file, settings, 0600); err != nil {
			http.Error(w, "save failed", 500)
			return
		}
		experimentalRespond(w, 200, map[string]any{"folder": folder, "activeFolder": conf.Server.PlaylistsPath, "restartRequired": true})
	}
}

func experimentalFile(userID string) string {
	hash := sha256.Sum256([]byte(userID))
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", hex.EncodeToString(hash[:])+".json")
}
func readExperimental(file string) (experimentalState, error) {
	state := experimentalState{Collections: []experimentalCollection{}, Progress: []experimentalPosition{}, RecentSongs: []experimentalRecentSong{}, CatalogueOrders: map[string][]string{}, CataloguePins: []string{}}
	b, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err = json.Unmarshal(b, &state); err != nil {
		return state, err
	}
	if state.Collections == nil {
		state.Collections = []experimentalCollection{}
	}
	if state.Progress == nil {
		state.Progress = []experimentalPosition{}
	}
	if state.RecentSongs == nil {
		state.RecentSongs = []experimentalRecentSong{}
	}
	if state.CatalogueOrders == nil {
		state.CatalogueOrders = map[string][]string{}
	}
	if state.CataloguePins == nil {
		state.CataloguePins = []string{}
	}
	return state, nil
}
func writeExperimental(file string, state experimentalState) error {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), ".nd-state-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(payload); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), file)
}
func experimentalRespond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Server) mountExperimentalRoutes() {
	s.router.Group(func(r chi.Router) {
		r.Use(Authenticator(s.ds))
		r.Use(JWTRefresher)
		r.Route(path.Join("/", conf.Server.BasePath, "api/experimental"), func(r chi.Router) {
			r.Get("/playlist-folder", s.experimentalPlaylistFolder)
			r.Get("/collection-folders", s.experimentalCollectionFolders)
			r.Get("/collection-folder-tree", s.experimentalCollectionFolderTree)
			r.Get("/m3u-folder-status", s.experimentalM3UFolderStatus)
			r.Post("/m3u-folder-import", s.experimentalM3UImportOne)
			r.Post("/m3u-folder-delete-missing", s.experimentalM3UDeleteMissing)
			r.Get("/m3u-auto-schedule", s.experimentalScheduleSettings)
			r.Put("/m3u-auto-schedule", s.experimentalScheduleSettings)
			r.Get("/m3u-sync/{id}", s.experimentalSyncPreview)
			r.Post("/m3u-sync/{id}", s.experimentalSyncApply)
			r.Post("/m3u-sync/{id}/resolve", s.experimentalSyncResolve)
			r.Get("/m3u-sync-browse", s.experimentalSyncBrowse)
			r.Put("/playlist-folder", s.experimentalPlaylistFolder)
			r.Get("/m3u/{id}", s.experimentalM3UPreview)
			r.Post("/m3u/{id}", s.experimentalM3USave)
			r.Post("/recent-song", s.experimentalRecordSong)
			r.Put("/recent-song/{id}/pin", s.experimentalPinSong)
			r.Get("/song-editor/{id}", s.experimentalSongEditorInfo)
			r.Put("/song-editor/{id}/tags", s.experimentalSongEditTags)
			r.Get("/song-editor/{id}/covers", s.experimentalSongCoverFiles)
			r.Post("/song-editor/{id}/cover", s.experimentalSongCoverUpload)
			r.Post("/song-editor/{id}/cover-from-folder", s.experimentalSongCoverFromFolder)
			r.Delete("/song-editor/{id}/cover", s.experimentalSongCoverRemove)
			r.Put("/song-editor/{id}/playlists/{playlistId}", s.experimentalSongPlaylistAdd)
			r.Delete("/song-editor/{id}/playlists/{playlistId}", s.experimentalSongPlaylistRemove)
			r.Post("/catalogue-export-m3u", s.experimentalCatalogueM3U)
			r.Get("/state", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				state, err := readExperimental(experimentalFile(user.ID))
				if err != nil {
					http.Error(w, "cannot read state", 500)
					return
				}
				experimentalRespond(w, 200, state)
			})
			r.Put("/catalogue-index", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 4*1024*1024)
				var value struct {
					Artists []experimentalCatalogueArtist `json:"artists"`
				}
				if err := json.NewDecoder(req.Body).Decode(&value); err != nil || value.Artists == nil {
					http.Error(w, "invalid artist index", 400)
					return
				}
				if len(value.Artists) > 30000 {
					http.Error(w, "too many artists", 400)
					return
				}
				seen := make(map[string]bool, len(value.Artists))
				for _, a := range value.Artists {
					if a.ID == "" || len(a.ID) > 1024 || a.Name == "" || len(a.Name) > 1024 || a.Count < 0 || a.Count > 1000000 || len(a.ArtistIDs) > 30 || seen[a.ID] {
						http.Error(w, "invalid artist entry", 400)
						return
					}
					seen[a.ID] = true
					for _, id := range a.ArtistIDs {
						if id == "" || len(id) > 256 {
							http.Error(w, "invalid artist ID", 400)
							return
						}
					}
				}
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				file := experimentalFile(user.ID)
				state, err := readExperimental(file)
				if err != nil {
					http.Error(w, "cannot read state", 500)
					return
				}
				state.CatalogueIndex = value.Artists
				if err := writeExperimental(file, state); err != nil {
					http.Error(w, "cannot save catalogue index", 500)
					return
				}
				experimentalRespond(w, 200, map[string]any{"saved": len(value.Artists)})
			})
			r.Put("/catalogue-pins", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 128*1024)
				var value struct {
					Artists []string `json:"artists"`
					Minimum int      `json:"minimum"`
				}
				if err := json.NewDecoder(req.Body).Decode(&value); err != nil || value.Artists == nil || len(value.Artists) > 5000 || value.Minimum < 0 || value.Minimum > 999999 {
					http.Error(w, "invalid pinned artist list", 400)
					return
				}
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				file := experimentalFile(user.ID)
				state, err := readExperimental(file)
				if err != nil {
					http.Error(w, "cannot read state", 500)
					return
				}
				// Pinned artists must still qualify for the current minimum.
				eligible := make(map[string]bool, len(state.CatalogueIndex))
				for _, a := range state.CatalogueIndex {
					if a.Count > value.Minimum && a.ID != "" {
						eligible[a.ID] = true
					}
				}
				seen := make(map[string]bool, len(value.Artists))
				pins := make([]string, 0, len(value.Artists))
				for _, id := range value.Artists {
					if len(id) > 1024 || !eligible[id] || seen[id] {
						continue
					}
					seen[id] = true
					pins = append(pins, id)
				}
				state.CataloguePins = pins
				if err := writeExperimental(file, state); err != nil {
					http.Error(w, "cannot save catalogue pins", 500)
					return
				}
				experimentalRespond(w, 200, map[string]any{"artists": pins})
			})
			r.Put("/catalogue-order", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 128*1024)
				var value struct {
					Artist string   `json:"artist"`
					Titles []string `json:"titles"`
				}
				if err := json.NewDecoder(req.Body).Decode(&value); err != nil {
					http.Error(w, "invalid JSON", 400)
					return
				}
				// Both keys are Unicode-normalized, case-folded by the client.
				// Limits prevent a client from filling the per-user JSON file.
				value.Artist = strings.TrimSpace(value.Artist)
				if value.Artist == "" || len(value.Artist) > 1024 || len(value.Titles) > 20000 {
					http.Error(w, "invalid catalogue order", 400)
					return
				}
				seen := make(map[string]bool, len(value.Titles))
				for _, title := range value.Titles {
					if title == "" || len(title) > 1024 || seen[title] {
						http.Error(w, "invalid or repeated song title", 400)
						return
					}
					seen[title] = true
				}
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				file := experimentalFile(user.ID)
				state, err := readExperimental(file)
				if err != nil {
					http.Error(w, "cannot read state", 500)
					return
				}
				if _, existing := state.CatalogueOrders[value.Artist]; !existing && len(state.CatalogueOrders) >= 5000 {
					http.Error(w, "catalogue order limit reached", 400)
					return
				}
				state.CatalogueOrders[value.Artist] = value.Titles
				if err := writeExperimental(file, state); err != nil {
					http.Error(w, "cannot save catalogue order", 500)
					return
				}
				experimentalRespond(w, 200, map[string]any{"artist": value.Artist, "titles": value.Titles})
			})
			r.Put("/collections", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 1024*1024)
				var items []experimentalCollection
				if err := json.NewDecoder(req.Body).Decode(&items); err != nil || len(items) > 500 {
					http.Error(w, "invalid collections", 400)
					return
				}
				for _, item := range items {
					if len(item.ID) > 100 || len(item.Name) > 200 || len(item.Albums) > 20000 {
						http.Error(w, "invalid collection", 400)
						return
					}
				}
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				file := experimentalFile(user.ID)
				state, err := readExperimental(file)
				if err != nil {
					http.Error(w, "cannot read", 500)
					return
				}
				state.Collections = items
				if err = writeExperimental(file, state); err != nil {
					http.Error(w, "cannot save", 500)
					return
				}
				experimentalRespond(w, 200, state)
			})
			r.Put("/progress", func(w http.ResponseWriter, req *http.Request) {
				user, ok := request.UserFrom(req.Context())
				if !ok {
					http.Error(w, "unauthorized", 401)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 16384)
				var value experimentalPosition
				err := json.NewDecoder(req.Body).Decode(&value)
				if err != nil && !errors.Is(err, io.EOF) {
					http.Error(w, "invalid JSON", 400)
					return
				}
				if (value.Type != "album" && value.Type != "playlist") || value.ID == "" || (len(value.ID) > 150 && !(value.Type == "playlist" && strings.HasPrefix(value.ID, "catalogue:") && len(value.ID) <= 512)) || len(value.Name) > 300 || len(value.TrackID) > 150 || value.Seconds < 0 || value.Seconds > 86400 {
					http.Error(w, "invalid progress", 400)
					return
				}
				// Old clients without recordedAt remain supported. Reject invalid
				// future client timestamps instead of trusting them blindly.
				if value.RecordedAt.IsZero() {
					value.RecordedAt = time.Now().UTC()
				}
				if value.RecordedAt.After(time.Now().Add(2 * time.Minute)) {
					http.Error(w, "invalid progress timestamp", 400)
					return
				}
				value.UpdatedAt = time.Now().UTC()
				experimentalMu.Lock()
				defer experimentalMu.Unlock()
				file := experimentalFile(user.ID)
				state, err := readExperimental(file)
				if err != nil {
					http.Error(w, "cannot read", 500)
					return
				}
				next := make([]experimentalPosition, 0, len(state.Progress)+1)
				next = append(next, value)
				for _, p := range state.Progress {
					if p.Type != value.Type || p.ID != value.ID {
						next = append(next, p)
					} else if p.RecordedAt.After(value.RecordedAt) {
						// An older request arrived after a newer position. Keep the
						// position saved later by the player.
						next[0] = p
					}
				}
				if len(next) > 500 {
					next = next[:500]
				}
				state.Progress = next
				if err = writeExperimental(file, state); err != nil {
					http.Error(w, "cannot save", 500)
					return
				}
				experimentalRespond(w, 200, value)
			})
		})
	})
}

// Writeback is opt-in and restricted to an explicitly mounted playlist folder.
// Map the NAS playlist directory twice: /music/playlist:ro (via music mount)
// and /m3u-write:rw. Set ND_EXPERIMENTALM3UROOT=/m3u-write.
func (s *Server) experimentalM3UTarget(r *http.Request) (string, *string, error) {
	root := os.Getenv("ND_EXPERIMENTALM3UROOT")
	sourceRoot := filepath.Join(conf.Server.MusicFolder, filepath.FromSlash(conf.Server.PlaylistsPath))
	if root == "" || conf.Server.PlaylistsPath == "" || !filepath.IsAbs(root) || !filepath.IsAbs(sourceRoot) {
		return "", nil, fmt.Errorf("M3U writeback paths not configured")
	}
	user, ok := request.UserFrom(r.Context())
	if !ok {
		return "", nil, fmt.Errorf("not authenticated")
	}
	pl, err := s.ds.Playlist().GetWithTracks(r.Context(), chi.URLParam(r, "id"), false, false)
	if err != nil {
		return "", nil, err
	}
	if pl.OwnerID != user.ID && !user.IsAdmin {
		return "", nil, fmt.Errorf("not playlist owner")
	}
	if pl.IsSmartPlaylist() || pl.Path == "" {
		return "", nil, fmt.Errorf("playlist has no source M3U")
	}
	if pl.Sync {
		return "", nil, fmt.Errorf("disable auto-sync for this playlist before editing")
	}
	name := filepath.Base(pl.Path)
	if name == "." || name == ".." || strings.ContainsAny(name, "/\\") || !strings.EqualFold(filepath.Ext(name), ".m3u") {
		return "", nil, fmt.Errorf("invalid M3U name")
	}
	rel, err := filepath.Rel(filepath.Clean(sourceRoot), filepath.Clean(pl.Path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", nil, fmt.Errorf("playlist is outside configured source folder")
	}
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || (rootInfo.Mode()&os.ModeSymlink) != 0 {
		return "", nil, fmt.Errorf("writeback root unavailable")
	}
	target := filepath.Join(root, rel)
	stat, err := os.Lstat(target)
	if err != nil || !stat.Mode().IsRegular() {
		return "", nil, fmt.Errorf("source M3U is missing or is not a regular file")
	}
	content := exportM3URelative(pl.Path, pl.Name, pl.MediaFiles())
	return target, &content, nil
}
func exportM3URelative(sourcePath, title string, files model.MediaFiles) string {
	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#PLAYLIST:" + strings.ReplaceAll(strings.ReplaceAll(title, "\r", " "), "\n", " ") + "\n")
	for _, track := range files {
		relative, err := filepath.Rel(filepath.Dir(sourcePath), track.AbsolutePath())
		if err != nil {
			continue
		}
		b.WriteString(fmt.Sprintf("#EXTINF:%.0f,%s - %s\n", track.Duration, strings.ReplaceAll(track.Artist, "\n", " "), strings.ReplaceAll(track.Title, "\n", " ")))
		b.WriteString(filepath.ToSlash(relative) + "\n")
	}
	return b.String()
}
func (s *Server) experimentalM3UPreview(w http.ResponseWriter, r *http.Request) {
	target, content, err := s.experimentalM3UTarget(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	existing, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "read failed", 500)
		return
	}
	hash := sha256.Sum256(existing)
	experimentalRespond(w, 200, map[string]any{"filename": filepath.Base(target), "hash": hex.EncodeToString(hash[:]), "preview": *content})
}
func (s *Server) experimentalM3USave(w http.ResponseWriter, r *http.Request) {
	target, content, err := s.experimentalM3UTarget(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	var body struct {
		ExpectedHash string `json:"expectedHash"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.ExpectedHash) != 64 {
		http.Error(w, "expectedHash required", 400)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	existing, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "read failed", 500)
		return
	}
	hash := sha256.Sum256(existing)
	if hex.EncodeToString(hash[:]) != body.ExpectedHash {
		http.Error(w, "M3U changed since preview; reload before saving", 409)
		return
	}
	stamp := time.Now().UTC().Format("20060102T150405.000000000")
	backup := target + ".nd-backup-" + stamp
	if err := os.WriteFile(backup, existing, 0600); err != nil {
		http.Error(w, "backup failed", 500)
		return
	}
	tmp, err := os.CreateTemp(filepath.Dir(target), ".nd-playlist-*")
	if err != nil {
		http.Error(w, "temp file failed", 500)
		return
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0644); err == nil {
		_, err = tmp.WriteString(*content)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), target)
	}
	if err != nil {
		http.Error(w, "writeback failed; backup retained", 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"saved": true, "filename": filepath.Base(target), "backup": filepath.Base(backup)})
}

// experimentalCollectionFolders exposes indexed folder subtrees with their album IDs.
// It never walks a host path: only indexed library folders are selectable.
func (s *Server) experimentalCollectionFolders(w http.ResponseWriter, r *http.Request) {
	// Build a complete, recursive folder tree from mounted library roots.
	// The indexed Folder table may omit directories without directly indexed audio.
	libraries, err := s.ds.Library().GetAll(r.Context())
	if err != nil {
		http.Error(w, "cannot read music libraries", http.StatusInternalServerError)
		return
	}
	albums, err := s.ds.Album().GetAll(r.Context())
	if err != nil {
		http.Error(w, "cannot read albums", http.StatusInternalServerError)
		return
	}
	files, err := s.ds.MediaFile().GetAll(r.Context())
	if err != nil {
		http.Error(w, "cannot read indexed songs", http.StatusInternalServerError)
		return
	}
	type folderEntry struct {
		ID       string   `json:"id"`
		Label    string   `json:"label"`
		AlbumIDs []string `json:"albumIds"`
		Depth    int      `json:"depth"`
	}
	validAlbums := make(map[string]struct{}, len(albums))
	for _, album := range albums {
		if !album.Missing {
			validAlbums[album.ID] = struct{}{}
		}
	}
	// Count albums for every ancestor folder, not just a song's immediate folder.
	albumsByFolder := map[string]map[string]struct{}{}
	for _, mf := range files {
		if mf.Missing || mf.AlbumID == "" {
			continue
		}
		if _, valid := validAlbums[mf.AlbumID]; !valid {
			continue
		}
		for _, lib := range libraries {
			if lib.ID != mf.LibraryID {
				continue
			}
			rel, relErr := filepath.Rel(lib.Path, mf.AbsolutePath())
			if relErr != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				break
			}
			dir := filepath.ToSlash(filepath.Dir(rel))
			for dir != "." && dir != "" {
				key := fmt.Sprintf("%d:%s", lib.ID, dir)
				if albumsByFolder[key] == nil {
					albumsByFolder[key] = map[string]struct{}{}
				}
				albumsByFolder[key][mf.AlbumID] = struct{}{}
				dir = path.Dir(dir)
			}
			break
		}
	}
	allAlbums := make([]string, 0, len(validAlbums))
	for id := range validAlbums {
		allAlbums = append(allAlbums, id)
	}
	sort.Strings(allAlbums)
	result := []folderEntry{{ID: "__library_root__", Label: "Music Library (all albums)", AlbumIDs: allAlbums, Depth: 0}}
	// Scan *directories* rather than only indexed song folders. Never traverse
	// symlink directories. Bound the scan so a large NAS tree cannot exhaust memory.
	const maxFolders = 10000
	for _, lib := range libraries {
		if len(result) >= maxFolders {
			break
		}
		root := filepath.Clean(lib.Path)
		rootInfo, statErr := os.Stat(root)
		if statErr != nil || !rootInfo.IsDir() {
			continue
		}
		_ = filepath.WalkDir(root, func(current string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if r.Context().Err() != nil {
				return filepath.SkipAll
			}
			if !entry.IsDir() {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return filepath.SkipDir
			}
			if current == root {
				return nil
			}
			if len(result) >= maxFolders {
				return filepath.SkipAll
			}
			rel, relErr := filepath.Rel(root, current)
			if relErr != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				return filepath.SkipDir
			}
			rel = filepath.ToSlash(rel)
			key := fmt.Sprintf("%d:%s", lib.ID, rel)
			ids := make([]string, 0, len(albumsByFolder[key]))
			for id := range albumsByFolder[key] {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			depth := strings.Count(rel, "/") + 1
			result = append(result, folderEntry{
				ID:       "library-folder:" + key,
				Label:    fmt.Sprintf("%s / %s", lib.Name, rel),
				AlbumIDs: ids, Depth: depth,
			})
			return nil
		})
	}
	experimentalRespond(w, http.StatusOK, map[string]any{"folders": result})
}

// experimentalCollectionFolderTree browses mounted music directories lazily.
// Unlike collection-folders it does not impose a global folder cap that can
// silently hide Chinese/Japanese directory names late in lexical order.
// GET ?parent=library-folder:<libraryID>:<relativePath> expands one level.
// GET ?search=<term> searches all levels and returns up to 200 matches.
func (s *Server) experimentalCollectionFolderTree(w http.ResponseWriter, r *http.Request) {
	libraries, err := s.ds.Library().GetAll(r.Context())
	if err != nil {
		http.Error(w, "cannot read libraries", 500)
		return
	}
	media, err := s.ds.MediaFile().GetAll(r.Context())
	if err != nil {
		http.Error(w, "cannot read indexed songs", 500)
		return
	}
	type entry struct {
		ID          string   `json:"id"`
		Name        string   `json:"name"`
		Label       string   `json:"label"`
		AlbumIDs    []string `json:"albumIds"`
		HasChildren bool     `json:"hasChildren"`
	}
	children := make([]entry, 0)
	indexAlbums := func(libID int, relative string) []string {
		ids := map[string]struct{}{}
		for _, mf := range media {
			if mf.LibraryID != libID || mf.Missing || mf.AlbumID == "" {
				continue
			}
			file := filepath.ToSlash(mf.Path)
			if relative == "." || strings.HasPrefix(file, relative+"/") {
				ids[mf.AlbumID] = struct{}{}
			}
		}
		out := make([]string, 0, len(ids))
		for id := range ids {
			out = append(out, id)
		}
		sort.Strings(out)
		return out
	}
	hasDirs := func(dir string) bool {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return false
		}
		for _, e := range entries {
			if e.IsDir() && e.Type()&os.ModeSymlink == 0 {
				return true
			}
		}
		return false
	}
	makeEntry := func(libID int, libName, root, relative string) entry {
		name := filepath.Base(relative)
		if relative == "." {
			name = libName
		}
		abs := filepath.Join(root, filepath.FromSlash(relative))
		return entry{ID: fmt.Sprintf("library-folder:%d:%s", libID, relative), Name: name,
			Label: libName + " / " + relative, AlbumIDs: indexAlbums(libID, relative), HasChildren: hasDirs(abs)}
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if len([]rune(search)) > 200 {
		http.Error(w, "search too long", 400)
		return
	}
	parent := r.URL.Query().Get("parent")
	if search != "" {
		truncated := false
		query := strings.ToLower(search)
		for _, lib := range libraries {
			root := filepath.Clean(lib.Path)
			if info, e := os.Stat(root); e != nil || !info.IsDir() {
				continue
			}
			err := filepath.WalkDir(root, func(current string, d os.DirEntry, walkErr error) error {
				if r.Context().Err() != nil {
					return filepath.SkipAll
				}
				if walkErr != nil || !d.IsDir() {
					return nil
				}
				if d.Type()&os.ModeSymlink != 0 {
					return filepath.SkipDir
				}
				rel, e := filepath.Rel(root, current)
				if e != nil {
					return nil
				}
				rel = filepath.ToSlash(rel)
				if strings.Contains(strings.ToLower(rel), query) {
					if len(children) >= 200 {
						truncated = true
						return filepath.SkipAll
					}
					children = append(children, makeEntry(lib.ID, lib.Name, root, rel))
				}
				return nil
			})
			if err != nil && !errors.Is(err, filepath.SkipAll) {
				http.Error(w, "folder search failed: "+err.Error(), 500)
				return
			}
			if truncated {
				break
			}
		}
		experimentalRespond(w, 200, map[string]any{"folders": children, "truncated": truncated})
		return
	}
	if parent == "" {
		ids := map[string]struct{}{}
		for _, mf := range media {
			if !mf.Missing && mf.AlbumID != "" {
				ids[mf.AlbumID] = struct{}{}
			}
		}
		all := make([]string, 0, len(ids))
		for id := range ids {
			all = append(all, id)
		}
		sort.Strings(all)
		children = append(children, entry{ID: "__library_root__", Name: "All music", Label: "Music Library (all albums)", AlbumIDs: all})
		for _, lib := range libraries {
			children = append(children, makeEntry(lib.ID, lib.Name, filepath.Clean(lib.Path), "."))
		}
	} else {
		constPrefix := "library-folder:"
		if !strings.HasPrefix(parent, constPrefix) {
			http.Error(w, "invalid parent", 400)
			return
		}
		var id int
		idString, rel, ok := strings.Cut(strings.TrimPrefix(parent, constPrefix), ":")
		if !ok || rel == "" {
			http.Error(w, "invalid parent", 400)
			return
		}
		if _, e := fmt.Sscanf(idString, "%d", &id); e != nil {
			http.Error(w, "invalid parent", 400)
			return
		}
		libFound := false
		for _, lib := range libraries {
			if lib.ID != id {
				continue
			}
			libFound = true
			rel = filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
			if rel == ".." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
				http.Error(w, "invalid directory", 400)
				return
			}
			root := filepath.Clean(lib.Path)
			dir := filepath.Join(root, filepath.FromSlash(rel))
			items, e := os.ReadDir(dir)
			if e != nil {
				http.Error(w, "cannot read directory", 400)
				return
			}
			for _, item := range items {
				if !item.IsDir() || item.Type()&os.ModeSymlink != 0 {
					continue
				}
				childRel := item.Name()
				if rel != "." {
					childRel = path.Join(rel, item.Name())
				}
				children = append(children, makeEntry(lib.ID, lib.Name, root, childRel))
			}
			break
		}
		if !libFound {
			http.Error(w, "unknown library", 404)
			return
		}
	}
	sort.SliceStable(children, func(i, j int) bool { return strings.ToLower(children[i].Name) < strings.ToLower(children[j].Name) })
	experimentalRespond(w, 200, map[string]any{"folders": children})
}

// experimentalM3UFolderStatus performs a read-only inventory of the configured
// playlist folder. It deliberately does not pretend to offer three-way sync:
// that requires a persisted per-playlist baseline and mismatch protection.
func (s *Server) experimentalM3UFolderStatus(w http.ResponseWriter, r *http.Request) {
	_, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	root := filepath.Join(conf.Server.MusicFolder, filepath.FromSlash(conf.Server.PlaylistsPath))
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		http.Error(w, "playlist folder unavailable", 400)
		return
	}
	musicReal, err := filepath.EvalSymlinks(conf.Server.MusicFolder)
	if err != nil {
		http.Error(w, "music folder unavailable", 400)
		return
	}
	relative, err := filepath.Rel(musicReal, rootReal)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		http.Error(w, "playlist folder outside music directory", 400)
		return
	}
	entries, err := os.ReadDir(rootReal)
	if err != nil {
		http.Error(w, "cannot read playlist folder", 400)
		return
	}
	type item struct {
		Name       string `json:"name"`
		Tracks     int    `json:"tracks"`
		Status     string `json:"status"`
		ModifiedAt string `json:"modifiedAt"`
		PlaylistID string `json:"playlistId,omitempty"`
		Missing    bool   `json:"missing,omitempty"`
		Sync       bool   `json:"sync"`
	}
	result := make([]item, 0)
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !(strings.EqualFold(filepath.Ext(entry.Name()), ".m3u") || strings.EqualFold(filepath.Ext(entry.Name()), ".m3u8")) {
			continue
		}
		if len(result) >= 500 {
			break
		}
		fi, err := entry.Info()
		if err != nil || fi.Size() > 5*1024*1024 {
			continue
		}
		data, err := os.ReadFile(filepath.Join(rootReal, entry.Name()))
		if err != nil {
			continue
		}
		count := 0
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				count++
			}
		}
		pl, plErr := s.ds.Playlist().FindByPath(r.Context(), filepath.Join(root, entry.Name()))
		row := item{Name: entry.Name(), Tracks: count, Status: "Not linked yet — import to Navidrome", ModifiedAt: fi.ModTime().Format(time.RFC3339)}
		if plErr == nil && pl != nil {
			row.PlaylistID = pl.ID
			row.Sync = pl.Sync
			if pl.Sync {
				row.Status = "Auto-import enabled (M3U → Navidrome)"
			} else {
				row.Status = "Editable in Navidrome (manual M3U writeback available)"
			}
		}
		result = append(result, row)
	}
	// Missing source M3Us cannot be discovered by listing the directory alone.
	// Surface only file-backed playlists whose original path is inside this
	// configured folder. Missing-file status never causes automatic deletion.
	user, _ := request.UserFrom(r.Context())
	if user.IsAdmin {
		stored, listErr := s.ds.Playlist().GetAll(r.Context())
		if listErr != nil {
			http.Error(w, "cannot inspect stored playlists", 500)
			return
		}
		for _, pl := range stored {
			if len(result) >= 1000 {
				break
			}
			if pl.Path == "" || pl.IsSmartPlaylist() {
				continue
			}
			if !strings.EqualFold(filepath.Ext(pl.Path), ".m3u") && !strings.EqualFold(filepath.Ext(pl.Path), ".m3u8") {
				continue
			}
			rel, relErr := filepath.Rel(root, filepath.Clean(pl.Path))
			if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) || strings.Contains(rel, string(os.PathSeparator)) {
				continue
			}
			if _, statErr := os.Stat(pl.Path); !os.IsNotExist(statErr) {
				continue
			}
			result = append(result, item{Name: filepath.Base(pl.Path), PlaylistID: pl.ID,
				Status: "M3U deleted on Synology — still in Navidrome", Missing: true})
		}
	}
	experimentalRespond(w, 200, map[string]any{"folder": conf.Server.PlaylistsPath, "count": len(result), "files": result})
}

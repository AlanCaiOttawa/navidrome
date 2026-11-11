package server

// Explicit, administrator-only reconciliation of Synology M3U files and
// Navidrome playlists. No operation removes or edits a source M3U file.
import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/core/playlists"
	"github.com/navidrome/navidrome/model/request"
)

func experimentalM3UFolder() (string, error) {
	folder := filepath.Clean(filepath.Join(conf.Server.MusicFolder, filepath.FromSlash(conf.Server.PlaylistsPath)))
	// Verify the folder exists; keep the configured path used by Navidrome's
	// imported playlist records (which need not be the symlink-resolved path).
	_, err := filepath.EvalSymlinks(folder)
	return folder, err
}

func validM3UBase(name string) bool {
	return name != "" && name != "." && name != ".." && name == filepath.Base(name) &&
		!strings.ContainsAny(name, `/\`) &&
		(strings.EqualFold(filepath.Ext(name), ".m3u") || strings.EqualFold(filepath.Ext(name), ".m3u8"))
}

func (s *Server) experimentalM3UImportOne(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok || !user.IsAdmin {
		http.Error(w, "administrator required", http.StatusForbidden)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&req) != nil || !validM3UBase(req.Name) {
		http.Error(w, "invalid M3U filename", 400)
		return
	}
	root, err := experimentalM3UFolder()
	if err != nil {
		http.Error(w, "playlist folder unavailable", 400)
		return
	}
	target := filepath.Join(root, req.Name)
	resolved, err := filepath.EvalSymlinks(target)
	realRoot, rootErr := filepath.EvalSymlinks(root)
	if err != nil || rootErr != nil || filepath.Dir(resolved) != realRoot {
		http.Error(w, "M3U path is unavailable or outside playlist folder", 400)
		return
	}
	stat, err := os.Stat(resolved)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 5*1024*1024 {
		http.Error(w, "M3U file unavailable or exceeds size limit", 400)
		return
	}
	if existing, findErr := s.ds.Playlist().FindByPath(r.Context(), target); findErr == nil && existing != nil {
		http.Error(w, "playlist already linked; use normal sync controls", 409)
		return
	}
	imported, err := playlists.NewPlaylists(s.ds, nil).ImportFile(r.Context(), target, true)
	if err != nil || imported == nil || imported.ID == "" {
		http.Error(w, "M3U import failed; check server logs and path matching", 400)
		return
	}
	experimentalRespond(w, 200, map[string]any{"id": imported.ID, "name": imported.Name})
}

func (s *Server) experimentalM3UDeleteMissing(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok || !user.IsAdmin {
		http.Error(w, "administrator required", http.StatusForbidden)
		return
	}
	var req struct {
		ID      string `json:"id"`
		Confirm bool   `json:"confirm"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&req) != nil || req.ID == "" || !req.Confirm {
		http.Error(w, "explicit deletion confirmation required", 400)
		return
	}
	pl, err := s.ds.Playlist().Get(r.Context(), req.ID)
	if err != nil || pl == nil || pl.Path == "" || pl.IsSmartPlaylist() ||
		(!strings.EqualFold(filepath.Ext(pl.Path), ".m3u") && !strings.EqualFold(filepath.Ext(pl.Path), ".m3u8")) {
		http.Error(w, "file-backed playlist not found", 404)
		return
	}
	root, err := experimentalM3UFolder()
	if err != nil {
		http.Error(w, "playlist folder unavailable", 400)
		return
	}
	rel, err := filepath.Rel(root, filepath.Clean(pl.Path))
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) ||
		filepath.IsAbs(rel) || strings.Contains(rel, string(os.PathSeparator)) {
		http.Error(w, "playlist is outside configured folder", 400)
		return
	}
	// Refuse deletion if file exists OR its absence is uncertain (permission errors).
	if _, statErr := os.Stat(pl.Path); !os.IsNotExist(statErr) {
		http.Error(w, "source M3U is still present or cannot be checked", 409)
		return
	}
	if err := s.ds.Playlist().Delete(r.Context(), pl.ID); err != nil {
		http.Error(w, "could not delete Navidrome playlist", 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"deleted": pl.ID, "name": pl.Name})
}

package server

// Export a single artist Catalogue as a Synology/Audio Station-compatible
// extended M3U. The client supplies only ordered media-file IDs; filesystem
// paths come exclusively from the authenticated server's media database.
// This endpoint downloads a file and NEVER writes or creates a Navidrome playlist.
import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

func (s *Server) experimentalCatalogueM3U(w http.ResponseWriter, r *http.Request) {
	if _, ok := request.UserFrom(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Artist string   `json:"artist"`
		Tracks []string `json:"tracks"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		strings.TrimSpace(body.Artist) == "" || len(body.Artist) > 300 ||
		len(body.Tracks) == 0 || len(body.Tracks) > 10000 {
		http.Error(w, "invalid artist or track selection", http.StatusBadRequest)
		return
	}
	// Source path mirrors the configured Synology playlist folder. Paths in the
	// resulting file are relative to this folder, even when files are nested.
	playlistFolder := conf.Server.PlaylistsPath
	if playlistFolder == "" {
		playlistFolder = "Playlist"
	}
	musicRoot := filepath.Clean(conf.Server.MusicFolder)
	playlistDir := filepath.Clean(filepath.Join(musicRoot, filepath.FromSlash(playlistFolder)))
	if rel, err := filepath.Rel(musicRoot, playlistDir); err != nil ||
		rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		http.Error(w, "unsafe playlist folder", http.StatusBadRequest)
		return
	}
	files := make(model.MediaFiles, 0, len(body.Tracks))
	seen := make(map[string]bool, len(body.Tracks))
	for _, id := range body.Tracks {
		if id == "" || len(id) > 150 || seen[id] {
			http.Error(w, "duplicate or invalid track ID", http.StatusBadRequest)
			return
		}
		seen[id] = true
		track, err := s.ds.MediaFile().Get(r.Context(), id)
		if err != nil || track == nil || track.Missing {
			http.Error(w, fmt.Sprintf("song unavailable: %s", id), http.StatusBadRequest)
			return
		}
		abs := filepath.Clean(track.AbsolutePath())
		rel, err := filepath.Rel(musicRoot, abs)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			http.Error(w, "song path outside the music library", http.StatusBadRequest)
			return
		}
		files = append(files, *track)
	}
	// Use the exact exporter used for existing Synology M3U playlists.
	virtualM3U := filepath.Join(playlistDir, "catalogue-export.m3u")
	content := exportM3URelative(virtualM3U, "Catalogue - "+body.Artist, files)
	experimentalRespond(w, http.StatusOK, map[string]any{
		"content":  content,
		"count":    len(files),
		"filename": "Catalogue - " + body.Artist + ".m3u",
	})
}

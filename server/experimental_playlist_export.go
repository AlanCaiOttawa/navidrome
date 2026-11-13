package server

// Export one existing Navidrome playlist to a Synology/Audio Station-compatible
// M3U download without changing the playlist or writing a file to the NAS.
import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

func (s *Server) experimentalPlaylistExportM3U(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" || len(id) > 150 {
		http.Error(w, "invalid playlist", http.StatusBadRequest)
		return
	}
	pl, err := s.ds.Playlist().GetWithTracks(r.Context(), id, true, false)
	if err != nil || pl == nil {
		http.Error(w, "playlist not found", http.StatusNotFound)
		return
	}
	if pl.OwnerID != user.ID && !user.IsAdmin {
		http.Error(w, "not playlist owner", http.StatusForbidden)
		return
	}

	// M3U relative paths must resolve from the configured Synology Playlist
	// folder, NOT the user's browser or the existing playlist's source path.
	folder := conf.Server.PlaylistsPath
	if folder == "" {
		folder = "Playlist"
	}
	musicRoot := filepath.Clean(conf.Server.MusicFolder)
	playlistDir := filepath.Clean(filepath.Join(musicRoot, filepath.FromSlash(folder)))
	dirRel, err := filepath.Rel(musicRoot, playlistDir)
	if err != nil || dirRel == ".." || strings.HasPrefix(dirRel, ".."+string(filepath.Separator)) || filepath.IsAbs(dirRel) {
		http.Error(w, "invalid playlist folder", http.StatusBadRequest)
		return
	}
	files := make(model.MediaFiles, 0, len(pl.MediaFiles()))
	for _, mf := range pl.MediaFiles() {
		if mf.Missing {
			continue
		}
		fileRel, err := filepath.Rel(musicRoot, filepath.Clean(mf.AbsolutePath()))
		if err != nil || fileRel == "." || fileRel == ".." || strings.HasPrefix(fileRel, ".."+string(filepath.Separator)) || filepath.IsAbs(fileRel) {
			http.Error(w, "playlist references music outside library", http.StatusBadRequest)
			return
		}
		files = append(files, mf)
	}
	// The filename is only a virtual path used to generate relative entries.
	// No file is opened, overwritten or created on the NAS.
	text := exportM3URelative(filepath.Join(playlistDir, "navidrome-download.m3u"), pl.Name, files)
	experimentalRespond(w, http.StatusOK, map[string]any{
		"filename": pl.Name + ".m3u",
		"content":  text,
		"count":    len(files),
		"skipped":  len(pl.MediaFiles()) - len(files),
	})
}

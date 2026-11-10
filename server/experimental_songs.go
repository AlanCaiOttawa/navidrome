package server

// Experimental recently-played songs and opt-in file metadata editor.
// Recent songs live in /data. Metadata and embedded artwork change source audio
// only when ND_EXPERIMENTALMUSICWRITEROOT is explicitly configured.
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

const recentSongLimit = 5

func (s *Server) experimentalRecordSong(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var input struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil || input.ID == "" || len(input.ID) > 150 {
		http.Error(w, "invalid song", 400)
		return
	}
	if _, err := s.ds.MediaFile().Get(r.Context(), input.ID); err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	file := experimentalFile(user.ID)
	state, err := readExperimental(file)
	if err != nil {
		http.Error(w, "read failed", 500)
		return
	}
	next := []experimentalRecentSong{}
	old := experimentalRecentSong{ID: input.ID}
	for _, song := range state.RecentSongs {
		if song.ID == input.ID {
			old.Pinned = song.Pinned
		} else {
			next = append(next, song)
		}
	}
	old.PlayedAt = time.Now().UTC()
	next = append([]experimentalRecentSong{old}, next...)
	for len(next) > recentSongLimit {
		drop := -1
		for i := len(next) - 1; i >= 0; i-- {
			if !next[i].Pinned {
				drop = i
				break
			}
		}
		if drop < 0 {
			break
		}
		next = append(next[:drop], next[drop+1:]...)
	}
	state.RecentSongs = next
	if err = writeExperimental(file, state); err != nil {
		http.Error(w, "save failed", 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"recentSongs": next})
}

func (s *Server) experimentalPinSong(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "missing ID", 400)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var body struct {
		Pinned bool `json:"pinned"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "invalid pin", 400)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	file := experimentalFile(user.ID)
	state, err := readExperimental(file)
	if err != nil {
		http.Error(w, "read failed", 500)
		return
	}
	found := false
	for i := range state.RecentSongs {
		if state.RecentSongs[i].ID == id {
			state.RecentSongs[i].Pinned = body.Pinned
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "song not in history", 404)
		return
	}
	if err = writeExperimental(file, state); err != nil {
		http.Error(w, "save failed", 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"recentSongs": state.RecentSongs})
}

func (s *Server) editorSong(r *http.Request) (*model.MediaFile, error) {
	id := chi.URLParam(r, "id")
	if id == "" || len(id) > 150 {
		return nil, fmt.Errorf("invalid song ID")
	}
	return s.ds.MediaFile().Get(r.Context(), id)
}
func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "unauthorized", 401)
		return false
	}
	if !user.IsAdmin {
		http.Error(w, "administrator required for editing", 403)
		return false
	}
	return true
}
func songWritableTarget(mf *model.MediaFile) (string, error) {
	root := strings.TrimSpace(os.Getenv("ND_EXPERIMENTALMUSICWRITEROOT"))
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("file editing disabled: mount the music library separately as writable and set ND_EXPERIMENTALMUSICWRITEROOT")
	}
	originalRoot, err := filepath.EvalSymlinks(conf.Server.MusicFolder)
	if err != nil {
		return "", err
	}
	original, err := filepath.EvalSymlinks(mf.AbsolutePath())
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(originalRoot, original)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("song outside music root")
	}
	writeRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(writeRoot, rel)
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	pathRel, err := filepath.Rel(writeRoot, resolved)
	if err != nil || pathRel == ".." || filepath.IsAbs(pathRel) || strings.HasPrefix(pathRel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("song escapes writable root")
	}
	info, err := os.Lstat(resolved)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("file is not a regular audio file")
	}
	return resolved, nil
}
func (s *Server) experimentalSongEditorInfo(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	all, err := s.ds.Playlist().GetAll(r.Context())
	if err != nil {
		http.Error(w, "playlists unavailable", 500)
		return
	}
	member, err := s.ds.Playlist().GetPlaylists(r.Context(), mf.ID)
	if err != nil {
		http.Error(w, "membership unavailable", 500)
		return
	}
	members := map[string]bool{}
	for _, p := range member {
		members[p.ID] = true
	}
	user, _ := request.UserFrom(r.Context())
	playlists := []map[string]any{}
	for _, pl := range all {
		playlists = append(playlists, map[string]any{"id": pl.ID, "name": pl.Name, "member": members[pl.ID], "editable": (pl.OwnerID == user.ID || user.IsAdmin) && pl.TracksEditable(), "sync": pl.Sync, "smart": pl.IsSmartPlaylist(), "path": pl.Path})
	}
	sort.Slice(playlists, func(i, j int) bool { return fmt.Sprint(playlists[i]["name"]) < fmt.Sprint(playlists[j]["name"]) })
	_, writeErr := songWritableTarget(mf)
	experimentalRespond(w, 200, map[string]any{"song": mf, "fileName": filepath.Base(mf.AbsolutePath()), "playlists": playlists, "fileEditingEnabled": writeErr == nil})
}
func (s *Server) changeSongPlaylist(w http.ResponseWriter, r *http.Request, add bool) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	pid := chi.URLParam(r, "playlistId")
	pl, err := s.ds.Playlist().GetWithTracks(r.Context(), pid, false, false)
	if err != nil {
		http.Error(w, "playlist not found", 404)
		return
	}
	user, _ := request.UserFrom(r.Context())
	if (pl.OwnerID != user.ID && !user.IsAdmin) || !pl.TracksEditable() {
		http.Error(w, "playlist cannot be edited", 403)
		return
	}
	repo := s.ds.Playlist().Tracks(r.Context(), pid, false)
	if add {
		_, err = repo.Add(r.Context(), []string{mf.ID})
	} else {
		ids := []string{}
		for _, t := range pl.Tracks {
			if t.MediaFileID == mf.ID {
				ids = append(ids, t.ID)
			}
		}
		if len(ids) > 0 {
			err = repo.Delete(r.Context(), ids...)
		}
	}
	if err != nil {
		http.Error(w, "playlist update failed: "+err.Error(), 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"ok": true})
}
func (s *Server) experimentalSongPlaylistAdd(w http.ResponseWriter, r *http.Request) {
	s.changeSongPlaylist(w, r, true)
}
func (s *Server) experimentalSongPlaylistRemove(w http.ResponseWriter, r *http.Request) {
	s.changeSongPlaylist(w, r, false)
}

var editableTagNames = map[string]string{"title": "title", "artist": "artist", "album": "album", "albumArtist": "album_artist", "genre": "genre", "year": "date", "trackNumber": "track"}

func validEditableFormat(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3", ".m4a", ".mp4", ".flac", ".ogg", ".opus":
		return true
	}
	return false
}

// ffmpeg makes a stream-copy temp file, retains the original in a timestamped
// backup, and atomically replaces it. Only opt-in writable files can reach this.
func rewriteSong(path string, metadata map[string]string, cover string, removeCover bool) error {
	if !validEditableFormat(path) {
		return fmt.Errorf("unsupported audio format for safe stream-copy editing")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg unavailable: %w", err)
	}
	extension := filepath.Ext(path)
	temp, err := os.CreateTemp(filepath.Dir(path), ".nd-edit-*")
	if err != nil {
		return err
	}
	tempName := temp.Name() + extension
	temp.Close()
	os.Remove(temp.Name())
	defer os.Remove(tempName)
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-i", path}
	if cover != "" {
		args = append(args, "-i", cover, "-map", "0:a", "-map", "1:v:0", "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic")
	} else if removeCover {
		args = append(args, "-map", "0:a", "-c", "copy")
	} else {
		args = append(args, "-map", "0", "-c", "copy")
	}
	args = append(args, "-map_metadata", "0")
	keys := make([]string, 0, len(metadata))
	for key := range metadata {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "-metadata", key+"="+metadata[key])
	}
	args = append(args, "-y", tempName)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg failed: %s: %w", string(output), err)
	}
	originalInfo, err := os.Stat(path)
	if err != nil {
		return err
	}
	if err = os.Chmod(tempName, originalInfo.Mode().Perm()); err != nil {
		return err
	}
	// Preserve an exact copy so tag/embedded-art changes can be rolled back.
	backup := path + ".nd-backup-" + time.Now().UTC().Format("20060102T150405.000000000")
	original, err := os.Open(path)
	if err != nil {
		return err
	}
	defer original.Close()
	b, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, originalInfo.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err = io.Copy(b, original); err != nil {
		b.Close()
		os.Remove(backup)
		return err
	}
	if err = b.Sync(); err != nil {
		b.Close()
		os.Remove(backup)
		return err
	}
	if err = b.Close(); err != nil {
		return err
	}
	if err = os.Rename(tempName, path); err != nil {
		return fmt.Errorf("original preserved at %s; replacing file failed: %w", backup, err)
	}
	return nil
}

func (s *Server) experimentalSongEditTags(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	path, err := songWritableTarget(mf)
	if err != nil {
		http.Error(w, err.Error(), 403)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var fields map[string]string
	if json.NewDecoder(r.Body).Decode(&fields) != nil || len(fields) == 0 || len(fields) > 7 {
		http.Error(w, "invalid tags", 400)
		return
	}
	cleaned := map[string]string{}
	for key, value := range fields {
		target, ok := editableTagNames[key]
		if !ok || len(value) > 500 || strings.ContainsAny(value, "\x00\r\n") {
			http.Error(w, "invalid tag field", 400)
			return
		}
		if (key == "year" || key == "trackNumber") && value != "" {
			num, e := strconv.Atoi(value)
			if e != nil || num < 0 || num > 9999 {
				http.Error(w, "invalid numeric field", 400)
				return
			}
			value = strconv.Itoa(num)
		}
		cleaned[target] = value
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	if err = rewriteSong(path, cleaned, "", false); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"ok": true, "message": "Tags written to audio file. Rescan library to refresh search and album grouping."})
}
func folderImages(mf *model.MediaFile) ([]string, error) {
	root := filepath.Dir(mf.AbsolutePath())
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	result := []string{}
	for _, entry := range entries {
		if entry.Type().IsRegular() && len(result) < 100 {
			name := entry.Name()
			ext := strings.ToLower(filepath.Ext(name))
			if ext == ".jpg" || ext == ".jpeg" || ext == ".png" {
				result = append(result, name)
			}
		}
	}
	sort.Strings(result)
	return result, nil
}
func (s *Server) experimentalSongCoverFiles(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	items, err := folderImages(mf)
	if err != nil {
		http.Error(w, "folder unavailable", 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"files": items})
}
func imageValid(b []byte) error {
	if len(b) == 0 || len(b) > 10*1024*1024 {
		return fmt.Errorf("image must be 1 byte to 10 MB")
	}
	imageInfo, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || (format != "jpeg" && format != "png") || imageInfo.Width > 6000 || imageInfo.Height > 6000 || imageInfo.Width < 1 || imageInfo.Height < 1 {
		return fmt.Errorf("JPEG or PNG required")
	}
	return nil
}
func (s *Server) songCoverRewrite(w http.ResponseWriter, r *http.Request, cover []byte, remove bool) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	target, err := songWritableTarget(mf)
	if err != nil {
		http.Error(w, err.Error(), 403)
		return
	}
	ext := strings.ToLower(filepath.Ext(target))
	if ext != ".mp3" && ext != ".m4a" {
		http.Error(w, "embedded cover editing currently supports MP3 and M4A only", 400)
		return
	}
	imagePath := ""
	if !remove {
		if err = imageValid(cover); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		file, err := os.CreateTemp(filepath.Dir(target), ".nd-cover-*.jpg")
		if err != nil {
			http.Error(w, "cannot create temporary cover", 500)
			return
		}
		imagePath = file.Name()
		defer os.Remove(imagePath)
		if _, err = file.Write(cover); err != nil {
			file.Close()
			http.Error(w, "write failed", 500)
			return
		}
		file.Close()
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	if err = rewriteSong(target, map[string]string{}, imagePath, remove); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"ok": true, "message": "Embedded artwork updated. Rescan library to refresh artwork."})
}
func (s *Server) experimentalSongCoverUpload(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 11*1024*1024)
	f, _, err := r.FormFile("cover")
	if err != nil {
		http.Error(w, "cover file required", 400)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 10*1024*1024+1))
	if err != nil {
		http.Error(w, "read failed", 400)
		return
	}
	s.songCoverRewrite(w, r, data, false)
}
func (s *Server) experimentalSongCoverFromFolder(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	mf, err := s.editorSong(r)
	if err != nil {
		http.Error(w, "song not found", 404)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var body struct {
		Name string `json:"name"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "invalid filename", 400)
		return
	}
	if body.Name == "" || filepath.Base(body.Name) != body.Name || strings.ContainsAny(body.Name, "/\\") {
		http.Error(w, "invalid filename", 400)
		return
	}
	entries, err := folderImages(mf)
	if err != nil {
		http.Error(w, "folder unavailable", 500)
		return
	}
	allowed := false
	for _, name := range entries {
		if name == body.Name {
			allowed = true
			break
		}
	}
	if !allowed {
		http.Error(w, "image not listed in folder", 400)
		return
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(mf.AbsolutePath()), body.Name))
	if err != nil {
		http.Error(w, "cannot read cover", 500)
		return
	}
	s.songCoverRewrite(w, r, data, false)
}
func (s *Server) experimentalSongCoverRemove(w http.ResponseWriter, r *http.Request) {
	s.songCoverRewrite(w, r, nil, true)
}

// Avoid accidental media-file writes to a full music library without opt-in.

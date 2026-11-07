package server

// Unmatched-entry review applies only to entries newly added to an M3U file.
// Deletions on either side continue through the ordinary three-way comparison.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model/request"
)

type syncUnmatched struct {
	Path  string `json:"path"`
	Entry string `json:"entry"`
}
type syncIgnoredState struct {
	Ignored []string `json:"ignored"`
}

func syncIgnoredLocation(id string) string { return syncStateLocation(id) + ".ignored.json" }
func syncReadIgnored(id string) (map[string]bool, error) {
	out := map[string]bool{}
	raw, err := os.ReadFile(syncIgnoredLocation(id))
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	var x syncIgnoredState
	if err = json.Unmarshal(raw, &x); err != nil {
		return nil, err
	}
	for _, p := range x.Ignored {
		out[p] = true
	}
	return out, nil
}
func syncSaveIgnored(id string, items map[string]bool) error {
	paths := []string{}
	for p, ignored := range items {
		if ignored {
			paths = append(paths, p)
		}
	}
	// Stable serialized order is not required for correctness; the file is overwritten atomically.
	data, err := json.MarshalIndent(syncIgnoredState{Ignored: paths}, "", "  ")
	if err != nil {
		return err
	}
	dest := syncIgnoredLocation(id)
	if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return err
	}
	return atomicExperimentalWrite(dest, data)
}
func syncM3URawEntry(sourcePath, absolute string) string {
	relative, err := filepath.Rel(filepath.Dir(sourcePath), absolute)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}
func syncM3UStanza(source string, contents []byte, absolute string) string {
	lines := strings.Split(strings.ReplaceAll(string(contents), "\r\n", "\n"), "\n")
	for i, line := range lines {
		raw := strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if raw == "" || strings.HasPrefix(raw, "#") || strings.HasPrefix(raw, "/") || strings.Contains(raw, "://") {
			continue
		}
		if filepath.Clean(filepath.Join(filepath.Dir(source), filepath.FromSlash(raw))) != absolute {
			continue
		}
		if i > 0 && strings.HasPrefix(strings.TrimSpace(lines[i-1]), "#EXTINF:") {
			return lines[i-1] + "\n" + line
		}
		return line
	}
	return ""
}
func (s *Server) syncFindUnmatched(ctx context.Context, paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	candidates := []string{}
	for _, abs := range paths {
		rel, err := filepath.Rel(conf.Server.MusicFolder, abs)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, filepath.ToSlash(rel))
	}
	matches, err := s.ds.MediaFile().FindByPaths(ctx, candidates)
	if err != nil {
		return nil, err
	}
	found := map[string]bool{}
	for _, mf := range matches {
		if mf.Missing {
			continue
		}
		found[filepath.Clean(mf.AbsolutePath())] = true
		// The Navidrome index stores library-relative paths. For the
		// configured single music root, match the normalized relative path too.
		found[filepath.Clean(filepath.Join(conf.Server.MusicFolder, mf.Path))] = true
	}
	missing := []string{}
	for _, abs := range paths {
		if !found[filepath.Clean(abs)] {
			missing = append(missing, abs)
		}
	}
	return missing, nil
}
func syncWriteBackup(x *syncInspection, newData []byte) error {
	old, err := os.ReadFile(x.Path)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(old)
	if hex.EncodeToString(hash[:]) != x.FileHash {
		return fmt.Errorf("M3U changed; please preview again")
	}
	backup := x.Path + ".nd-backup-" + time.Now().UTC().Format("20060102T150405.000000000")
	if err = os.WriteFile(backup, old, 0600); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}
	if err = atomicExperimentalWrite(x.Path, newData); err != nil {
		return fmt.Errorf("M3U write failed (backup retained): %w", err)
	}
	return nil
}
func syncRewriteEntry(source string, data []byte, oldAbs, newEntry string, remove bool) ([]byte, error) {
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	idx := -1
	for i, line := range lines {
		raw := strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if raw == "" || strings.HasPrefix(raw, "#") || strings.HasPrefix(raw, "/") || strings.Contains(raw, "://") {
			continue
		}
		if filepath.Clean(filepath.Join(filepath.Dir(source), filepath.FromSlash(raw))) == oldAbs {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("M3U entry no longer exists")
	}
	if remove {
		lines = append(lines[:idx], lines[idx+1:]...)
		if idx > 0 && strings.HasPrefix(strings.TrimSpace(lines[idx-1]), "#EXTINF:") {
			lines = append(lines[:idx-1], lines[idx:]...)
		}
	} else {
		lines[idx] = newEntry
	}
	return []byte(strings.Join(lines, "\n")), nil
}
func (s *Server) experimentalSyncResolve(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		http.Error(w, "authentication required", 401)
		return
	}
	var body struct {
		Token     string `json:"token"`
		Path      string `json:"path"`
		Action    string `json:"action"`
		Candidate string `json:"candidate"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	x, err := s.syncInspect(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if x.Playlist.OwnerID != user.ID && !user.IsAdmin {
		http.Error(w, "not authorized", 403)
		return
	}
	if body.Token != x.Token {
		http.Error(w, "M3U changed; preview again", 409)
		return
	}
	found := false
	for _, item := range x.Unmatched {
		if item.Path == body.Path {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "this entry is not a newly added unmatched M3U track", 409)
		return
	}
	switch body.Action {
	case "ignore":
		items, err := syncReadIgnored(x.PlaylistID)
		if err == nil {
			items[body.Path] = true
			err = syncSaveIgnored(x.PlaylistID, items)
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	case "remove":
		changed, err := syncRewriteEntry(x.Playlist.Path, x.Content, body.Path, "", true)
		if err == nil {
			err = syncWriteBackup(x, changed)
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	case "locate":
		if body.Candidate == "" || filepath.IsAbs(body.Candidate) {
			http.Error(w, "select a library-relative song", 400)
			return
		}
		root, err := filepath.EvalSymlinks(conf.Server.MusicFolder)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		candidate := filepath.Clean(filepath.Join(root, filepath.FromSlash(body.Candidate)))
		rel, err := filepath.Rel(root, candidate)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			http.Error(w, "candidate outside music library", 400)
			return
		}
		real, err := filepath.EvalSymlinks(candidate)
		if err != nil || real != candidate {
			http.Error(w, "candidate missing or symbolic link", 400)
			return
		}
		missing, err := s.syncFindUnmatched(r.Context(), []string{candidate})
		if err != nil || len(missing) != 0 {
			http.Error(w, "selected file is not indexed by Navidrome", 400)
			return
		}
		newEntry := syncM3URawEntry(x.Playlist.Path, candidate)
		changed, err := syncRewriteEntry(x.Playlist.Path, x.Content, body.Path, newEntry, false)
		if err == nil {
			err = syncWriteBackup(x, changed)
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	default:
		http.Error(w, "invalid resolution action", 400)
		return
	}
	experimentalRespond(w, 200, map[string]any{"saved": true, "action": body.Action, "entry": body.Path})
}
func (s *Server) experimentalSyncBrowse(w http.ResponseWriter, r *http.Request) {
	user, ok := request.UserFrom(r.Context())
	if !ok || !user.IsAdmin {
		http.Error(w, "administrator required", 403)
		return
	}
	root, err := filepath.EvalSymlinks(conf.Server.MusicFolder)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	folder := r.URL.Query().Get("folder")
	if filepath.IsAbs(folder) {
		http.Error(w, "relative folder required", 400)
		return
	}
	dest := filepath.Clean(filepath.Join(root, filepath.FromSlash(folder)))
	rel, err := filepath.Rel(root, dest)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		http.Error(w, "outside music library", 400)
		return
	}
	real, err := filepath.EvalSymlinks(dest)
	if err != nil || real != dest {
		http.Error(w, "folder not found or symbolic link", 400)
		return
	}
	entries, err := os.ReadDir(dest)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	type item struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	folders := []item{}
	files := []item{}
	for _, entry := range entries {
		if len(folders)+len(files) >= 1000 {
			break
		}
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		path := filepath.ToSlash(filepath.Join(rel, entry.Name()))
		if entry.IsDir() {
			folders = append(folders, item{entry.Name(), path})
		} else if entry.Type().IsRegular() {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			switch ext {
			case ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".wma", ".aiff", ".ape":
				files = append(files, item{entry.Name(), path})
			}
		}
	}
	experimentalRespond(w, 200, map[string]any{"folder": rel, "folders": folders, "files": files})
}

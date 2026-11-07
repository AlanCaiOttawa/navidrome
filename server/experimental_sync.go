package server

// Experimental, explicit two-way playlist synchronization. It stores a canonical
// shared baseline and a byte-for-byte copy of each last accepted M3U in /data.
// It never merges concurrent edits silently. The user must explicitly choose
// which side to retain when the same playlist changed in both places.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

type syncBaseline struct {
	PlaylistID string   `json:"playlistId"`
	FileName   string   `json:"fileName"`
	Tracks     []string `json:"tracks"`
}

type syncInspection struct {
	FileName         string          `json:"fileName"`
	PlaylistID       string          `json:"playlistId"`
	FileTracks       []string        `json:"-"`
	DBTracks         []string        `json:"-"`
	FileHash         string          `json:"-"`
	DBHash           string          `json:"-"`
	Baseline         *syncBaseline   `json:"-"`
	Status           string          `json:"status"`
	FileCount        int             `json:"fileCount"`
	NavidromeCount   int             `json:"navidromeCount"`
	FileChanged      bool            `json:"fileChanged"`
	NavidromeChanged bool            `json:"navidromeChanged"`
	SnapshotExists   bool            `json:"snapshotExists"`
	Token            string          `json:"token"`
	Path             string          `json:"-"`
	Content          []byte          `json:"-"`
	Playlist         *model.Playlist `json:"-"`
	Unmatched        []syncUnmatched `json:"unmatched,omitempty"`
	IgnoredPaths     []string        `json:"-"`
}

func syncStateLocation(id string) string {
	h := sha256.Sum256([]byte(id))
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", "m3u-sync", hex.EncodeToString(h[:]))
}
func syncSum(parts []string) string {
	b, _ := json.Marshal(parts)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func readSyncBaseline(id string) (*syncBaseline, error) {
	b, err := os.ReadFile(syncStateLocation(id) + ".json")
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var x syncBaseline
	if err := json.Unmarshal(b, &x); err != nil {
		return nil, err
	}
	if x.PlaylistID != id {
		return nil, fmt.Errorf("snapshot identity mismatch")
	}
	return &x, nil
}
func saveSyncBaseline(id, fileName string, tracks []string, m3u []byte) error {
	dest := syncStateLocation(id)
	if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return err
	}
	// Saved reference copy: accessible even if a later edit deletes the source file.
	if err := atomicExperimentalWrite(dest+".m3u", m3u); err != nil {
		return err
	}
	b, err := json.MarshalIndent(syncBaseline{PlaylistID: id, FileName: fileName, Tracks: tracks}, "", "  ")
	if err != nil {
		return err
	}
	return atomicExperimentalWrite(dest+".json", b)
}
func atomicExperimentalWrite(target string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(target), ".ndsync-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), target)
}

// Resolve a playlist only inside the administrator-configured, writable M3U root.
// Never accept user-supplied filesystem paths.
func (s *Server) syncInspect(r *http.Request) (*syncInspection, error) {
	user, ok := request.UserFrom(r.Context())
	if !ok {
		return nil, fmt.Errorf("authentication required")
	}
	id := chi.URLParam(r, "id")
	pl, err := s.ds.Playlist().GetWithTracks(r.Context(), id, false, true)
	if err != nil {
		return nil, err
	}
	if pl.OwnerID != user.ID && !user.IsAdmin {
		return nil, fmt.Errorf("not playlist owner")
	}
	if pl.IsSmartPlaylist() || pl.Path == "" {
		return nil, fmt.Errorf("not a file-based playlist")
	}
	if pl.Sync {
		return nil, fmt.Errorf("disable Auto-import/Sync in playlist settings to enable editing and two-way synchronization")
	}
	if !strings.EqualFold(filepath.Ext(pl.Path), ".m3u") {
		return nil, fmt.Errorf("only .m3u files supported")
	}
	folder := filepath.Join(conf.Server.MusicFolder, filepath.FromSlash(conf.Server.PlaylistsPath))
	rel, err := filepath.Rel(filepath.Clean(folder), filepath.Clean(pl.Path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return nil, fmt.Errorf("playlist outside selected folder")
	}
	if strings.Contains(rel, string(os.PathSeparator)) {
		return nil, fmt.Errorf("nested playlist files not supported yet")
	}
	writeRoot := os.Getenv("ND_EXPERIMENTALM3UROOT")
	if !filepath.IsAbs(writeRoot) {
		return nil, fmt.Errorf("configure writable M3U Docker mapping")
	}
	rootInfo, err := os.Lstat(writeRoot)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("writeback root unavailable")
	}
	filePath := filepath.Join(writeRoot, rel)
	fileInfo, err := os.Lstat(filePath)
	if err != nil || !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("M3U file not found or unsafe")
	}
	fileData, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	if len(fileData) > 5*1024*1024 {
		return nil, fmt.Errorf("playlist too large")
	}
	fileTracks, err := syncParseM3U(pl.Path, fileData)
	if err != nil {
		return nil, err
	}
	ignored, err := syncReadIgnored(id)
	if err != nil {
		return nil, err
	}
	var included []string
	var ignoredPaths []string
	for _, path := range fileTracks {
		if ignored[path] {
			ignoredPaths = append(ignoredPaths, path)
		} else {
			included = append(included, path)
		}
	}
	fileTracks = included
	dbTracks := make([]string, 0, len(pl.Tracks))
	for _, t := range pl.Tracks {
		if t.MediaFile.ID == "" || t.MediaFile.AbsolutePath() == "" {
			return nil, fmt.Errorf("Navidrome playlist has missing tracks; synchronization blocked")
		}
		dbTracks = append(dbTracks, filepath.Clean(t.MediaFile.AbsolutePath()))
	}
	baseline, err := readSyncBaseline(id)
	if err != nil {
		return nil, err
	}
	if baseline != nil && baseline.FileName != filepath.Base(filePath) {
		return nil, fmt.Errorf("source filename changed since baseline; manual review required")
	}
	fileHash := sha256.Sum256(fileData)
	result := &syncInspection{FileName: filepath.Base(filePath), PlaylistID: id, FileTracks: fileTracks, DBTracks: dbTracks, FileHash: hex.EncodeToString(fileHash[:]), DBHash: syncSum(dbTracks), Baseline: baseline, Path: filePath, Content: fileData, Playlist: pl, FileCount: len(fileTracks), IgnoredPaths: ignoredPaths, NavidromeCount: len(dbTracks), SnapshotExists: baseline != nil}
	if baseline == nil {
		if slices.Equal(fileTracks, dbTracks) {
			result.Status = "initialize"
		} else {
			result.Status = "first-run-conflict"
		}
	} else {
		result.FileChanged = !slices.Equal(fileTracks, baseline.Tracks)
		result.NavidromeChanged = !slices.Equal(dbTracks, baseline.Tracks)
		switch {
		case slices.Equal(fileTracks, dbTracks):
			result.Status = "already-equal"
		case result.FileChanged && result.NavidromeChanged:
			result.Status = "conflict"
		case result.FileChanged:
			result.Status = "import-file"
		case result.NavidromeChanged:
			result.Status = "export-nav"
		default:
			result.Status = "already-equal"
		}
	}
	// A missing entry that was newly added to M3U is not a deletion conflict.
	// It must be resolved before an import or an unattended synchronization.
	missing, err := s.syncFindUnmatched(r.Context(), fileTracks)
	if err != nil {
		return nil, err
	}
	for _, path := range missing {
		if baseline != nil && slices.Contains(baseline.Tracks, path) {
			return nil, fmt.Errorf("previously synchronized track is unavailable: %s; resolve library availability separately", path)
		}
		result.Unmatched = append(result.Unmatched, syncUnmatched{Path: path, Entry: syncM3URawEntry(pl.Path, path)})
	}
	if len(result.Unmatched) > 0 {
		result.Status = "unmatched"
	}
	result.Token = syncSum([]string{id, result.FileHash, result.DBHash, result.Status, func() string {
		if baseline == nil {
			return ""
		}
		return syncSum(baseline.Tracks)
	}()})
	return result, nil
}
func syncParseM3U(sourcePath string, b []byte) ([]string, error) {
	// Only local paths; reject URLs, directives and paths outside the library.
	rootReal, err := filepath.EvalSymlinks(conf.Server.MusicFolder)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, line := range strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, "://") || strings.HasPrefix(line, "/") || strings.Contains(line, "\\") || strings.ContainsRune(line, 0) {
			return nil, fmt.Errorf("unsupported M3U path: %q", line)
		}
		absolute := filepath.Clean(filepath.Join(filepath.Dir(sourcePath), filepath.FromSlash(line)))
		relative, err := filepath.Rel(rootReal, absolute)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
			return nil, fmt.Errorf("M3U references file outside music library")
		}
		// Missing file entries are handled by the explicit unmatched-entry workflow.
		// Existing symlinks still must resolve inside the authorized music root.
		real, err := filepath.EvalSymlinks(absolute)
		if err == nil {
			relative, err = filepath.Rel(rootReal, real)
			if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
				return nil, fmt.Errorf("M3U symlink outside music library")
			}
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("cannot resolve M3U track %q: %w", line, err)
		}
		out = append(out, absolute)
	}
	return out, nil
}
func (s *Server) experimentalSyncPreview(w http.ResponseWriter, r *http.Request) {
	x, err := s.syncInspect(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	experimentalRespond(w, 200, x)
}
func (s *Server) experimentalSyncApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token  string `json:"token"`
		Choice string `json:"choice"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		http.Error(w, "expected token and choice", 400)
		return
	}
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	x, err := s.syncInspect(r)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if body.Token != x.Token {
		http.Error(w, "Playlist changed since preview; review again", 409)
		return
	}
	if len(x.Unmatched) > 0 {
		http.Error(w, "Resolve newly added unmatched M3U entries before syncing", http.StatusConflict)
		return
	}
	choice := body.Choice
	if choice != "file" && choice != "navidrome" && choice != "initialize" {
		http.Error(w, "invalid choice", 400)
		return
	}
	switch x.Status {
	case "initialize", "already-equal":
		if choice != "initialize" {
			http.Error(w, "choose Initialize baseline", 400)
			return
		}
		if err := saveSyncBaseline(x.PlaylistID, x.FileName, x.DBTracks, x.Content); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	case "import-file", "first-run-conflict", "conflict":
		if choice == "navidrome" && x.Status == "import-file" {
			http.Error(w, "file-only changes should be imported; review changed file first", 409)
			return
		}
		if choice == "file" {
			if err := s.syncImport(x, r.Context()); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}

		} else if choice == "navidrome" {
			if err := s.syncExport(x); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		} else {
			http.Error(w, "choose synchronization direction", 400)
			return
		}
	case "export-nav":
		if choice != "navidrome" {
			http.Error(w, "Navidrome has changes; choose export", 400)
			return
		}
		if err := s.syncExport(x); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	default:
		http.Error(w, "unsupported synchronization state", 400)
		return
	}
	experimentalRespond(w, 200, map[string]any{"saved": true, "status": x.Status, "direction": choice})
}

func (s *Server) syncImport(x *syncInspection, ctx context.Context) error {
	if len(x.Unmatched) > 0 {
		return fmt.Errorf("unmatched M3U entries require review")
	}
	// The database stores paths relative to the music root; an M3U resolves
	// to absolute paths. Supply both formats and validate by the absolute path.
	searchPaths := make([]string, 0, len(x.FileTracks)*2)
	for _, abs := range x.FileTracks {
		searchPaths = append(searchPaths, abs)
		if rel, e := filepath.Rel(conf.Server.MusicFolder, abs); e == nil {
			searchPaths = append(searchPaths, filepath.ToSlash(rel))
		}
	}
	matches, err := s.ds.MediaFile().FindByPaths(ctx, searchPaths)
	if err != nil {
		return err
	}
	byPath := map[string]model.MediaFile{}
	for _, mf := range matches {
		byPath[filepath.Clean(mf.AbsolutePath())] = mf
		byPath[filepath.Clean(filepath.Join(conf.Server.MusicFolder, mf.Path))] = mf
	}
	ordered := model.MediaFiles{}
	for _, path := range x.FileTracks {
		mf, ok := byPath[path]
		if !ok {
			return fmt.Errorf("M3U track not found in Navidrome index: %s", path)
		}
		ordered = append(ordered, mf)
	}
	x.Playlist.SetTracks(nil)
	x.Playlist.AddMediaFiles(ordered)
	if err := s.ds.Playlist().Put(ctx, x.Playlist); err != nil {
		return err
	}
	return saveSyncBaseline(x.PlaylistID, x.FileName, x.FileTracks, x.Content)
}

func (s *Server) syncExport(x *syncInspection) error {
	latest, err := os.ReadFile(x.Path)
	if err != nil {
		return err
	}
	checksum := sha256.Sum256(latest)
	if hex.EncodeToString(checksum[:]) != x.FileHash {
		return fmt.Errorf("M3U file changed since inspection; writing blocked")
	}
	generated := []byte(exportM3URelative(x.Playlist.Path, x.Playlist.Name, x.Playlist.MediaFiles()))
	// Keep explicitly ignored M3U entries when exporting Navidrome changes.
	// The ignored original stanza is copied verbatim instead of being deleted.
	if len(x.IgnoredPaths) > 0 {
		for _, ignored := range x.IgnoredPaths {
			// Avoid duplicating an entry the user independently added to Navidrome.
			if slices.Contains(x.DBTracks, ignored) {
				continue
			}
			stanza := syncM3UStanza(x.Playlist.Path, x.Content, ignored)
			if stanza == "" {
				return fmt.Errorf("cannot preserve ignored M3U entry: %s", ignored)
			}
			generated = append(generated, []byte("\n"+stanza+"\n")...)
		}
	}
	// Backup *every* write, including when a user resolves a conflict.
	stamp := time.Now().UTC().Format("20060102T150405.000000000")
	backup := x.Path + ".nd-backup-" + stamp
	if err := os.WriteFile(backup, x.Content, 0600); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}
	if err := atomicExperimentalWrite(x.Path, generated); err != nil {
		return fmt.Errorf("M3U write failed; backup retained: %w", err)
	}
	return saveSyncBaseline(x.PlaylistID, x.FileName, x.DBTracks, generated)
}

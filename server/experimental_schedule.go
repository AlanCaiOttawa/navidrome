package server

// Experimental scheduled M3U synchronization. The runner is server-side so it
// works in either Docker Desktop or Synology Container Manager. It never
// resolves conflicts or first-run mismatches without the user's choice.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
)

type experimentalSchedule struct {
	Enabled  bool   `json:"enabled"`
	Time     string `json:"time"`
	Timezone string `json:"timezone"`
}

type experimentalSyncOutcome struct {
	FileName string `json:"fileName"`
	Action   string `json:"action"`
	Detail   string `json:"detail,omitempty"`
}

type experimentalSyncRun struct {
	Date       string                    `json:"date"`
	StartedAt  time.Time                 `json:"startedAt"`
	FinishedAt time.Time                 `json:"finishedAt"`
	Applied    int                       `json:"applied"`
	Skipped    int                       `json:"skipped"`
	Outcomes   []experimentalSyncOutcome `json:"outcomes"`
}

func experimentalSchedulePath() string {
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", "nightly-sync.json")
}
func experimentalRunPath() string {
	return filepath.Join(conf.Server.DataFolder.String(), "experimental", "nightly-sync-last-run.json")
}
func loadExperimentalSchedule() (experimentalSchedule, error) {
	cfg := experimentalSchedule{Time: "00:00", Timezone: "America/Toronto"}
	b, err := os.ReadFile(experimentalSchedulePath())
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	if err := validateExperimentalSchedule(cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

var experimentalTimePattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

func validateExperimentalSchedule(cfg experimentalSchedule) error {
	if !experimentalTimePattern.MatchString(cfg.Time) {
		return fmt.Errorf("time must be HH:MM in 24-hour format")
	}
	if cfg.Timezone != "America/Toronto" {
		return fmt.Errorf("timezone must be America/Toronto")
	}
	return nil
}
func loadExperimentalRun() (*experimentalSyncRun, error) {
	b, err := os.ReadFile(experimentalRunPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var run experimentalSyncRun
	if err := json.Unmarshal(b, &run); err != nil {
		return nil, err
	}
	return &run, nil
}
func (s *Server) experimentalScheduleSettings(w http.ResponseWriter, r *http.Request) {
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
	if r.Method == http.MethodGet {
		cfg, err := loadExperimentalSchedule()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		last, err := loadExperimentalRun()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		experimentalRespond(w, 200, map[string]any{"schedule": cfg, "lastRun": last})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var cfg experimentalSchedule
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "invalid settings", 400)
		return
	}
	if err := validateExperimentalSchedule(cfg); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	p := experimentalSchedulePath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := atomicExperimentalWrite(p, b); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	experimentalRespond(w, 200, map[string]any{"schedule": cfg, "saved": true})
}

func (s *Server) experimentalScheduler(ctx context.Context) {
	// A run is due only after the configured local clock time. If the machine
	// was asleep or the server was stopped, the first tick catches up once.
	timer := time.NewTicker(30 * time.Second)
	defer timer.Stop()
	s.maybeRunExperimentalSchedule(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.maybeRunExperimentalSchedule(ctx)
		}
	}
}

func (s *Server) maybeRunExperimentalSchedule(ctx context.Context) {
	experimentalMu.Lock()
	defer experimentalMu.Unlock()
	cfg, err := loadExperimentalSchedule()
	if err != nil || !cfg.Enabled {
		return
	}
	loc, err := time.LoadLocation(cfg.Timezone)
	if err != nil {
		return
	}
	now := time.Now().In(loc)
	today := now.Format("2006-01-02")
	if now.Format("15:04") < cfg.Time {
		return
	}
	last, err := loadExperimentalRun()
	if err != nil {
		return
	}
	if last != nil && last.Date == today {
		return
	}
	// Mark the run before work, so crashes do not cause repeated unobserved writes.
	run := experimentalSyncRun{Date: today, StartedAt: time.Now().UTC(), Outcomes: []experimentalSyncOutcome{}}
	if err := saveExperimentalRun(run); err != nil {
		return
	}
	s.runExperimentalNightly(ctx, &run)
	run.FinishedAt = time.Now().UTC()
	_ = saveExperimentalRun(run)
}
func saveExperimentalRun(run experimentalSyncRun) error {
	p := experimentalRunPath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return err
	}
	return atomicExperimentalWrite(p, b)
}
func (s *Server) runExperimentalNightly(ctx context.Context, run *experimentalSyncRun) {
	folder := filepath.Join(conf.Server.MusicFolder, filepath.FromSlash(conf.Server.PlaylistsPath))
	entries, err := os.ReadDir(folder)
	if err != nil {
		run.Skipped++
		run.Outcomes = append(run.Outcomes, experimentalSyncOutcome{Action: "error", Detail: err.Error()})
		return
	}
	if len(entries) > 5000 {
		run.Skipped++
		run.Outcomes = append(run.Outcomes, experimentalSyncOutcome{Action: "error", Detail: "too many folder entries; manual review required"})
		return
	}
	for _, entry := range entries {
		if ctx.Err() != nil {
			return
		}
		if !entry.Type().IsRegular() || !strings.EqualFold(filepath.Ext(entry.Name()), ".m3u") {
			continue
		}
		name := entry.Name()
		outcome := experimentalSyncOutcome{FileName: name, Action: "skipped"}
		// Resolve only file-backed playlists, using the same path Navidrome's scanner sees.
		pl, err := s.ds.Playlist().FindByPath(ctx, filepath.Join(folder, name))
		if err != nil || pl == nil {
			outcome.Detail = "not linked to a Navidrome playlist"
		} else if pl.Sync {
			outcome.Detail = "native Auto-import enabled; enable editing / two-way sync first"
		} else {
			// The inspector expects an authenticated request and a Chi ID param.
			// Use the playlist owner's identity without requiring an HTTP login.
			rc := chi.NewRouteContext()
			rc.URLParams.Add("id", pl.ID)
			inner := request.WithUser(ctx, model.User{ID: pl.OwnerID, IsAdmin: true})
			inner = context.WithValue(inner, chi.RouteCtxKey, rc)
			req, _ := http.NewRequestWithContext(inner, http.MethodGet, "/internal/sync", nil)
			x, inspectErr := s.syncInspect(req)
			if inspectErr != nil {
				outcome.Detail = inspectErr.Error()
			} else {
				switch x.Status {
				case "initialize", "already-equal":
					// New baseline only when both playlists are identical.
					if err := saveSyncBaseline(x.PlaylistID, x.FileName, x.DBTracks, x.Content); err != nil {
						outcome.Detail = err.Error()
					} else {
						outcome.Action = "baseline"
					}
				case "import-file":
					if len(x.FileTracks) == 0 {
						outcome.Detail = "empty M3U needs manual review"
						break
					}
					if err := s.syncImport(x, inner); err != nil {
						outcome.Detail = err.Error()
					} else {
						outcome.Action = "imported"
					}
				case "export-nav":
					if len(x.DBTracks) == 0 {
						outcome.Detail = "empty Navidrome playlist needs manual review"
						break
					}
					// Re-read file just before writing; no unattended overwrite of external edits.
					current, err := os.ReadFile(x.Path)
					if err != nil {
						outcome.Detail = err.Error()
					} else {
						hash := sha256.Sum256(current)
						if hex.EncodeToString(hash[:]) != x.FileHash {
							outcome.Detail = "M3U changed during sync"
						} else if err := s.syncExport(x); err != nil {
							outcome.Detail = err.Error()
						} else {
							outcome.Action = "exported"
						}
					}
				default:
					outcome.Detail = "conflict or first-run mismatch; manual review required"
				}
			}
		}
		if outcome.Action == "skipped" {
			run.Skipped++
		} else {
			run.Applied++
		}
		run.Outcomes = append(run.Outcomes, outcome)
		// Persist incremental progress, including conflicts, for crash recovery/reporting.
		_ = saveExperimentalRun(*run)
	}
}

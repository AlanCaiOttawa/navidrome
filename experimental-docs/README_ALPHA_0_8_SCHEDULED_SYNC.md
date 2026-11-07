# Navidrome Custom Alpha 0.8: scheduled safe M3U synchronization

This experimental fork extends Alpha 0.7.1 with a Navidrome backend scheduler and a settings card in **M3U Playlist Sync**.

## Administrator settings

Open M3U Playlist Sync and use the **Automatic two-way synchronization** card:
- Enable/disable auto synchronization.
- Set a daily time using the HH:MM (24-hour) input. Default **00:00**.
- Timezone is **America/Toronto** (automatically switches EST/EDT).
- Select **Save schedule**. Default is **disabled** until you explicitly enable it.
- The page displays the last attempted automatic run and each file's outcome.

The server checks every 30 seconds; a due job runs once per local calendar day. When Navidrome was offline at the scheduled time, the job catches up on the next startup **if the scheduled time has already passed that day**. It cannot run when the Docker container is off. The runner and settings survive container restarts as long as `/data` persists.

## Safety policy

- Only `.m3u` files **directly inside the active configured playlist folder** are processed (no nested folders, no `.m3u8` for automatic writeback).
- Imported playlists must first be made editable: click **Enable Editing** on that playlist; this turns off the stock one-way Auto-import flag.
- An existing baseline is compared against both the M3U and the Navidrome track list (including order).
- One-sided M3U changes are imported. One-sided Navidrome changes are exported to M3U with a timestamped backup.
- Matching playlists can get an initial baseline without changes. **First-run mismatches, concurrent edits, missing tracks, missing source files, empty playlists, unlinked playlists, and Auto-import-locked playlists are skipped**, not overwritten.
- Results are stored in `/data/experimental/nightly-sync-last-run.json` and backups/baselines under `/data/experimental/m3u-sync`.
- Only one server instance should use the same `/data` and M3U write directory; this code does not provide distributed locking.
- Backend writes are atomic within the same filesystem and recheck the source-file hash immediately before export. The implementation has not been tested against simultaneous external writes on a network filesystem.
- The scheduler does not automatically merge concurrent changes, infer deletions, or discover new unlinked playlists; use Navidrome's normal scanner for initial M3U import.

## Windows test installation

1. Back up `C:\Navidrome-Test\experimental-docs\navidrome-data` and `C:\Music\Playlist`.
2. Extract the complete source to `C:\Navidrome-Test` (preserve your existing compose file and database).
3. Run in PowerShell:

   ```powershell
   cd C:\Navidrome-Test
   docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
   ```
4. Open http://localhost:4534 then **M3U Playlist Sync**.
5. Use a test M3U, not your live Synology folder. Make sure that **Enable Editing** has been applied to an imported playlist. Use manual **Preview two-way sync** to create an initial matching baseline.
6. Set Auto-sync **On**, choose a time a few minutes into the future, and save. Leave Docker running. Refresh the status after the scheduled time.
7. Test single-sided changes on copies of playlists; then test editing both sides and confirm the scheduler skips the conflict.
8. Confirm `.nd-backup-...` appears before any M3U write. Check last-run details.

## Verification status

Go formatting and frontend JS/JSX parsing were checked. **Full Go 1.27 compilation, Docker build, and live scheduled-sync execution were not available in the authoring environment.** Do not run unattended against your actual Synology playlist folder until these tests pass.

## Files added/changed

- `server/experimental_schedule.go`: settings API, persistent run records, safe daily runner.
- `server/experimental_sync.go`: reusable import logic and pre-export file-integrity check.
- `server/experimental.go`, `server/server.go`: API routes and scheduler lifecycle.
- `ui/src/experimental/api.js`, `ui/src/experimental/M3USync.jsx`: settings and status UI.
- `Dockerfile`: installs timezone database for local scheduling.

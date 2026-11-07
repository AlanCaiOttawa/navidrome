# Navidrome custom Alpha 0.7 — experimental M3U three-way sync

## Improvements

- **Enable editing / two-way sync** on an auto-imported M3U playlist. This sets the native playlist `sync=false`, revealing Navidrome's existing song-selection checkboxes upon page reload. The original one-way scanner no longer controls this playlist until Sync is re-enabled.
- **Sync entire M3U folder ↔ Navidrome** previews each linked, editable `.m3u` playlist. **Apply safe changes** runs only operations where there are no simultaneous changes since the baseline. Conflicts are left untouched and can be resolved individually.
- **Baseline copy** and ordered track path snapshot are stored in `/data/experimental/m3u-sync/`. The baseline M3U is retained as `.m3u` with the same hashed prefix as `.json`.
- **First sync:** if M3U and Navidrome match exactly, a baseline can be initialized without modifying either; if different, the user must choose the version to keep.
- **Subsequent sync:** compare ordered paths from the live M3U, the Navidrome playlist and the stored baseline. M3U-only change imports into Navidrome; Navidrome-only change writes M3U; both changed prompts which side to keep, never automatic destructive merging.
- Every M3U rewrite produces a timestamped `.nd-backup-...` copy. Sync previews issue a token checked again on application, rejecting stale previews.

## Important limits

- **No full Docker build or runtime validation was performed in this environment** (upstream requires Go 1.27, not installed here). This is experimental source, not a verified release.
- Only flat `.m3u` files from the selected Playlist folder are currently supported for three-way sync; `.m3u8` files still work with native import but are not included in two-way sync.
- All M3U file paths must be relative local paths resolving to readable, indexed media within the music library. Missing tracks or paths outside the library block sync; no partial import.
- No automatic scheduled sync, automatic merging of concurrent edits, or deletion of entire playlist files. The folder-wide button is a **manual review and apply** process.
- `Enable editing` switches off the original Navidrome auto-import flag for the selected playlist. Regular Navidrome scans will no longer update it until you manually synchronize or re-enable Auto-import. Do not re-enable Auto-import while using this experimental baseline-based sync mode.
- Changes made to playlists outside of this experimental sync UI are reflected by the next preview. Back up the playlist folder and the `/data` folder before testing.

## Local Windows test

1. Copy your test M3U file into `C:\Music\Playlist`; leave the actual Synology M3U folder disconnected for the first tests.
2. Keep your Windows Compose mapping: `C:/Music:/music:ro`, `C:/Music/Playlist:/music/Playlist:rw`, `C:/Music/Playlist:/m3u-write:rw`, plus `/data`.
3. From `C:\Navidrome-Test`, execute `docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate`.
4. Visit `http://localhost:4534`. Import the M3U, open **M3U Playlist Sync** and choose **Enable editing / two-way sync** on its file card.
5. Reload the imported playlist; the standard selection checkboxes should now appear. Return to **M3U Playlist Sync**, click **Sync entire M3U folder ↔ Navidrome**, and initialize the common baseline.
6. Delete a song in Navidrome, then preview the sync again. Expect `export-nav`. Apply safe changes. Verify M3U has fewer songs and a `.nd-backup-...` file was created.
7. Modify the M3U in a text editor, preview sync, expect `import-file`, and apply. Verify the Navidrome song order is updated.
8. Make *different* changes on both sides before syncing; expect `conflict`, which must be explicitly resolved per playlist. Confirm `Cancel` leaves both unchanged.
9. Restart Docker to ensure snapshot state persists in `/data`.

## Explicit UI distinction

`Import from M3U Folder` still invokes the native scanner (one-way); use `Sync entire M3U folder ↔ Navidrome` for comparison with saved baselines. The latter requires editable playlists.

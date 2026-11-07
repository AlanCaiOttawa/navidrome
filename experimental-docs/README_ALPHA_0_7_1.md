# Navidrome Alpha 0.7.1 — Imported playlist editing fix

## What changed
The imported Playlist detail page now has an explicit **Enable Editing (M3U Playlist)** action for file-backed playlists while native `sync` is still enabled. It opens a confirmation dialog, uses the Navidrome playlist REST API to set `sync=false`, reads the playlist back to verify that setting was persisted, and reloads the page. After this, the ordinary song checkboxes and reordering controls are enabled, subject to playlist ownership permissions.

## Why the checkboxes were missing
Navidrome's `canChangeTracks()` only returns true if the current user can write the playlist, it is not a smart playlist, and `sync=false`. Alpha 0.7 put the toggle only in the M3U Sync page, not in the Playlist detail page.

## Important safety behavior
Enabling editing does NOT immediately write anything to the source M3U file. It disables Navidrome's native M3U auto-import for this particular playlist. Reconcile later file and Navidrome edits using **M3U Playlist Sync**. Do not enable native Auto-import again until changes have been reconciled. Keep backups of both the /data directory and M3U files.

## Local Windows instructions
Extract the full ZIP into `C:\Navidrome-Test` and preserve your existing `experimental-docs/docker-compose.windows-test.yml` and `experimental-docs/navidrome-data` database folder. From PowerShell:

```powershell
cd C:\Navidrome-Test
docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
```

Open http://localhost:4534, choose the imported playlist, click **Enable Editing (M3U Playlist)**, confirm, and wait for the automatic reload. Check that the row-selection checkboxes appear. If they do not, verify playlist ownership and the `sync` flag under the native Edit Playlist dialog.

## Validation
JSX syntax parsed using the TypeScript parser. No full Docker build/runtime verification was possible in the build environment.

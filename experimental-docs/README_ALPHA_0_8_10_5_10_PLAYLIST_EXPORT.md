# Alpha 0.8.10.5.10 — Per-playlist M3U download

## Change

In Playlist Setting > Automatic Playlist Sorting, each playlist has an independent **Export M3U** button. The export uses that playlist's current Navidrome track order (whether auto-sort is enabled or not), with the same extended M3U and Synology relative-path format as Catalogue export. Supports ordinary, imported, and smart playlists to the extent currently resolvable by Navidrome.

The backend GET `/api/experimental/playlist-export-m3u/{id}` loads the playlist and its ordered tracks, verifies requester ownership or administrator status, verifies each song's library path, and uses the common `exportM3URelative` helper. The endpoint returns JSON `content`, `filename`, `count`, `skipped` and never writes the NAS filesystem. The browser uses a UTF-8 BOM to preserve Chinese names and offers a downloaded `.m3u` file. Place the file under the configured Synology `Playlist` directory for the relative paths to work; the app does not put the file there automatically. Missing/unavailable songs are excluded by the playlist query.

## Upgrade

Apply changed-files ZIP over Alpha 0.8.10.5.9 in the existing GitHub working tree (do not overwrite `.git`). Build image `navidrome-custom:0.8.10.5.10`, test in Docker, import TAR into Synology and redeploy after backing up `/data`. The new endpoint has no database migration and needs no writable music mount.

## Scope

This update adds per-playlist M3U download only. It does **not** change the nightly sort-vs-sync order from Alpha 0.8.10.5.9. That earlier separate request remains to be addressed safely in a subsequent change, because sort-before-sync needs conflict-baseline handling.

## Verification

Static Go formatting and JS syntax check, ZIP integrity; no full Go 1.27 build/NAS runtime test in this environment.

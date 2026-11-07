# Navidrome Custom Alpha 0.6 — Windows test

This is **source code**, not a prebuilt image. It has not passed a full Go/Docker build. Test against a COPY of your M3U folder.

## Changes
- Corrected scan import invocation: `subsonic` is a default export. Previously calling the nonexistent named export caused `(void 0) is not a function`, even when the playlist was already imported.
- Recently Played Albums and Playlists now attempt to fetch artwork using the same `Artwork` component as the Navidrome library. For playlists, Navidrome's built-in cover-art fallback applies when no custom image exists.
- Collection folder list now derives additional folder-to-album relationships from indexed media file FolderIDs and shows indexed subfolders even when no matching album has been found. An empty folder cannot add albums.
- M3U Sync: detects linked Navidrome playlists. `Import from M3U Folder` performs the one-way native scan. Editable source-linked playlists (`Sync=false`) offer `Preview Navidrome -> M3U writeback`, followed by explicit `Save to M3U`. This reuses Alpha's expected-source SHA256 check and file backup. Writeback requires `/m3u-write:rw` configured and does **not** work for Sync-enabled playlists (disable auto-import first).

## Still not implemented
Automatic bilateral sync, persisted three-way baseline, automatic merging, scheduling and cross-side deletion handling. Do **not** treat this build as equivalent to the Swing Music folder-sync engine.

## Install
Extract the entire zip to your local test source folder, retaining or separately restoring your local experimental-docs/docker-compose.windows-test.yml and existing `navidrome-data` directory. Back up `C:/Music/Playlist` before writeback testing.

In PowerShell from the extracted source directory:

    docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate

Then visit http://localhost:4534 and select `M3U Playlist Sync` in the left sidebar.

For diagnostic errors:

    docker compose -f experimental-docs/docker-compose.windows-test.yml logs --tail=150

## Validation
- JS/JSX parse/transpile diagnostics: no syntax errors in modified files using TypeScript transpileModule.
- Go file formatted with gofmt.
- No Go build or integration test: the sandbox has Go 1.23, but this repository requires Go 1.27 and network download is unavailable.

# Navidrome Custom Alpha 0.4 — Windows local test

## What changed since 0.3

- Album/Playlist **Resume**, **Play from beginning**, and **Cancel** are explicit Material UI dialog buttons. The dialog only appears when an incomplete progress record exists; on first play playback begins immediately.
- Album three-dot menu has a native **Add album to collection** selector with an option to create a collection.
- The album three-dot menu also offers **Add entire music folder to Collection**, with an indexed folder dropdown. The folder includes its subfolders and all albums indexed under it.
- New expandable **Collections** sidebar lists each collection and its album count; click to view covers. Existing Collections page also contains a folder selector.
- New sidebar **M3U Playlist Sync** points to a **read-only folder inventory**. It reports the M3U files in the active playlist directory and track-line counts.

## Not implemented (important)

The Swing Music **three-way, folder-wide, two-way reconciliation** is **NOT yet ported**. No automatic Navidrome-to-M3U writeback, baseline comparisons, automated conflict merge, or nightly sync exists in this Alpha. Navidrome's standard M3U import remains available. The existing per-playlist *Save to M3U* path is still manual, requires the matching playlist's auto-sync to be disabled, and makes a backup. Do not test writeback on your only copy of NAS playlists.

## Windows test instructions

1. Stop the existing test container and back up its `experimental-docs/navidrome-data` directory, which holds Collections and playback information.
2. Extract the *complete Alpha 0.4 source zip* in `C:\Navidrome-Test`, replacing old source files but **preserving your navidrome-data folder**.
3. Verify Windows paths in `experimental-docs/docker-compose.windows-test.yml`:
   - `C:/Music:/music:ro`
   - `C:/Music/Playlist:/music/Playlist:rw`
   - `C:/Music/Playlist:/m3u-write:rw`
   - `ND_PLAYLISTSPATH: "Playlist"`
4. With Docker Desktop running, execute:

```powershell
cd C:\Navidrome-Test
docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
```

5. Visit `http://localhost:4534`. If there is a build or runtime error, use:

```powershell
docker compose -f experimental-docs/docker-compose.windows-test.yml logs --tail=120
```

## Verification caveats

JS/JSX syntax was checked and Go code formatted. A full Go compilation, browser-level interaction test and Docker build **were not run** in the authoring environment; the source requires downloading Go 1.27 and this environment lacks that network access. This version is **experimental source**, not a verified ready-to-run binary.

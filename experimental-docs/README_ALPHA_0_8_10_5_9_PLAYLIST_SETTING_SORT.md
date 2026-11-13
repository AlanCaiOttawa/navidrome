# Navidrome Custom Alpha 0.8.10.5.9 — Playlist Setting and Auto Sort

## Navigation

* Renames **M3U Playlist Sync** to **Playlist Setting** without changing the `/m3u-sync` route.
* Places Playlist Setting immediately before the Playlist entry/submenu in the left navigation.

## Per-playlist automatic ordering

Under **Playlist Setting → Automatic Playlist Sorting**, each editable playlist has its own switch and ordering criterion:

* Song title (A → Z)
* Artist (A → Z)
* Album (A → Z)

Each rule is saved independently to `/data/experimental/playlist-sort.json`. Use **Save** for an individual playlist, or **Sort now** to test the saved rule. Sorting is stable when the chosen field is identical, preserving the prior relative order of tied songs. No tracks are added or removed.

## Nightly operation and synchronization safeguards

The server uses the existing **Automatic two-way synchronization** scheduler. You must enable and save that nightly schedule to activate unattended sorting.

1. The nightly job first completes its existing safe, conflict-aware M3U synchronization.
2. Afterward, it applies each enabled playlist sort rule separately.
3. Ordinary editable playlists are reordered inside Navidrome.
4. M3U-backed editable playlists are reordered **only when the M3U and Navidrome tracks are already synchronized**. The server then exports the new order to the source M3U, creating an `.nd-backup-*` file, and updates the sync baseline.
5. M3U conflicts, first-run mismatches, missing or read-only M3U roots, native auto-import playlists and smart playlists are skipped; reasons appear in the nightly run report.

**Never** use Auto sort to bypass a detected two-way-sync conflict. Resolve the conflict on the Playlist Setting page and enable editing for a native auto-import playlist before enabling its sort rule.

Rules are globally configured by the Navidrome administrator; actual playlist edits honor the existing playlist-owner context. Do not remove the `/data` volume on upgrades.

## Files changed

* `ui/src/layout/Menu.jsx`
* `ui/src/experimental/M3USync.jsx`
* `ui/src/experimental/api.js`
* `server/experimental.go`
* `server/experimental_schedule.go`
* `server/experimental_playlist_sort.go` (new)

## Upgrade and testing

Apply the **Changed Files ZIP** to the local GitHub repository **based on Alpha 0.8.10.5.8**. Do not overwrite `.git` or extract the full source archive over your Git checkout. Build the new Docker image using `--platform linux/amd64`, test with a non-critical playlist, and preserve `/data` and all original M3Us before deployment.

Suggested manual verification:

* Playlist Setting is immediately above Playlists in the sidebar.
* Enable sorting on one playlist while leaving a second playlist disabled.
* Select title for the first playlist and artist for a third; save both.
* Click Sort now and verify ordering, duplicate song retention and ties.
* Run nighttime sync, verify sorting runs afterward and that a linked M3U has an automatic backup and matching new order.
* Verify conflicts and smart/native auto-import playlists remain protected.

Validation status: Go source has been formatted and syntax-parsed by `gofmt`; JavaScript/JSX static transpilation has been checked. Full Docker build and real NAS operation have not been verified in this environment.

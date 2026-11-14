# Alpha 0.8.10.5.12 — Playlist Sort Now persistence and view refresh

This diagnostic/hardening update is based on Alpha 0.8.10.5.11.

- After writing a sorted playlist, reload **all tracks** from persistent storage and verify every track ID at every position. Errors are surfaced instead of reporting a false success.
- After Sort now, tell the user how many tracks were re-read and show the romanized keys of the first and last artists. The result is drawn from a fresh server read.
- Invalidate React-Admin list caches when Sort now completes. If another browser tab is already showing the playlist, refresh that tab too.
- Add an automated Go regression test for a Chinese-artist list including tracks that were originally at the end. This test requires the project's Go toolchain; it has not been executed in the packaging environment.

This update does not change the nightly sync/sort order, does not change any actual sort rule, and does not bypass M3U safety checks. It cannot guarantee that an older already-open client will refresh automatically; use a browser refresh in such clients.

## Diagnosis after deployment

1. Set an editable playlist to Artist / Ascending, click Save, then Sort now.
2. Inspect the message under Playlist Setting: it should say `Server verified N tracks` and show the first/last artist keys.
3. Open the playlist **after refreshing the browser page**, then check first and last pages.
4. If the order still looks wrong, export its M3U from Playlist Setting and check the order of the file independently; report the Sort now status and the exported file so sorting versus client display can be distinguished.

Back up `/data` and Synology's `Playlist` directory before upgrading.

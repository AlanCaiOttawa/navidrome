# Alpha 0.8.10.5.13 — Playlist M3U synchronization warnings

Base: Alpha 0.8.10.5.12.

## Changes
- On the main **Playlists** list, a new `M3U Sync` column displays status for linked, editable M3U playlists (e.g. `M3U conflict`, `M3U unmatched tracks`, or `M3U has changes`). The conflict indicator links to **Playlist Setting**.
- On an individual Playlist page, a warning panel appears when the synchronization preview detects a conflict or pending synchronization. A button opens **Playlist Setting** and another rechecks the status.
- The status is **read-only** and uses the pre-existing `GET /api/experimental/m3u-sync/{id}` endpoint. Neither the list nor the warning writes or resolves any differences automatically.
- Requests for visible rows are throttled to at most three concurrently and briefly cached (30 seconds); returning focus to the browser rechecks statuses. A failed check is not treated as a healthy playlist.

## Important
- The preview endpoint requires the playlist to be linked to a source M3U, Auto-import disabled, and appropriate ownership or administrator access. Playlists that cannot be inspected show `Sync check unavailable` rather than silently claiming the playlist is synchronized. Smart playlists and ordinary Navidrome playlists without a source M3U do not display an M3U status.
- Only *visible page rows* are examined. The Playlist Setting page remains the authority for choosing the synchronization direction; do not resolve conflicts until the two sets of tracks have been reviewed/backed up.
- There is no change to the M3U synchronization algorithm, music tags, persistent database schema, or Docker mounts.

## Test checklist
1. Open Playlists and locate an imported, editable M3U playlist with a known conflict. Check for `M3U conflict` on the corresponding row.
2. Open that playlist. Verify the alert appears with a link to Playlist Setting.
3. Open Playlist Setting, choose and apply the intended conflict resolution after backup. Return to Playlists and use Recheck / refocus; the warning should clear.
4. Verify regular playlists and smart playlists remain unaffected.
5. Verify a failed preview produces `Sync check unavailable`, not `M3U in sync`.
6. Confirm list browsing and the original two-way synchronization continue to work.

## Deployment
Apply the Changed Files ZIP to the branch containing Alpha 0.8.10.5.12. Preserve the folder structure. Build and test on Windows Docker before deploying to the NAS. Keep `/data` and the original Synology Playlist folder backed up.

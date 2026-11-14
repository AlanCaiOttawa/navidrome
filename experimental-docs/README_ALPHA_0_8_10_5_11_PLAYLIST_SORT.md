# Navidrome Custom Alpha 0.8.10.5.11 — Playlist sorting correction

Based on Alpha 0.8.10.5.10. No music file changes and no database migration.

## Changes

- Use the **same Chinese-to-pinyin dictionary** as Catalogue and Collections to sort every track in a playlist. Chinese names and Latin artist names share one alphabetic order; newly added tracks are not automatically preserved at the end when Sort now or nightly sorting runs.
- Per-playlist sort direction: **Ascending (A–Z)** and **Descending (Z–A)**; applies to Title, Artist, or Album. Existing saved rules without `direction` default to ascending.
- Bulk controls in Playlist Setting: choose Title, Artist, or Album and ascending/descending; **Apply to all** enables the chosen rule for all editable playlists after confirmation. Each individual playlist can still override or turn off automatic sorting afterwards.
- Bulk settings only save preferences, they **do not immediately reorder every playlist**. To apply now, use that playlist's Sort now after its rule is saved. Nightly jobs still use the existing saved schedule.
- Smart playlists and locked auto-import playlists remain protected; bulk updates skip them. For file-backed editable M3U playlists, the existing sync-consistency check, backup, and rollback protections still apply.

## Build from GitHub Desktop

Create `feature/update-0.8.10.5.11` from the branch that has 0.8.10.5.10, extract only Changed Files ZIP into `C:\Navidrome-Github\navidrome`, review diff, commit and push. Build:

```powershell
cd C:\Navidrome-Github\navidrome
docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.10.5.11 --load .
docker save -o "C:\Navidrome-Github\navidrome-custom-0.8.10.5.11-amd64.tar" navidrome-custom:0.8.10.5.11
```

After backing up `/data` and Playlist files, import TAR into Synology, update the Compose image tag to `navidrome-custom:0.8.10.5.11`, and recreate the project. Keep mounts and other settings unchanged.

## Test

1. On a TEST playlist containing Chinese and Latin artist names, save Artist Ascending and click Sort now. Refresh the playlist page and check the FIRST AND LAST pages; the appended tracks should move into the correct alphabetic position.
2. Save Artist Descending and Sort now; verify the reverse order.
3. Use Apply to all with Artist Ascending. Confirm only editable playlists are updated; customize one playlist to Album Descending and another to Auto sort Off; verify independent persistence after refresh.
4. Export a playlist to M3U and verify its current order. For Synology-linked playlists, verify the existing sync protection and backups.
5. Confirm nightly sync and subsequent sorting continue to operate. **This release does not alter the nightly phase order (sync first, sort second).**

## Verification limits

Go formatting and static syntax parsing passed. JavaScript/JSX parse checks passed. The Go 1.27 toolchain could not be downloaded in the build environment, so the full Go build, Docker build, and NAS behavior remain to be validated on the user's setup. Chinese pronunciation mapping uses a per-character dictionary; polyphonic names may need manual corrections in future releases.

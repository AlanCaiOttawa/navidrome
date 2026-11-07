# Alpha 0.8.5 — Unmatched M3U additions (experimental)

This update adds a manual review workflow for a **new entry added to an M3U** that cannot be matched to a Navidrome-indexed song. It does not use this workflow for a song removed from the Navidrome playlist, or a song removed from M3U. Those changes remain under three-way synchronization.

## Three actions

- **Remove from M3U**: removes only the selected M3U entry and its adjacent `#EXTINF` directive, writing a timestamped `.nd-backup-*` before changing the file. It never deletes the MP3 itself.
- **Find song in folders**: browser traverses the existing Docker `/music` mount, with one folder level at a time and no fixed maximum depth. Selecting a track validates it against the Navidrome media-file index, then updates the original M3U relative path and creates a backup.
- **Keep and ignore**: the M3U line remains unchanged and the resolved source path is saved in `/data/experimental/m3u-sync/*.ignored.json`. The sync engine excludes the entry from comparison and import in future runs. It is preserved on M3U export, but its position can change if the rest of the playlist is reordered or rewritten.

## Operational safeguards

1. Newly added unresolved entries block the relevant playlist's manual or nightly two-way sync until reviewed.
2. Ignored entries don't stop future synchronization, and remain present in the M3U.
3. A stale preview token or changed source M3U blocks destructive actions.
4. The physical music directory is never modified; only M3U files under the configured writable mapping are written.
5. The feature uses Navidrome's indexed relative `media_file.path` to match songs; this also addresses the previous false “track not found in index” error.
6. Previously synchronized but now unavailable songs are *not* classified as newly added unmatched entries; they require a separate review of library availability.

## Windows test

1. Back up `/data` and `C:\Music\Playlist`.
2. Extract this full source over the test source, keeping your Windows Compose file and `navidrome-data`.
3. Rebuild: `docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate`.
4. Add a nonexistent media path to a **copy** of an M3U file and preview two-way sync.
5. Test Ignore first, confirming the line remains, then Locate using a real indexed music file. Test Remove using another unmatched entry, verifying `.nd-backup-*` appears.
6. Test separately that deleting a *matched* track from a Navidrome playlist does not trigger this menu.
7. Keep automatic nightly sync off until manual tests have passed.

## Verification status

The changed Go code has been formatted with `gofmt`; the changed JavaScript / JSX passed TypeScript parser syntax checks. The full Go build cannot be verified here: the local Go 1.23 toolchain cannot parse the project's `tool` block in go.mod (the source requires a newer Go toolchain). Docker runtime tests are outstanding.

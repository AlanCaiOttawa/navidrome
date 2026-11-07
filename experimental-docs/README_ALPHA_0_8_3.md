# Navidrome Custom Alpha 0.8.3 — recursive collection folders / sync diagnostics

## Changes

- **Recursive collection folder discovery:** The Collections dropdown now uses a bounded recursive directory walk of each mounted music-library root, rather than relying exclusively on Navidrome's indexed Folder records. Every discovered subdirectory, including subdirectories many levels deep, has an option. For example: `Music Library / Chinese / Artist / Album`. The item shows the number of indexed albums in that folder and all its descendants. Empty/unindexed directories show `0 albums` and cannot add tracks until scanning finds music.
- **Hierarchy cues:** Folder options are indented by depth in the Collections folder dropdown.
- **Sync diagnostics:** Generic errors are prefixed with the failed action (import scan vs. folder synchronization preview) and direct users to the container logs. This does *not* claim to fix an unobserved HTTP 500 backend error.
- **No change to scheduled or manual sync algorithms.**

## Troubleshooting HTTP 500

Immediately after reproducing the red error, open PowerShell in the Navidrome source folder:

```powershell
cd C:\Navidrome-Test
docker compose -f experimental-docs/docker-compose.windows-test.yml logs --tail=200 navidrome-experimental
```

Paste the error lines and say which button was pressed (`Import from M3U Folder`, `Sync entire M3U folder ↔ Navidrome`, or `Preview two-way sync`). HTTP 500 needs the server-side error or stack trace to establish its cause; this update does not mask the failure.

## Test

1. Ensure the `C:\Music` directory is mounted as `/music` and nested folders exist under it.
2. Rebuild with `docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate`.
3. Open a Collection; choose **Choose a music folder**. Check that deep paths appear, e.g. `Library / folder 1 / subfolder / album`.
4. Pick a folder containing indexed albums and choose **Add all albums in folder**.
5. Reproduce the M3U error and capture container logs; do not connect the live NAS M3U directory until the backend failure is understood.

## Verification and limitations

Go formatting completed. The patch has not passed a full Go 1.27 compilation or Docker runtime test in this environment; JavaScript changes are small but have not undergone a full bundler build. The directory walk is bounded to 10,000 directories for safety. This is experimental code; backup playlists and test data before running.

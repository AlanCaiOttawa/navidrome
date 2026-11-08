# Alpha 0.8.10.3 — Recently Played Cover/List and Direct Play

Base: Alpha 0.8.10.2 (next-track Resume).

## Features

- Recently Played Albums and Recently Played Playlists each offer **Cover** and **List** toggles.
- The view preference is stored separately per section in the browser's localStorage.
- A **Play** action is provided on each cover card and list row, without opening the detail page.
- Direct Play fetches the complete ordered song list, then calls the same `choosePlayback()` helper used on the Album and Playlist pages. The existing Resume / Play from Beginning / Cancel dialog and next-track rule apply.
- The old minutes:seconds label is replaced by the last-played timestamp because Resume now operates at track boundaries.
- While one Play request is loading or its dialog is open, the other buttons are disabled; request failures are shown on the page.

## Changed source files

- `ui/src/experimental/RecentlyPlayed.jsx`
- This README in `experimental-docs/` (documentation only).

No server/database modifications are needed.

## Manual tests (not yet performed)

1. Recently Played Albums: Cover → List → Cover; verify album artist, art, navigation and Play.
2. Recently Played Playlists: Cover → List; verify imported M3U and regular playlists retain their song order.
3. Start playback of a recent Album/Playlist from list and cover without navigating to its detail page.
4. Choose Resume and confirm next-track playback; choose Play from Beginning and confirm first-track playback; choose Cancel and confirm no playback change.
5. Test a one-track item and a last-track item (should wrap to first); rapidly click Play twice; and test unavailable album/playlist.
6. Reload browser and check each section remembers its own view setting. Check iPad Safari after refreshing the page.

## GitHub Desktop workflow

On a clean `custom/0.8.10` branch (currently at custom-v0.8.10.2), copy only the source files from the **changed-files ZIP** into `C:\Navidrome-Fork` preserving paths. Review changes in GitHub Desktop, commit to a new feature branch, build/test the Docker image, then merge and push. The full-source ZIP is a separate offline snapshot and is not a Git history backup.

## Verification performed

TypeScript JSX parser successfully parsed `RecentlyPlayed.jsx`; ZIP entry integrity checked. Docker build and actual browser playback have NOT been run in this environment.

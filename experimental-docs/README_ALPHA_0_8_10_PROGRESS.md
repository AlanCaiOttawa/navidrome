# Navidrome Custom Alpha 0.8.10 — Resume progress retention

Based on Alpha 0.8.9. This is an experimental source release, not a prebuilt Docker image.

## Bug
When switching between albums and playlists repeatedly, the saved resume position could revert to the start. The old player only persisted progress every 10 seconds, did not reliably flush on playlist/album context switches, and could save the completed time of a track instead of the start of the next track.

## Changes
- `ui/src/experimental/api.js`: serialize progress writes; capture the latest playing position; flush before switching playback contexts; allow a position at 0 seconds for a later track to be resumed.
- `ui/src/audioplayer/Player.jsx`: capture progress continuously, persist approximately every 3 seconds, flush on pause/track change/pagehide, and record the next track when one ends.
- `server/experimental.go`: add optional `recordedAt` timestamps for progress writes, prevent older-arriving records from replacing newer records, and retain compatibility with existing progress JSON.

## Regression testing
1. Start Album A, play >3 seconds on track 2, then start Playlist B; switch back to Album A, verify Resume on track 2.
2. Play Playlist B, switch to another collection and back rapidly, verify Resume.
3. Complete track 2 of an Album: next Resume should point at track 3, not the end of track 2.
4. Pause mid-track, switch pages repeatedly, resume and verify seconds.
5. Reload page and test on another device; ensure server-side progress persists.
6. Check that a manually chosen Play from beginning continues to work.
7. Ensure M3U sync, Collections, and mobile mini-player are unaffected.

## Limitations
- This patch has syntax/format checks but has not passed a full Docker build or a multi-device runtime test.
- Browser shutdown/background suspension can still interrupt outstanding HTTP requests; pagehide is best-effort.
- Existing incorrect positions are not reconstructed automatically.
- Client timestamps are accepted within a two-minute future tolerance; system clocks should be correct.

## Build
From the extracted source root on Windows:
```
docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.10 --load .
docker save -o navidrome-custom-0.8.10-amd64.tar navidrome-custom:0.8.10
```
Import the TAR on Synology, update the project's `image:` tag and retain `/data` and all folder mappings. Back up `/data` before deploying.

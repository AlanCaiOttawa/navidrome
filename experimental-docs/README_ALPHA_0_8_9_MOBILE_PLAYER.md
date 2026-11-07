# Navidrome Custom Alpha 0.8.9 — Mobile player navigation fix

## Problem
On iPad/iPhone, after starting a song, closing the full-screen player and navigating to another Collection or menu item could show the full-screen player again. The player was initialized with `mode: 'full'` on every mount.

## Change
In `ui/src/audioplayer/Player.jsx`, the initial mode is now `isMobilePlayer ? 'mini' : 'full'` instead of always `full`. `isMobilePlayer` was also added to the memo dependencies. This keeps the compact player by default on iPad/iPhone, while the full player remains available from the compact player. Desktop initialization is unchanged.

## Scope and caveats
- UI-only change; no database, playlist, M3U, Collections, sync, or playback-progress logic has been altered.
- Static syntax parsing has been performed, but complete Docker build and iPad functional testing have not been performed here.
- Verify manual expand/collapse and that music continues through several sidebar route changes.

## Windows build and Synology deployment
After applying the patch to the complete Alpha 0.8.8 source, run:

```powershell
docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.9 --load .
docker save -o navidrome-custom-0.8.9-amd64.tar navidrome-custom:0.8.9
```

Import the TAR under Container Manager > Image, stop the `navidrome-custom` Project, change its YAML image to `navidrome-custom:0.8.9`, and redeploy. Keep existing `/data`, `/music`, and `/m3u-write` mounts unchanged.

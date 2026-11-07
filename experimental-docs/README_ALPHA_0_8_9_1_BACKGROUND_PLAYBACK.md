# Navidrome Alpha 0.8.9.1 — background playback rollback

This hotfix reverts only the mobile player initialization change introduced in Alpha 0.8.9.

## Why
In 0.8.9, `mode` was changed from `full` to `mini` for mobile devices. A user reported that iPad playback would not advance to the next song after backgrounding the browser. The change is the primary known regression candidate, not a confirmed root cause.

## Change
`ui/src/audioplayer/Player.jsx`: set `mode: 'full'` again; remove an unused `isMobilePlayer` entry in that memo's dependency list.

## Important limitation
This restores the former player initialization; it may reintroduce the fullscreen popup on navigation. Do not treat it as a full fix for both issues. iPadOS Safari background media restrictions may still cause issues; testing is required.

## Test
1. Rebuild for linux/amd64.
2. On iPad, start a multi-track album/playlist, switch to another app / lock the screen, and wait for track 1 to finish.
3. Verify whether track 2 plays without foregrounding Safari.
4. Verify resume and foreground navigation.
5. If the issue persists, investigate the underlying navidrome-music-player queue-end event and iOS Media Session integration.

No Go/database/M3U sync code changed.

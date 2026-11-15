# Incremental installation — Navidrome plugin-independent lyrics

This ZIP contains ONLY five frontend source files relative to the repository root. It is NOT a Docker image and should NOT be copied into `/data/plugins`.

## Backup
Back up your current repository's five corresponding files, your currently running Docker image, and your NAS `/data` directory. Do not replace your music library or SQLite database.

## Apply files
In the SOURCE repository matching `Navidrome_Alpha_0.8.10.5.13_Full_Source(1).zip`, extract this ZIP with paths intact, overwriting the three existing files and adding the two new files. Do not extract over a later source revision without merging/diffing, as that might erase newer customizations.

Modified:
- ui/src/subsonic/index.js
- ui/src/audioplayer/PlayerToolbar.jsx
- ui/src/audioplayer/Player.jsx
Added:
- ui/src/audioplayer/pluginLyrics.js
- ui/src/audioplayer/PluginLyricsPanel.jsx

## Build
From the repository root with the original Dockerfile:

    docker build -t navidrome-custom:0.8.10.5.13-lyrics .

This Dockerfile builds both frontend and backend. Do NOT replace the build target with a stock Navidrome image. Building may require internet and the development build environment. If building on another machine, transfer the image to the NAS with `docker save` / `docker load`, ensuring compatible architecture.

## Deploy
In Synology Container Manager, update only the `image:` value to:

    image: navidrome-custom:0.8.10.5.13-lyrics

Keep `pull_policy: never`, the existing `ports` (4534:4533), environment configuration, and all `volumes` unchanged. Redeploy the project. Do not run two copies against the same `/data` folder simultaneously. Keep old image for rollback.

## Test
Open the existing Navidrome URL (port 4534); play a song; use the NEW Online Lyrics toolbar button. The old lyrics panel remains separate. Lyrics are fetched using Navidrome `/rest/getLyricsBySongId`, not directly from any particular lyrics plugin.

If you are testing with an `nd-lyrics` provider returning only plain lyrics, lyrics may appear without timed line highlighting. A synchronized source is required for timed highlighting.

## Rollback
Switch the Compose `image:` back to `navidrome-custom:0.8.10.5.13` and redeploy. The source update doesn't require database changes or different mounts.

Full-source alternative: `Navidrome_Alpha_0.8.10.5.13_Plugin_Independent_Lyrics_Source.zip` includes the same five changes.

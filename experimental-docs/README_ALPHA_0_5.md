# Navidrome Alpha 0.5 – interface cleanup and scan trigger

- Moved Playlist Folder settings to M3U Playlist Sync.
- Added separate Recently Played Albums and Recently Played Playlists menu pages.
- Collections page now focuses only on collection management and covers.
- Added Music Library (all albums) to folder selector for test libraries that keep MP3s in root.
- Added explicit **Import from M3U Folder** button invoking Navidrome's administrator-only Subsonic `startScan` endpoint.
- This button is **one-way M3U → Navidrome**. It does not perform Swing Music's three-way automatic bidirectional sync, nor does it write to M3U files. Existing per-playlist manual writeback APIs remain separate.
- Security: M3U folder is restricted to the existing Docker-mounted music directory; live Synology playlists should be backed up before any future writeback tests.

## Windows test

Extract *full source* to `C:\Navidrome-Test` and retain your working `experimental-docs/docker-compose.windows-test.yml` and data directory.

```
docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
```

Visit http://localhost:4534. For import, set the folder, restart the container if changed, then click **Import from M3U Folder** as an administrator.

## Validation caveat

This source was syntax-checked, not full Go/Docker compiled in this environment. Scanner endpoint authentication should be tested in the running Docker setup. The three-way engine from Swing Music has **not** yet been ported.

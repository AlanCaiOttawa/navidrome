# Alpha 0.8.1 — Collections overview and sync-time layout

Changes to Alpha 0.8:
- Renamed the top Collections navigation link to **Browse Collections**. The overview now shows all existing user-created Collections as artwork-preview tiles, with name and album count. Clicking a tile opens the selected Collection and displays album covers.
- Individual Collection links remain under the Collections group, but have increased left padding to align visually with the nested Album links.
- On M3U Playlist Sync, the **Daily synchronization time** label appears horizontally to the left of the native time input, with sufficient spacing to avoid the previous overlap.
- No change to stored Collections, server APIs, or synchronization scheduler behavior.

## Windows test

Back up the existing `/data` mapping and `C:\\Music\\Playlist` before testing. Replace the existing source tree with this full-source release, while preserving your customized `experimental-docs/docker-compose.windows-test.yml` and `navidrome-data` directory.

```powershell
cd C:\\Navidrome-Test
docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
```

Visit http://localhost:4534. Click **Browse Collections** to see the artwork overview. Click a named Collection in the sidebar to see its albums. On **M3U Playlist Sync**, check that the time label does not overlap the time control.

## Validation and limitation

All three changed JSX files were parsed with TypeScript's JSX parser without syntax errors. Docker image build, full integration tests, and browser runtime verification have not been performed in this environment.

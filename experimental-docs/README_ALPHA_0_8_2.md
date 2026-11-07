# Alpha 0.8.2 – Collections layout

- Move New collection / Create / Choose a collection to the top of the Collections page.
- Display all Collection cover cards underneath.
- Hide the empty album-editing panel on the overview page.
- No backend or synchronization changes.

### Windows Docker

Preserve `experimental-docs/docker-compose.windows-test.yml` and the existing `/data` volume when installing the source.

```powershell
cd C:\Navidrome-Test
docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate
```

Place `Windows_Music_8_tracks_Synology.m3u` under `C:\Music\Playlist`. Files are referenced using relative `../` paths; an M3U is not proof that files exist. All durations are -1 (unknown).

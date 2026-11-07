# Navidrome Custom Alpha 0.3 — Swing Music features adaptation

This is **uncompiled experimental source**. It is NOT a release-ready Docker image. Based on the user's Navidrome Alpha 0.2 source and Swing Music reference ZIP.

## Implemented in this source update

1. **Album cover Play** now invokes the same `choosePlayback()` routine as the album detail Play action. When an unfinished server-side saved position exists, the browser offers Resume (OK) vs Play from Beginning (Cancel). On first play, the album starts normally; the prompt is not displayed without a prior position.
2. **Album three-dot menu** now includes **Add album to collection**. Pick an existing collection by its displayed number or type a new collection name. Collections are stored in `/data/experimental` per user.
3. **Add folder to Collection** in Collections / Recently Played page. The folder picker enumerates *already indexed* music folders and includes albums in the chosen folder AND subfolders. The file system and music files are not changed. The server derives album membership from Navidrome's album.folder_ids and indexed folder records; unscanned folders will not appear.
4. **Existing Alpha 0.2 functionality retained:** playlist M3U auto-import, manually saving an editable playlist back to its mapped original `.m3u`, server-side progress and recently played.

## Not yet implemented

- **Full automatic, bidirectional, conflict-aware folder synchronization** (all M3Us) is NOT implemented. The existing Navidrome import is **M3U → Navidrome**; individual **Navidrome → M3U** requires disabling playlist Sync and using the Save to M3U action. This combination is not safe to describe as automatic two-way sync. The user-supplied Swing Music reference has three-way snapshots, preview, conflict resolution, missing-track guards, backups, and scheduled sync. Those are Python/Flask/Vue features, not drop-in modules for Go/React Navidrome. We need a dedicated backend service and UI to port the algorithms before enabling bulk two-way writes.
- No complete runtime playback test, Node frontend build, Go build or Docker image built in this environment. The uploaded Navidrome source requires Go 1.27; the available Go is 1.23.2 with internet blocked.
- The legacy resume UI uses a browser confirm prompt, not a bespoke modal. Also, additional playback entry points (e.g., external players and shuffles) do not use the prompt.

## Local Windows test

1. Keep the existing Alpha test `/data` separate from production; back it up before upgrading.
2. Use the existing Windows test Compose. Ensure `C:/Music` maps read-only to `/music`, `C:/Music/Playlist` writable to `/music/Playlist`, and the same playlist path writable to `/m3u-write` (case-sensitive inside Linux). Ensure `ND_PLAYLISTSPATH: Playlist`.
3. Build using Docker Desktop and the `experimental-docs/docker-compose.windows-test.yml` file, or adjust the existing Compose `build.context` to the source directory. To avoid failures from paths in archived Compose, review it before use.
4. Test cover Play after playing an album at least 10 seconds, opening it again, and choosing resume; test three-dot add; test folder selection; test original single-playlist M3U writeback only against copies.
5. Do NOT point two programs at the same writable live M3U folder during writeback tests. Save copies first.

## 和 Swing Music 的关系

- `custom_resume.py`: 提供继续播放的行为参考，不能直接复制到 React 播放器。
- `collections.py`: 提供 Collection 组织方式参考，Navidrome 使用自己的数据模型。
- `folder_playlist_sync.py`: 包含快照、冲突提示、未匹配歌曲保护和备份。Alpha 0.3 尚未移植这些安全措施，不能把手动写回称为完整双向同步。
- 当前增加了封面播放 Resume、Album 三点菜单添加 Collection、整文件夹添加 Collection。应先在 Windows Docker 测试，再在 Synology 的独立容器验证。

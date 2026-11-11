# Navidrome Custom Alpha 0.8.10.5.8 — M3U quick actions and pinned-artist sorting

Based on Alpha 0.8.10.5.7.

## Synology M3U quick actions

- The **Not linked yet — import to Navidrome** row now offers **Import to Navidrome**. This imports only the selected M3U/M3U8 using Navidrome’s internal playlist import logic; no broad library scan is requested. Administrator permission required.
- The folder inventory also lists Navidrome file-backed playlists whose M3U source disappeared from the configured Synology Playlist folder. Such rows offer **Delete in Navidrome**. A separate confirmation is required. Backend checks again that the source file is missing and inside the configured Playlist folder before deleting the Navidrome database playlist only. No audio or M3U file is ever deleted.
- Missing files are listed only for administrators. Existing two-way sync behavior is unchanged. This is a manual action, never part of automatic sync.
- New API: POST `/api/experimental/m3u-folder-import` with `{ "name": "example.m3u" }`; POST `/api/experimental/m3u-folder-delete-missing` with `{ "id": "playlist-id", "confirm": true }`. Both require admin authentication.

## Sort pinned artists

- In **Catalogue > Sort pinned artists**, select **Sort A → Z / 拼音升序** or **Sort Z → A / 拼音降序** to sort the current pinned artists.
- Both controls reuse the same `pinyinSortKey` as the existing Collections/Catalogue sorting; Han characters are compared by their romanized pinyin. Manual drag and arrow adjustments remain available.
- Sorted changes remain a draft until **Save order**. **Cancel** leaves the saved order unchanged.
- Sorting does not pin or unpin additional artists. The existing Minimum Songs eligibility rule remains in force.

## Deployment

Extract the changed-files ZIP on top of the **0.8.10.5.7** source tree (preserve folders), or use the complete source ZIP. Review changes and build the Docker image:

```powershell
cd C:\Navidrome-Github\navidrome
docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.10.5.8 --load .
docker save -o "C:\Navidrome-Github\navidrome-custom-0.8.10.5.8-amd64.tar" navidrome-custom:0.8.10.5.8
```

**Testing**: JSX/JavaScript parse checks, Go formatting, and ZIP integrity were verified. Full Go compilation could not run here because the project requires Go 1.27, unavailable without network access. Test on Windows Docker before NAS deployment, back up `/data` first, and verify with a disposable playlist (both import and missing-file deletion).

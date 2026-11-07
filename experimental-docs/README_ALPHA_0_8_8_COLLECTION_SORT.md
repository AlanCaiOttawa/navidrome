# Navidrome Custom Alpha 0.8.8 — Collection view and sorting

Base: Alpha 0.8.7 Unicode folder browser. Frontend-only change.

## Features

- In an individual Collection, switch **Cover** / **List**.
- Sort by Artist, Album, Year, or Track count, ascending or descending.
- In List view, click Artist, Album, Year, or Tracks headers to reorder.
- Mixed Chinese/Latin sorting uses a generated Han-character Pinyin lookup rather than the built-in zh-CN collation grouping. E.g. ABBA → Adele → 阿杜 → 陈奕迅 → 张学友.
- View and sort preferences are saved in browser localStorage; they do not change collection membership or server-side data.
- Chinese characters are displayed in the UI without transliteration.

## Modified files

- `ui/src/experimental/Collections.jsx`: toolbar, list table, cover sort, persistent preferences.
- `ui/src/experimental/collectionSort.js`: sorting algorithm and numeric ordering.
- `ui/src/experimental/hanPinyin.json`: offline lookup for common CJK Unified Ideographs and Extension A, generated from Unidecode mappings. Bundled in the source; no new npm dependencies.

## Important limitations

- Polyphonic Chinese characters may require a custom reading: the offline character-level mapping cannot always identify the correct reading of a personal name or title (e.g. 重庆 may need Chongqing). A future version could support an editable override dictionary. Do not alter original titles or artists to fix this.
- Some rare Han characters outside the bundled Unicode ranges retain their original codepoint-based comparison.
- The view preference is per browser, not account-synchronized.
- Collection-wide overview artwork grid remains unchanged; Cover/List controls apply **inside each Collection**.
- No M3U, scheduler, player, library database, or backend code was changed.

## Checks conducted

- TypeScript parser verified `Collections.jsx` JSX syntax.
- `collectionSort.js` transpiled and executed in Node with a mixed English/Chinese artist sorting test.
- ZIP archive CRC check passed. Full Go/Docker build and Synology runtime test were not available here.

## Upgrade from 0.8.7

1. Preserve `experimental-docs/docker-compose.windows-test.yml` and persistent `/data` backups.
2. Overlay the patch ZIP at the source root, retaining folder structure.
3. On Windows, run `docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.8 --load .`.
4. Test at localhost:4534 before exporting the image.
5. Export with `docker save -o navidrome-custom-0.8.8-amd64.tar navidrome-custom:0.8.8`, import into Synology, and update only the Compose image tag. Retain the old image for rollback.

Regression: add/remove albums; select nested Chinese folder; switch Cover/List; sort Artist/Album in both directions; verify 阿杜 with A artists; preview and reconcile M3U; verify scheduled sync remains disabled unless intended; verify Resume.

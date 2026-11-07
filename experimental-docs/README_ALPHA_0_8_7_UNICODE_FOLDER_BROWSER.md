# Navidrome Custom Alpha 0.8.7 — Unicode / large-folder browser

## Problem diagnosed

Alpha 0.8.6 collected every directory in a single API result, cutting off at 10,000 directories without notifying the user. Since filepath.WalkDir traverses directory names in lexical order, later directory names (including many Chinese-character names) could be absent entirely from the browser. The React search only searched that truncated list.

## Fix

- New authenticated endpoint: `GET /api/experimental/collection-folder-tree`
  - No parameters: shows All Music and library roots.
  - `?parent=library-folder:<libraryID>:<relative path>`: lists immediate child directories only.
  - `?search=<UTF-8 search text>`: searches the actual mounted directory tree; returns at most 200 hits with a visible truncation warning. Does not stop after an arbitrary number of scanned directories.
- Collection folder dialog fetches children on demand, including arbitrarily deep nested folders.
- Search works with UTF-8 paths such as `中文` and `王杰`; no ASCII-only filters.
- Counts and album IDs come from the existing indexed media file records and contain albums in the chosen folder *and all descendants*.
- Existing Collections and per-user metadata remain unchanged. The M3U two-way sync engine and scheduler are unchanged.

## Important prerequisites

The source folder must exist under a volume mounted to `/music` and be readable by the container. The browser cannot access NAS folders that have not been mounted into the container.

## How to install (Windows test)

1. Back up `/data` or your Windows `navidrome-data` and M3U folders.
2. Replace the source files from the Alpha 0.8.7 full-source ZIP (or apply the patch to Alpha 0.8.6).
3. Rebuild: `docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate`
4. Refresh the browser (Ctrl+Shift+R), open a Collection > Browse music folders, search `中文` and expand several levels.

## Synology deployment

A source ZIP cannot be installed into an existing image directly. Build a Linux AMD64 image on Windows and export it:

```powershell
docker buildx build --platform linux/amd64 --target final -t navidrome-custom:0.8.7 --load .
docker save -o navidrome-custom-0.8.7-amd64.tar navidrome-custom:0.8.7
```

Import the TAR into Synology Container Manager > Image, then change the project's image to `navidrome-custom:0.8.7` and redeploy. Keep `/data` and the music volume mappings unchanged.

## Verification / limitations

- The Go code was formatted with gofmt. Full Go build and Synology runtime testing were not available in the build environment.
- Browsing a huge library may still be somewhat slow, especially on first search: the search walks NAS directories, rather than relying on a prebuilt search index.
- Searches return at most 200 matching directories; refine the query if the screen indicates truncation.
- The older legacy `collection-folders` endpoint is retained for compatibility but the interactive collection folder browser uses the new lazy endpoint.
- After initial install, test a known Chinese-character directory and confirm that the selected collection includes expected descendant albums.

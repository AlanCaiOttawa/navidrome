# Alpha 0.8.4 – Folder Browser and M3U error diagnostics

- In Collections, **Browse music folders...** opens an expandable and searchable tree. It supports arbitrary levels within the folders supplied by Navidrome's backend. The album context menu uses the same tree.
- Folder choice includes albums in descendant folders, as in previous builds.
- M3U sync POST errors now show HTTP status and response body when the server supplies one.
- The observed server log `POST /api/experimental/m3u-sync/{id} 500` confirms a backend failure but not its root cause. Check the new UI error text and the Network tab response body; do not enable nightly sync on live playlists until resolved.
- The server's original sync algorithm is unchanged in this update.

Build via `docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate` from the project root. Preserve compose file and data directory.

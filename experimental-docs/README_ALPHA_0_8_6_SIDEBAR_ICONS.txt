Navidrome Custom Alpha 0.8.6 — Sidebar Collection Icons (UI-only)

Based on Alpha 0.8.5. No changes to M3U sync engine or database.

Changes:
- Collection section retains its folder icon when sidebar is collapsed.
- Browse Collections has a grid icon.
- Each collection receives a small first-character icon (Unicode aware).
- Collapsed collection icons have hover tooltips showing full name and album count.
- Expanded menu keeps original labels and navigation.

Install: back up data, extract full archive in C:\Navidrome-Test while preserving
experimental-docs/docker-compose.windows-test.yml and navidrome-data.
Run: docker compose -f experimental-docs/docker-compose.windows-test.yml up -d --build --force-recreate

Checks: JSX parsed successfully via TypeScript parser; no Docker runtime test completed.

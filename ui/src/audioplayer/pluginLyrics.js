// Plugin-independent OpenSubsonic lyrics adapter. All providers go through
// Navidrome's getLyricsBySongId endpoint; no plugin-specific URLs are used.
import subsonic from '../subsonic'

export const selectLyrics = (response) => {
  const entries = response?.['subsonic-response']?.lyricsList?.structuredLyrics || []
  // Prefer synchronized main lyrics, then any synchronized lyrics, then plain.
  const sorted = [...entries].sort((a, b) =>
    Number(Boolean(b.synced)) - Number(Boolean(a.synced)),
  )
  const selected = sorted.find((entry) => Array.isArray(entry.line) && entry.line.length)
  if (!selected) return null
  const lines = selected.line
    .map((line, index) => ({
      time: selected.synced ? Number(line.start) / 1000 : index, // OpenSubsonic timestamps are in milliseconds
      text: String(line.value ?? ''),
    }))
    .filter((line) => Number.isFinite(line.time))
  return { synced: Boolean(selected.synced), lines, lang: selected.lang || '' }
}

export const fetchPluginLyrics = async (trackId) => {
  const result = await subsonic.getLyricsBySongId(trackId)
  return selectLyrics(result)
}

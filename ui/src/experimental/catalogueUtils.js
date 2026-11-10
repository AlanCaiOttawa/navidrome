import { pinyinSortKey } from './collectionSort.js'

// A song is counted only once for an artist, even when multiple recordings
// or file formats of the same title exist in the library.
const EDITION_MARKERS = /\b(remaster(?:ed)?|remix|radio edit|album version|single version|live(?: at| in| from)?|acoustic|instrumental|demo|mono|stereo|explicit|clean|deluxe|bonus track|\d{4}\s*remaster(?:ed)?)\b/i

export const normalizedTitle = (value) => {
  let title = String(value || '').normalize('NFKC').trim()
  // Only remove a suffix if the entire bracketed phrase identifies a version;
  // preserve meaningful parentheses like "(I Can't Get No) Satisfaction".
  for (let i = 0; i < 3; i += 1) {
    const next = title.replace(/\s*[([]([^()[\]]+)[)\]]\s*$/, (match, label) =>
      EDITION_MARKERS.test(label) ? '' : match)
    if (next === title) break
    title = next.trim()
  }
  return title.replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ').toLocaleLowerCase('en')
}

// Prefer higher fidelity before bitrate: lossless > lossy; among lossless
// use bit depth and sample rate; among lossy use bitrate. File size is only
// the final tie-breaker, not a proxy for quality.
const lossless = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF', 'AIF', 'APE', 'WV', 'DSF', 'DFF'])
const lossy = new Set(['MP3', 'AAC', 'M4A', 'OGG', 'OPUS', 'WMA', 'MP4'])
export const qualityScore = (song) => {
  const fmt = String(song.suffix || song.format || '').toUpperCase()
  const kind = lossless.has(fmt) ? 2 : lossy.has(fmt) ? 1 : 0
  const depth = Number(song.bitDepth) || 0
  const sample = Number(song.sampleRate) || 0
  const bitRate = Number(song.bitRate) || 0
  const size = Number(song.size) || 0
  return [kind, kind === 2 ? depth : bitRate, kind === 2 ? sample : 0,
    kind === 2 ? bitRate : 0, size]
}

export const compareQuality = (a, b) => {
  const left = qualityScore(a)
  const right = qualityScore(b)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return right[i] - left[i]
  }
  return String(a.id || '').localeCompare(String(b.id || ''))
}

const compareNames = (a, b) => pinyinSortKey(a).localeCompare(pinyinSortKey(b), 'en', { numeric: true })

export const makeCatalogue = (songs) => {
  const byArtist = new Map()
  for (const song of songs) {
    if (!song || song.missing || !song.id) continue
    // The song's artist is intentional (not albumArtist): compilation albums
    // should list the actual performing artists, not "Various Artists".
    const artist = String(song.artist || '').trim()
    const title = String(song.title || '').trim()
    if (!artist || !title || /^(?:\[?unknown artist\]?|unknown|<unknown>)$/i.test(artist)) continue
    const artistKey = artist.normalize('NFKC').toLocaleLowerCase('en')
    const titleKey = normalizedTitle(title)
    if (!titleKey) continue
    if (!byArtist.has(artistKey)) byArtist.set(artistKey, { name: artist, byTitle: new Map(), artistIds: new Set() })
    const entry = byArtist.get(artistKey)
    if (song.artistId) entry.artistIds.add(String(song.artistId))
    const previous = entry.byTitle.get(titleKey)
    if (!previous || compareQuality(song, previous) < 0) entry.byTitle.set(titleKey, song)
  }
  return [...byArtist.values()].map(({ name, byTitle, artistIds }) => ({
    id: name.normalize('NFKC').toLocaleLowerCase('en'), name,
    artistIds: [...artistIds],
    songs: [...byTitle.values()].sort((a, b) => compareNames(a.title, b.title)),
    count: byTitle.size,
  })).sort((a, b) => compareNames(a.name, b.name))
}

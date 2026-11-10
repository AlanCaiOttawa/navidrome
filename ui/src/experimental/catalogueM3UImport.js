import { catalogueSongKey } from './catalogueOrder'
import { normalizedTitle } from './catalogueUtils'

// M3U is treated as a *sorting hint*, not as an instruction to add files,
// remove files, change the quality-selected recording, or create a playlist.
const normalizedPath = (value) => String(value || '').normalize('NFKC')
  .replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/%([0-9a-f]{2})/ig, (_, hex) => {
    const char = String.fromCharCode(parseInt(hex, 16))
    return /[\w .\-()[\]]/.test(char) ? char : `%${hex}`
  }).replace(/^\/+/, '').toLocaleLowerCase('en')

const basename = (path) => normalizedPath(path).split('/').pop() || ''
const stem = (path) => basename(path).replace(/\.(?:mp3|m4a|aac|flac|wav|aiff?|ape|ogg|opus|wma|wv|dsf|dff|mp4)$/i, '')
const stripNumber = (s) => s.replace(/^\s*(?:\(?\d{1,3}\)?[\s._-]+)+/, '').trim()
const artistPrefix = (text, artist) => {
  const value = String(text || '').trim()
  const name = String(artist || '').trim()
  if (!name) return value
  const separator = value.match(/\s[-–—]\s/)
  if (!separator) return value
  const position = separator.index
  if (normalizedTitle(value.slice(0, position)) !== normalizedTitle(name)) return value
  return value.slice(position + separator[0].length)
}
const normalizeCandidate = (value, artist) => normalizedTitle(artistPrefix(stripNumber(value), artist))

export const parseCatalogueM3U = (text) => {
  const entries = []
  let extinf = ''
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^#EXTINF:/i.test(line)) { extinf = line.slice(line.indexOf(',') + 1).trim(); continue }
    if (line[0] === '#') continue
    entries.push({ path: line, description: extinf })
    extinf = ''
    if (entries.length > 20000) throw new Error('The M3U has more than 20,000 entries.')
  }
  return entries
}

const pathCandidates = (song) => [song.path, song.filePath, song.filename, song.fileName, song.relativePath]
  .filter(Boolean).map(normalizedPath)

const pathsMatch = (left, right) => {
  if (!left || !right) return false
  const a = left.replace(/^(?:\.\.\/|\.\/)+/, '')
  const b = right.replace(/^(?:\.\.\/|\.\/)+/, '')
  if (a === b) return true
  // Some M3Us are relative to the Synology Playlist folder while the
  // Navidrome API may include the music root. Require a path boundary.
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

export const arrangeCatalogueFromM3U = (songs, entries, artist) => {
  const available = new Map(songs.map((song) => [catalogueSongKey(song), song]))
  const ordered = []
  const unmatched = []
  let repeats = 0
  for (const entry of entries) {
    const path = normalizedPath(entry.path)
    const desc = normalizeCandidate(entry.description, artist)
    const fileTitle = normalizeCandidate(stem(entry.path), artist)
    // Prefer exact file path. A path match is safe even if the song's title
    // tag differs from the name shown in an external playlist.
    let song = songs.find((item) => pathCandidates(item).some((p) => pathsMatch(path, p)))
    // EXTINF is often preserved through lossy-to-lossless replacement.
    if (!song && desc) song = available.get(desc)
    if (!song && fileTitle) song = available.get(fileTitle)
    // Do not use substring/fuzzy matching, which risks silently reordering
    // an unrelated song. Missing entries are intentionally skipped.
    if (!song) { unmatched.push(entry.path); continue }
    const key = catalogueSongKey(song)
    if (!available.has(key)) { repeats += 1; continue }
    ordered.push(song)
    available.delete(key)
  }
  return { songs: [...ordered, ...songs.filter((song) => available.has(catalogueSongKey(song)))],
    matched: ordered.length, missing: unmatched.length, duplicates: repeats,
    appended: available.size, unmatched: unmatched.slice(0, 10) }
}

export const decodeM3U = (buffer) => {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder('utf-8').decode(bytes)
}

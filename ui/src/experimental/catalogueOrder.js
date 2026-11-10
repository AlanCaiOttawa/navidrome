import { normalizedTitle } from './catalogueUtils'

// A title identifies the logical song, not a specific file. Selecting a new
// higher-quality copy during library refresh therefore preserves its position.
export const catalogueSongKey = (song) => normalizedTitle(song?.title)

// Existing entries keep their user-defined order. Unlisted songs are appended
// in the Catalogue's default (name-sorted) order, never inserted alphabetically
// into the middle of a manually arranged sequence.
export const orderedCatalogueSongs = (songs, rememberedTitles) => {
  if (!Array.isArray(rememberedTitles)) return songs
  const positions = new Map(rememberedTitles.map((key, index) => [key, index]))
  const known = []
  const added = []
  for (const song of songs) {
    if (positions.has(catalogueSongKey(song))) known.push(song)
    else added.push(song)
  }
  known.sort((a, b) => positions.get(catalogueSongKey(a)) - positions.get(catalogueSongKey(b)))
  return [...known, ...added]
}

export const moveCatalogueSong = (songs, from, to) => {
  if (from < 0 || to < 0 || from >= songs.length || to >= songs.length || from === to) return songs
  const result = [...songs]
  result.splice(to, 0, result.splice(from, 1)[0])
  return result
}

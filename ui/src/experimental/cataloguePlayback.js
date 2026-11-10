import { makeCatalogue } from './catalogueUtils'
import { orderedCatalogueSongs } from './catalogueOrder'

// Virtual playlist identity. No Navidrome playlist or M3U file is created.
export const CATALOGUE_PREFIX = 'catalogue:'
export const cataloguePlaylistId = (artistId) => `${CATALOGUE_PREFIX}${artistId}`
export const catalogueArtistId = (playlistId) => String(playlistId || '').startsWith(CATALOGUE_PREFIX)
  ? String(playlistId).slice(CATALOGUE_PREFIX.length) : null

// Look up ONLY the selected artist; the cached index is built by Refresh Library.
// Used by both Catalogue and Recently Played Playlists to ensure playback order
// and duplicate/quality selection are identical.
export const loadCatalogueArtistSongs = async (dataProvider, artist, savedOrder, isCancelled = () => false) => {
  const ids = artist?.artistIds || []
  if (!ids.length) throw new Error('No artist IDs in the catalogue index. Use Refresh Library to rebuild it.')
  const found = new Map()
  for (const id of ids) {
    for (let page = 1; ; page += 1) {
      if (isCancelled()) return []
      const response = await dataProvider.getList('song', {
        pagination: { page, perPage: 500 },
        sort: { field: 'id', order: 'ASC' },
        filter: { artists_id: id, missing: false },
      })
      const batch = response.data || []
      for (const song of batch) {
        if (String(song.artist || '').normalize('NFKC').toLocaleLowerCase('en') === artist.id) {
          found.set(song.id, song)
        }
      }
      if (batch.length < 500 || (Number.isFinite(response.total) && page * 500 >= response.total)) break
    }
  }
  const match = makeCatalogue([...found.values()]).find((item) => item.id === artist.id)
  return orderedCatalogueSongs(match?.songs || [], savedOrder)
}

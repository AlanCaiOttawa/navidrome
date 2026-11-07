import hanPinyin from './hanPinyin.json'

// Mixed Chinese/Latin sort key: compare the romanized letters, rather than
// relying on zh-CN collation (which groups all Han characters before Latin).
// Pinyin readings of polyphonic names may need artist-specific metadata later.
export const pinyinSortKey = (value) =>
  Array.from(String(value || '').normalize('NFKC'))
    .map((character) => hanPinyin[character] || character)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const nameOf = (album, field) => field === 'artist'
  ? album?.albumArtist || album?.artist || ''
  : album?.name || ''

export const sortCollectionAlbums = (albums, field = 'artist', direction = 'asc') => {
  const sign = direction === 'desc' ? -1 : 1
  const alternate = field === 'artist' ? 'album' : 'artist'
  return [...albums].sort((left, right) => {
    if (field === 'year' || field === 'songCount') {
      const a = Number(left?.[field] || 0)
      const b = Number(right?.[field] || 0)
      return sign * (a - b) || collator.compare(pinyinSortKey(left?.name), pinyinSortKey(right?.name))
    }
    const result = collator.compare(pinyinSortKey(nameOf(left, field)), pinyinSortKey(nameOf(right, field))) ||
      collator.compare(pinyinSortKey(nameOf(left, alternate)), pinyinSortKey(nameOf(right, alternate)))
    return sign * result || collator.compare(String(left?.id || ''), String(right?.id || ''))
  })
}

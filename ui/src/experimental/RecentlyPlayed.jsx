import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Title, useDataProvider } from 'react-admin'
import {
  Button, ButtonGroup, Card, CardContent, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@material-ui/core'
import PlayArrowIcon from '@material-ui/icons/PlayArrow'
import ViewModuleIcon from '@material-ui/icons/ViewModule'
import ViewListIcon from '@material-ui/icons/ViewList'
import LibraryMusicIcon from '@material-ui/icons/LibraryMusic'
import { Artwork } from '../common/Artwork'
import { playTracks } from '../actions'
import { choosePlayback, readState } from './api'
import { catalogueArtistId, loadCatalogueArtistSongs } from './cataloguePlayback'

const getRecentView = (type) => {
  try { return window.localStorage.getItem(`nd_recently_played_${type}_view`) === 'list' ? 'list' : 'cover' }
  catch { return 'cover' }
}

export default function RecentlyPlayed({ type }) {
  const dataProvider = useDataProvider()
  const dispatch = useDispatch()
  const [items, setItems] = useState([])
  const [records, setRecords] = useState({})
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(null)
  const [viewModes, setViewModes] = useState(() => ({ album: getRecentView('album'), playlist: getRecentView('playlist') }))
  const viewMode = viewModes[type] || 'cover'
  const changeView = (mode) => {
    setViewModes((previous) => ({ ...previous, [type]: mode }))
    try { window.localStorage.setItem(`nd_recently_played_${type}_view`, mode) }
    catch { /* Storage is optional (e.g., private mode). */ }
  }
  const resource = type === 'album' ? 'album' : 'playlist'
  const isCatalogue = (item) => type === 'playlist' && catalogueArtistId(item.id) !== null
  const label = type === 'album' ? 'Albums' : 'Playlists'

  useEffect(() => {
    let active = true
    setError('')
    async function load() {
      try {
        const state = await readState()
        const next = (state.progress || []).filter((p) => p.type === type)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 60)
        if (!active) return
        setItems(next)
        if (!next.length) { setRecords({}); return }
        // Virtual artist catalogues live in the saved index, not the playlist table.
        // Avoid getOne(playlist) for those IDs.
        const index = new Map((state.catalogueIndex || []).map((artist) => [artist.id, artist]))
        const results = await Promise.allSettled(next.map((item) => isCatalogue(item)
          ? Promise.resolve({ data: { id: item.id,
            name: item.name || `Catalogue — ${index.get(catalogueArtistId(item.id))?.name || catalogueArtistId(item.id)}`,
            virtualCatalogue: true } })
          : dataProvider.getOne(resource, { id: item.id })))
        if (!active) return
        const byId = {}
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value?.data) byId[next[index].id] = result.value.data
        })
        setRecords(byId)
      } catch (e) { if (active) setError(e?.message || String(e)) }
    }
    load()
    return () => { active = false }
  }, [type, resource, dataProvider])

  // Use the very same track list and choosePlayback helper as the album/playlist detail
  // pages. In particular, playlistTrack entry IDs must remain ordered for duplicates.
  const handlePlay = async (item) => {
    if (playing !== null) return
    setPlaying(item.id)
    setError('')
    try {
      let tracks
      if (isCatalogue(item)) {
        const state = await readState()
        const artistId = catalogueArtistId(item.id)
        const artist = (state.catalogueIndex || []).find((entry) => entry.id === artistId)
        if (!artist) throw new Error('Artist missing from saved Catalogue index. Open Catalogue and refresh the library.')
        tracks = await loadCatalogueArtistSongs(dataProvider, artist, state.catalogueOrders?.[artistId])
      } else {
        const result = await dataProvider.getList(type === 'album' ? 'song' : 'playlistTrack', {
          pagination: { page: 1, perPage: 0 },
          sort: { field: type === 'album' ? 'album' : 'id', order: 'ASC' },
          filter: type === 'album' ? { album_id: item.id } : { playlist_id: item.id },
        })
        tracks = result.data || []
      }
      if (!tracks.length) throw new Error(`No playable tracks found in this ${type}.`)
      const data = Object.fromEntries(tracks.map((track) => [track.id, track]))
      const ids = tracks.map((track) => track.id)
      await choosePlayback(type, item.id, records[item.id]?.name || item.name || item.id,
        data, ids, dispatch, playTracks)
    } catch (e) {
      setError(`Could not play ${records[item.id]?.name || item.name || type}: ${e?.message || String(e)}`)
    } finally { setPlaying(null) }
  }

  const title = (item) => records[item.id]?.name || item.name || item.id
  const url = (item) => isCatalogue(item)
    ? `#/catalogue?artist=${encodeURIComponent(catalogueArtistId(item.id))}`
    : `#/${type}/${item.id}/show`
  const coverRecord = (item) => {
    const record = records[item.id]
    if (isCatalogue(item)) return null // virtual playlist has no playlist artwork
    return type === 'playlist' && record ? { ...record, sync: !!record.sync } : record
  }
  const cover = (item, size) => <div style={{ width: size, height: size, overflow: 'hidden',
    borderRadius: 5, background: 'rgba(128,128,128,.12)', flexShrink: 0 }}>
    {coverRecord(item) ? <Artwork record={coverRecord(item)} square
      className="experimental-recent-cover" title={title(item)} /> : isCatalogue(item) ?
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><LibraryMusicIcon /></div> : null}
  </div>
  const playButton = (item) => <Button size="small" color="primary"
    startIcon={<PlayArrowIcon />} disabled={playing !== null || !records[item.id]}
    aria-label={`Play ${title(item)}`} onClick={() => handlePlay(item)}>
    {playing === item.id ? 'Loading...' : 'Play'}
  </Button>
  const lastPlayed = (item) => item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'

  return <div style={{ padding: 20, maxWidth: 1200 }}>
    <Title title={`Recently Played ${label}`} />
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
      alignItems: 'center', gap: 12 }}>
      <Typography variant="h5">Recently Played {label}</Typography>
      <ButtonGroup size="small" color="primary" aria-label="Recently played view mode">
        <Button variant={viewMode === 'cover' ? 'contained' : 'outlined'}
          aria-label="Cover view" onClick={() => changeView('cover')}>
          <ViewModuleIcon fontSize="small" /> Cover
        </Button>
        <Button variant={viewMode === 'list' ? 'contained' : 'outlined'}
          aria-label="List view" onClick={() => changeView('list')}>
          <ViewListIcon fontSize="small" /> List
        </Button>
      </ButtonGroup>
    </div>
    {error && <Typography color="error" style={{ marginTop: 12 }}>{error}</Typography>}
    {!items.length && <Typography color="textSecondary" style={{ marginTop: 12 }}>
      No {label.toLowerCase()} playback history yet.</Typography>}
    {viewMode === 'cover' ? (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
        gap: 18, marginTop: 18 }}>
        {items.map((item) => <Card key={item.id}><CardContent style={{ padding: 10 }}>
          <a href={url(item)} style={{ color: 'inherit', textDecoration: 'none' }}>
            <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 5,
              background: 'rgba(128,128,128,.12)' }}>
              {coverRecord(item) ? <Artwork record={coverRecord(item)} square
                className="experimental-recent-cover" title={title(item)} /> : isCatalogue(item) ?
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><LibraryMusicIcon fontSize="large" /></div> : null}
            </div>
            <Typography variant="body2" noWrap title={title(item)} style={{ marginTop: 7 }}>{title(item)}</Typography>
          </a>
          <Typography variant="caption" color="textSecondary" display="block">
            {lastPlayed(item)}
          </Typography>
          {playButton(item)}
        </CardContent></Card>)}
      </div>
    ) : (
      <TableContainer component={Card} style={{ marginTop: 18, overflowX: 'auto' }}>
        <Table size="small" aria-label={`Recently Played ${label}`}>
          <TableHead><TableRow>
            <TableCell style={{ width: 56 }}>Cover</TableCell>
            <TableCell>{type === 'album' ? 'Album' : 'Playlist'}</TableCell>
            {type === 'album' && <TableCell>Artist</TableCell>}
            <TableCell>Last played</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow></TableHead>
          <TableBody>{items.map((item) => <TableRow hover key={item.id}>
            <TableCell><a href={url(item)} style={{ display: 'block', width: 44, height: 44 }}>
              {cover(item, 44)}</a></TableCell>
            <TableCell><a href={url(item)} style={{ color: 'inherit', textDecoration: 'none' }}>
              {title(item)}</a></TableCell>
            {type === 'album' && <TableCell>{records[item.id]?.albumArtist || records[item.id]?.artist || '—'}</TableCell>}
            <TableCell>{lastPlayed(item)}</TableCell>
            <TableCell align="right">{playButton(item)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableContainer>
    )}
    <style>{`.experimental-recent-cover { width: 100%; height: 100%; display: block; object-fit: cover; }`}</style>
  </div>
}

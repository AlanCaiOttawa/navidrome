import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Title, useDataProvider } from 'react-admin'
import {
  Button, Card, CardContent, CircularProgress, TextField, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@material-ui/core'
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward'
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward'
import DragIndicatorIcon from '@material-ui/icons/DragIndicator'
import PushPinIcon from '@material-ui/icons/TurnedIn'
import PushPinOutlinedIcon from '@material-ui/icons/TurnedInNot'
import { choosePlayback, readState, saveCatalogueIndex, saveCatalogueOrder, saveCataloguePins, exportCatalogueM3U, setPlaybackContext } from './api'
import { catalogueSongKey, moveCatalogueSong, orderedCatalogueSongs } from './catalogueOrder'
import ArrowBackIcon from '@material-ui/icons/ArrowBack'
import PlayArrowIcon from '@material-ui/icons/PlayArrow'
import GetAppIcon from '@material-ui/icons/GetApp'
import PublishIcon from '@material-ui/icons/Publish'
import { Artwork } from '../common/Artwork'
import { playTracks } from '../actions'
import { makeCatalogue } from './catalogueUtils'
import { cataloguePlaylistId, loadCatalogueArtistSongs } from './cataloguePlayback'
import { arrangeCatalogueFromM3U, decodeM3U, parseCatalogueM3U } from './catalogueM3UImport'

const preferenceKey = 'nd_catalogue_min_songs'
const initialMin = () => {
  try {
    const saved = window.localStorage.getItem(preferenceKey)
    if (saved === null) return 5
    const stored = Number(saved)
    return Number.isInteger(stored) && stored >= 0 && stored <= 999999 ? stored : 5
  } catch { return 5 }
}

// Fetch the entire visible library in bounded pages, rather than relying on
// a server-specific "perPage=0 means all" convention. Include the song
// records needed for title deduplication and quality comparison.
const fetchLibrarySongs = async (dataProvider, onProgress, isCancelled) => {
  const pageSize = 500
  const all = []
  for (let page = 1; ; page += 1) {
    if (isCancelled()) return []
    const response = await dataProvider.getList('song', {
      pagination: { page, perPage: pageSize },
      sort: { field: 'id', order: 'ASC' },
      filter: { missing: false },
    })
    const batch = response.data || []
    all.push(...batch)
    onProgress(all.length)
    if (!batch.length || batch.length < pageSize || (Number.isFinite(response.total) && all.length >= response.total)) break
  }
  return all
}

export default function Catalogue() {
  const dataProvider = useDataProvider()
  const dispatch = useDispatch()
  const [minSongs, setMinSongs] = useState(initialMin)
  const [rawMin, setRawMin] = useState(String(initialMin()))
  const [artistsIndex, setArtistsIndex] = useState(null)
  const [artistSongs, setArtistSongs] = useState([])
  const [artistLoading, setArtistLoading] = useState(false)
  const [artistError, setArtistError] = useState('')
  const [selectedArtist, setSelectedArtist] = useState(() => {
    try {
      const query = window.location.hash.split('?')[1] || ''
      return new URLSearchParams(query).get('artist') || ''
    } catch { return '' }
  })
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [cataloguePins, setCataloguePins] = useState([])
  const [pinsSaving, setPinsSaving] = useState(false)
  const [pinsError, setPinsError] = useState('')
  const [pinSortOpen, setPinSortOpen] = useState(false)
  const [draftPins, setDraftPins] = useState([])
  const [draggedPin, setDraggedPin] = useState(null)
  const pinDragSource = useRef(null)
  const [catalogueOrders, setCatalogueOrders] = useState({})
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [sortSaving, setSortSaving] = useState(false)
  const [sortError, setSortError] = useState('')
  const [draggedIndex, setDraggedIndex] = useState(null)
  const dragSource = useRef(null)
  const m3uInput = useRef(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const minimumRef = useRef(minSongs)
  minimumRef.current = minSongs

  useEffect(() => {
    let cancelled = false
    setOrdersLoaded(false)
    setLoading(true)
    readState().then(async (state) => {
      if (cancelled) return
      setCatalogueOrders(state.catalogueOrders || {})
      const savedPins = Array.isArray(state.cataloguePins) ? state.cataloguePins : []
      const savedIndex = Array.isArray(state.catalogueIndex) ? state.catalogueIndex : null
      if (savedIndex) {
        const permitted = new Set(savedIndex.filter((a) => a.count > minimumRef.current).map((a) => a.id))
        const eligible = savedPins.filter((id) => permitted.has(id))
        if (eligible.length !== savedPins.length) {
          // Remove invalid pins on reload as well as when changing the minimum.
          const result = await saveCataloguePins(eligible, minimumRef.current)
          if (cancelled) return
          setCataloguePins(result.artists || [])
        } else setCataloguePins(savedPins)
      } else setCataloguePins(savedPins)
      // null signifies an index has never been built; [] is a valid empty index.
      setArtistsIndex(Array.isArray(state.catalogueIndex) ? state.catalogueIndex : null)
      if (!Array.isArray(state.catalogueIndex)) setReloadToken((n) => n + 1)
    }).catch((err) => {
      if (!cancelled) setError(`Could not read catalogue index: ${err?.message || err}`)
    }).finally(() => {
      if (!cancelled) { setOrdersLoaded(true); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (reloadToken === 0) return
    let cancelled = false
    setLoading(true)
    setError('')
    setLoadedCount(0)
    fetchLibrarySongs(dataProvider, (count) => { if (!cancelled) setLoadedCount(count) }, () => cancelled)
      .then(async (records) => {
        if (cancelled) return
        const index = makeCatalogue(records).map(({ id, name, count, artistIds }) => ({ id, name, count, artistIds }))
        await saveCatalogueIndex(index)
        if (!cancelled) { setArtistsIndex(index); setSelectedArtist('') }
        // Remove pins no longer present in the refreshed library index.
        const current = await readState()
        const valid = new Set(index.filter((artist) => artist.count > minimumRef.current).map((artist) => artist.id))
        const existing = current.cataloguePins || []
        const remaining = existing.filter((id) => valid.has(id))
        if (remaining.length !== existing.length) {
          const response = await saveCataloguePins(remaining, minimumRef.current)
          if (!cancelled) setCataloguePins(response.artists || [])
        } else if (!cancelled) setCataloguePins(existing)
      })
      .catch((err) => { if (!cancelled) setError(`Catalogue refresh failed: ${err?.message || err}`) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dataProvider, reloadToken])

  const artists = useMemo(() => (artistsIndex || []).filter((artist) => artist.count > minSongs), [artistsIndex, minSongs])
  const eligibleIds = useMemo(() => new Set(artists.map((artist) => artist.id)), [artists])
  const eligiblePins = useMemo(() => cataloguePins.filter((id) => eligibleIds.has(id)), [cataloguePins, eligibleIds])
  const pinRanks = useMemo(() => new Map(eligiblePins.map((id, i) => [id, i])), [eligiblePins])
  const persistPins = async (next, minimum = minSongs) => {
    if (pinsSaving) return
    const previous = cataloguePins
    setCataloguePins(next)
    setPinsSaving(true)
    setPinsError('')
    try {
      const response = await saveCataloguePins(next, minimum)
      setCataloguePins(response.artists || [])
    } catch (err) {
      setCataloguePins(previous)
      setPinsError(`Unable to save pinned artists: ${err?.message || err}`)
    } finally { setPinsSaving(false) }
  }
  const toggleArtistPin = (id) => {
    if (pinsSaving) return
    const next = eligiblePins.includes(id)
      ? eligiblePins.filter((key) => key !== id)
      : [...eligiblePins, id]
    persistPins(next)
  }
  // Reordering uses the existing per-user catalogue-pins endpoint. Changes
  // are staged in a dialog and saved only when the user chooses Save order.
  const openPinSorter = () => {
    setDraftPins([...eligiblePins])
    setPinSortOpen(true)
  }
  const movePinnedArtist = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= draftPins.length || to >= draftPins.length) return
    setDraftPins((current) => {
      const next = [...current]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }
  const savePinSort = async () => {
    if (pinsSaving) return
    const previous = cataloguePins
    setPinsSaving(true)
    setPinsError('')
    try {
      // The server preserves the submitted order, and independently verifies
      // that each artist still meets the current minimum-song threshold.
      const response = await saveCataloguePins(draftPins, minSongs)
      setCataloguePins(response.artists || [])
      setPinSortOpen(false)
    } catch (err) {
      setCataloguePins(previous)
      setPinsError(`Unable to save pinned artist order: ${err?.message || err}`)
    } finally {
      setPinsSaving(false)
    }
  }
  const selected = artists.find((artist) => artist.id === selectedArtist)
  useEffect(() => {
    if (!selected) { setArtistSongs([]); return }
    let cancelled = false
    setArtistLoading(true)
    setArtistError('')
    loadCatalogueArtistSongs(dataProvider, selected, null, () => cancelled)
      .then((songs) => { if (!cancelled) setArtistSongs(songs) })
      .catch((err) => { if (!cancelled) setArtistError(err?.message || String(err)) })
      .finally(() => { if (!cancelled) setArtistLoading(false) })
    return () => { cancelled = true }
  }, [dataProvider, selectedArtist, artistsIndex, minSongs])

  const orderedSongs = useMemo(() => selected
    ? orderedCatalogueSongs(artistSongs, catalogueOrders[selected.id])
    : [], [selected, artistSongs, catalogueOrders])
  const applySongOrder = async (from, to) => {
    if (!selected || sortSaving || !ordersLoaded || from === to) return
    const next = moveCatalogueSong(orderedSongs, from, to)
    if (next === orderedSongs) return
    const previous = catalogueOrders[selected.id]
    const titles = next.map(catalogueSongKey)
    setCatalogueOrders((existing) => ({ ...existing, [selected.id]: titles }))
    setSortSaving(true)
    setSortError('')
    try {
      await saveCatalogueOrder(selected.id, titles)
    } catch (err) {
      setCatalogueOrders((existing) => {
        const restored = { ...existing }
        if (previous === undefined) delete restored[selected.id]
        else restored[selected.id] = previous
        return restored
      })
      setSortError(`Unable to save song ordering: ${err?.message || err}`)
    } finally {
      setSortSaving(false)
    }
  }
  const visible = useMemo(() => artists
    .filter((artist) => artist.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      const ai = pinRanks.has(a.id) ? pinRanks.get(a.id) : Infinity
      const bi = pinRanks.has(b.id) ? pinRanks.get(b.id) : Infinity
      return ai - bi
    }), [artists, filter, pinRanks])
  const commitMinimum = (value) => {
    if (String(value).trim() === '') return
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999999) return
    setMinSongs(parsed)
    const newPins = cataloguePins.filter((id) => (artistsIndex || []).some((artist) => artist.id === id && artist.count > parsed))
    if (!pinsSaving && newPins.length !== cataloguePins.length) persistPins(newPins, parsed)
    try { window.localStorage.setItem(preferenceKey, String(parsed)) } catch { /* storage optional */ }
  }
  const handleCatalogueM3U = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // selecting the same file again should still work
    if (!file || !selected || sortSaving || artistLoading) return
    setImportError('')
    setImportPreview(null)
    try {
      if (!/\.m3u8?$/i.test(file.name)) throw new Error('Please choose an .m3u or .m3u8 file.')
      if (file.size > 2 * 1024 * 1024) throw new Error('M3U file exceeds the 2 MB limit.')
      const entries = parseCatalogueM3U(decodeM3U(await file.arrayBuffer()))
      if (!entries.length) throw new Error('No song entries were found in this file.')
      const result = arrangeCatalogueFromM3U(orderedSongs, entries, selected.name)
      setImportPreview({ ...result, fileName: file.name, total: entries.length, artistId: selected.id })
    } catch (err) {
      setImportError(err?.message || String(err))
    }
  }
  const confirmCatalogueM3U = async () => {
    if (!selected || !importPreview || importPreview.artistId !== selected.id || sortSaving || importBusy) return
    setImportBusy(true)
    setImportError('')
    try {
      const titles = importPreview.songs.map(catalogueSongKey)
      await saveCatalogueOrder(selected.id, titles)
      setCatalogueOrders((current) => ({ ...current, [selected.id]: titles }))
      setImportPreview(null)
    } catch (err) {
      setImportError(`Could not save imported order: ${err?.message || err}`)
    } finally { setImportBusy(false) }
  }
  const [exportBusy, setExportBusy] = useState(false)
  const exportArtistPlaylist = async () => {
    if (!selected || !orderedSongs.length || exportBusy || sortSaving) return
    setExportBusy(true)
    setArtistError('')
    try {
      // Use saved custom order and exactly one high-quality track per title.
      const response = await exportCatalogueM3U(selected.name, orderedSongs.map((song) => song.id))
      const safeName = `Catalogue - ${selected.name}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 150) || 'Catalogue'
      // UTF-8 BOM improves Chinese artist/title display in older Windows tools.
      const blob = new Blob(['\uFEFF', response.content], { type: 'audio/x-mpegurl;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `${safeName}.m3u`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10000)
    } catch (err) {
      setArtistError(`Cannot export Synology playlist: ${err?.message || err}`)
    } finally { setExportBusy(false) }
  }
  const [playLoading, setPlayLoading] = useState(false)
  // Each artist's Catalogue is a virtual playlist: its track order and resume
  // position are shared with the Recently Played Playlists page.
  const play = async (tracks, startId = null) => {
    if (!selected || !tracks.length || playLoading) return
    setPlayLoading(true)
    setArtistError('')
    const data = Object.fromEntries(tracks.map((song) => [song.id, song]))
    const ids = tracks.map((song) => song.id)
    const id = cataloguePlaylistId(selected.id)
    const name = `Catalogue — ${selected.name}`
    try {
      if (startId) {
        // A click on a particular song plays that song, while still tracking
        // this artist's virtual playlist and its saved sequence.
        setPlaybackContext('playlist', id, name, null, ids)
        dispatch(playTracks(data, ids, startId))
      } else {
        await choosePlayback('playlist', id, name, data, ids, dispatch, playTracks)
      }
    } catch (err) {
      setArtistError(`Cannot start Catalogue playback: ${err?.message || err}`)
    } finally { setPlayLoading(false) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <Title title="Catalogue" />
      <Typography variant="h5" gutterBottom>Catalogue</Typography>
      <Typography color="textSecondary" variant="body2" paragraph>
        Artists with more than the selected number of distinct songs in your saved library index.
        For duplicate song titles, the highest-quality available recording is shown.
        Each artist has its own saved song order; new songs appear at the end after you refresh the index.
        Pin artists to keep them at the top of the list. Use Sort pinned artists to customize their order;
        artists who no longer meet the minimum are automatically unpinned.
        Opening Catalogue uses the saved artist list; Refresh Library rebuilds it manually.
      </Typography>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <TextField label="Minimum songs (more than)" variant="outlined" size="small" type="number"
          inputProps={{ min: 0, max: 999999, step: 1 }} value={rawMin}
          onChange={(e) => { setRawMin(e.target.value); commitMinimum(e.target.value) }}
          onBlur={() => setRawMin(String(minSongs))} style={{ width: 215 }}
          helperText={`Currently: ${minSongs + 1} or more distinct songs`} />
        <TextField label="Find artist" variant="outlined" size="small" value={filter}
          onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 230 }} />
        <Button variant="outlined" onClick={() => setReloadToken((n) => n + 1)} disabled={loading}>Refresh library</Button>
      </div>
      {loading && <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <CircularProgress size={22} /><Typography color="textSecondary">Reading library ({loadedCount} tracks)...</Typography>
      </div>}
      {!loading && artistsIndex === null && !error && <Typography color="textSecondary">No catalogue index saved. Use Refresh Library to build it.</Typography>}
      {error && <Typography color="error" paragraph>{error}</Typography>}
      {sortError && <Typography color="error" paragraph>{sortError}</Typography>}
      {!loading && !error && artistsIndex !== null && <>
        {pinsError && <Typography color="error" paragraph>{pinsError}</Typography>}
        {selected ? <>
          <Button startIcon={<ArrowBackIcon />} onClick={() => setSelectedArtist('')} style={{ marginBottom: 12 }}>All artists</Button>
          <Typography variant="h6">{selected.name} — {selected.count} unique songs</Typography>
          {artistLoading && <Typography color="textSecondary">Loading songs for this artist...</Typography>}
          {artistError && <Typography color="error">{artistError}</Typography>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <Button color="primary" startIcon={<PlayArrowIcon />} disabled={artistLoading || playLoading || !orderedSongs.length} onClick={() => play(orderedSongs)}>Play all</Button>
            <input ref={m3uInput} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,audio/mpegurl" style={{ display: 'none' }} onChange={handleCatalogueM3U} />
            <Button variant="outlined" startIcon={<PublishIcon />} disabled={artistLoading || sortSaving || importBusy || !orderedSongs.length}
              onClick={() => m3uInput.current?.click()}>Import M3U order</Button>
            <Button variant="outlined" startIcon={<GetAppIcon />} disabled={artistLoading || sortSaving || exportBusy || !orderedSongs.length}
              onClick={exportArtistPlaylist}>{exportBusy ? 'Exporting...' : 'Export Synology M3U'}</Button>
          </div>
          {importError && <Typography color="error" paragraph>{importError}</Typography>}
          <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 10 }}>
            Import M3U order matches entries to this artist's Catalogue. Missing entries are skipped; remaining Catalogue songs are appended.
            Review the match summary before saving. No actual Navidrome playlist is created.
          </Typography>
          <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 10 }}>
            Exports this artist's current saved song order as a Synology-compatible .m3u file.
            Download it, then put it in your configured Synology Playlist folder. No Navidrome playlist is created.
          </Typography>
          <Typography variant="body2" color="textSecondary" style={{ marginBottom: 10 }}>
            Drag the six-dot handle to rearrange songs, or use the arrow buttons (also works on iPhone/iPad).
            The order is saved for your account and used by Play All.
            {!ordersLoaded ? ' Loading saved order...' : sortSaving ? ' Saving...' : ''}
          </Typography>
          <TableContainer><Table size="small" aria-label={`Songs by ${selected.name}`}>
            <TableHead><TableRow><TableCell style={{ width: 124 }}>Order</TableCell><TableCell style={{ width: 55 }}>Cover</TableCell><TableCell>Song title</TableCell>
              <TableCell>Album</TableCell><TableCell>Quality</TableCell><TableCell>Play</TableCell></TableRow></TableHead>
            <TableBody>{orderedSongs.map((song, index) => <TableRow hover key={song.id}
              onDragOver={(event) => { if (dragSource.current !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
              onDrop={(event) => {
                event.preventDefault()
                const from = dragSource.current
                dragSource.current = null
                setDraggedIndex(null)
                if (from !== null) applySongOrder(from, index)
              }}
              style={{ opacity: draggedIndex === index ? 0.6 : 1 }}>
              <TableCell style={{ whiteSpace: 'nowrap' }}>
                <span draggable={!sortSaving && ordersLoaded}
                  aria-label={`Drag to reorder ${song.title}`} title="Drag to reorder"
                  onDragStart={(event) => {
                    dragSource.current = index
                    setDraggedIndex(index)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(index))
                  }}
                  onDragEnd={() => { dragSource.current = null; setDraggedIndex(null) }}
                  style={{ display: 'inline-flex', verticalAlign: 'middle', cursor: 'grab', touchAction: 'none' }}>
                  <DragIndicatorIcon fontSize="small" style={{ opacity: 0.8, pointerEvents: 'none' }} />
                </span>
                <Button size="small" aria-label={`Move ${song.title} up`} disabled={!ordersLoaded || sortSaving || index === 0}
                  style={{ minWidth: 26, padding: 2 }} onClick={() => applySongOrder(index, index - 1)}><ArrowUpwardIcon fontSize="small" /></Button>
                <Button size="small" aria-label={`Move ${song.title} down`} disabled={!ordersLoaded || sortSaving || index === orderedSongs.length - 1}
                  style={{ minWidth: 26, padding: 2 }} onClick={() => applySongOrder(index, index + 1)}><ArrowDownwardIcon fontSize="small" /></Button>
              </TableCell>
              <TableCell><div style={{ width: 42, height: 42 }}><Artwork record={song} square title={song.title} /></div></TableCell>
              <TableCell>{song.title}</TableCell><TableCell>{song.album || '—'}</TableCell>
              <TableCell>{[String(song.suffix || '').toUpperCase(), song.bitDepth ? `${song.bitDepth}-bit` : '',
                song.sampleRate ? `${Math.round(song.sampleRate / 1000)} kHz` : '',
                song.bitRate ? `${song.bitRate} kbps` : ''].filter(Boolean).join(' · ') || '—'}</TableCell>
              <TableCell><Button size="small" startIcon={<PlayArrowIcon />}
                disabled={playLoading} onClick={() => play(orderedSongs, song.id)}>Play</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table></TableContainer>
        </> : <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Typography variant="subtitle1">{artists.length} artists meet the threshold · {eligiblePins.length} pinned</Typography>
            <Button variant="outlined" size="small" disabled={pinsSaving || loading || eligiblePins.length < 2}
              onClick={openPinSorter}>Sort pinned artists</Button>
          </div>
          {visible.length === 0 && <Typography color="textSecondary">No matching artists. Try a lower minimum or a different search.</Typography>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {visible.map((artist) => <Card key={artist.id} variant="outlined" style={{ cursor: 'pointer' }}
              onClick={() => setSelectedArtist(artist.id)}>
              <CardContent>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                  <Typography variant="subtitle1" style={{ overflowWrap: 'anywhere', flex: 1 }}>{artist.name}</Typography>
                  <Button size="small" title={eligiblePins.includes(artist.id) ? 'Unpin artist' : 'Pin artist to top'}
                    aria-label={`${eligiblePins.includes(artist.id) ? 'Unpin' : 'Pin'} ${artist.name}`}
                    disabled={pinsSaving} style={{ minWidth: 32, padding: 4 }}
                    onClick={(event) => { event.stopPropagation(); toggleArtistPin(artist.id) }}>
                    {eligiblePins.includes(artist.id) ? <PushPinIcon fontSize="small" color="primary" /> : <PushPinOutlinedIcon fontSize="small" />}
                  </Button>
                </div>
                <Typography variant="body2" color="textSecondary">{artist.count} unique songs</Typography>
              </CardContent>
            </Card>)}
          </div>
        </>}
      </>}
      <Dialog open={Boolean(importPreview)} onClose={() => { if (!importBusy) setImportPreview(null) }}
        fullWidth maxWidth="sm" aria-labelledby="catalogue-import-title">
        <DialogTitle id="catalogue-import-title">Import M3U song order</DialogTitle>
        <DialogContent dividers>
          {importPreview && <>
            <Typography variant="body2" paragraph>File: {importPreview.fileName}</Typography>
            <Typography variant="body2">M3U entries: {importPreview.total}</Typography>
            <Typography variant="body2">Matched distinct songs: {importPreview.matched}</Typography>
            <Typography variant="body2">Missing / unmatched entries skipped: {importPreview.missing}</Typography>
            <Typography variant="body2">Repeated entries skipped: {importPreview.duplicates}</Typography>
            <Typography variant="body2" paragraph>Catalogue songs appended to the end: {importPreview.appended}</Typography>
            {importPreview.unmatched.length > 0 && <Typography variant="caption" color="textSecondary" style={{ overflowWrap: 'anywhere' }}>
              First unmatched paths: {importPreview.unmatched.join(' • ')}
            </Typography>}
            <Typography variant="body2" style={{ marginTop: 12 }}>
              The imported sequence will replace this artist's saved order. Catalogue songs not listed in the M3U will remain at the end.
              Nothing will be deleted, and no Playlist or M3U file will be created on the server.
            </Typography>
          </>}
          {importError && <Typography color="error">{importError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button disabled={importBusy} onClick={() => { setImportPreview(null); setImportError('') }}>Cancel</Button>
          <Button color="primary" variant="contained" disabled={importBusy || !importPreview?.matched || sortSaving}
            onClick={confirmCatalogueM3U}>{importBusy ? 'Saving...' : 'Apply order'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pinSortOpen} onClose={() => { if (!pinsSaving) setPinSortOpen(false) }}
        fullWidth maxWidth="sm" aria-labelledby="pin-sort-title">
        <DialogTitle id="pin-sort-title">Sort pinned artists</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="textSecondary" style={{ marginBottom: 12 }}>
            Drag the handle to reorder pinned artists, or use the up/down buttons.
            Your order is saved for this account when you click Save order.
          </Typography>
          {draftPins.map((id, index) => {
            const artist = (artistsIndex || []).find((item) => item.id === id)
            return <div key={id}
              onDragOver={(event) => { if (pinDragSource.current !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
              onDrop={(event) => {
                event.preventDefault()
                const from = pinDragSource.current
                pinDragSource.current = null
                setDraggedPin(null)
                if (from !== null) movePinnedArtist(from, index)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0',
                borderBottom: '1px solid rgba(128,128,128,0.2)', opacity: draggedPin === index ? 0.55 : 1 }}>
              <span draggable={!pinsSaving} title={`Drag ${artist?.name || id} to reorder`}
                aria-label={`Drag ${artist?.name || id} to reorder`}
                onDragStart={(event) => {
                  pinDragSource.current = index
                  setDraggedPin(index)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', id)
                }}
                onDragEnd={() => { pinDragSource.current = null; setDraggedPin(null) }}
                style={{ display: 'inline-flex', cursor: 'grab', flexShrink: 0 }}>
                <DragIndicatorIcon fontSize="small" style={{ pointerEvents: 'none' }} />
              </span>
              <Typography variant="body2" style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                {index + 1}. {artist?.name || id}
              </Typography>
              <Button size="small" aria-label={`Move ${artist?.name || id} up`} disabled={pinsSaving || index === 0}
                style={{ minWidth: 32 }} onClick={() => movePinnedArtist(index, index - 1)}>
                <ArrowUpwardIcon fontSize="small" />
              </Button>
              <Button size="small" aria-label={`Move ${artist?.name || id} down`} disabled={pinsSaving || index === draftPins.length - 1}
                style={{ minWidth: 32 }} onClick={() => movePinnedArtist(index, index + 1)}>
                <ArrowDownwardIcon fontSize="small" />
              </Button>
            </div>
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinSortOpen(false)} disabled={pinsSaving}>Cancel</Button>
          <Button onClick={savePinSort} color="primary" variant="contained" disabled={pinsSaving || draftPins.length < 2}>
            {pinsSaving ? 'Saving...' : 'Save order'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

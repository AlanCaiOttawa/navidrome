import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Artwork } from '../common/Artwork'
import { Title, useDataProvider, useNotify } from 'react-admin'
import { Button, ButtonGroup, Card, CardContent, Typography, TextField, Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip } from '@material-ui/core'
import ViewModuleIcon from '@material-ui/icons/ViewModule'
import ViewListIcon from '@material-ui/icons/ViewList'
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward'
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward'
import FolderBrowser from './FolderBrowser'
import { sortCollectionAlbums } from './collectionSort'
import { readState, saveCollections } from './api'

const nowID = () => `collection-${Date.now()}-${Math.random().toString(36).slice(2)}`

const Collections = () => {
  const dataProvider = useDataProvider()
  const location = useLocation()
  const notify = useNotify()
  const [collections, setCollections] = useState([])
  const [albums, setAlbums] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('selected') || '')
  const [albumId, setAlbumId] = useState('')
  const [folderInfo, setFolderInfo] = useState(null)
  const [folderId, setFolderId] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(() => window.localStorage.getItem('nd_collection_view') || 'cover')
  const [sortBy, setSortBy] = useState(() => window.localStorage.getItem('nd_collection_sort') || 'artist')
  const [sortDirection, setSortDirection] = useState(() => window.localStorage.getItem('nd_collection_sort_direction') || 'asc')
  useEffect(() => { window.localStorage.setItem('nd_collection_view', viewMode) }, [viewMode])
  useEffect(() => { window.localStorage.setItem('nd_collection_sort', sortBy) }, [sortBy])
  useEffect(() => { window.localStorage.setItem('nd_collection_sort_direction', sortDirection) }, [sortDirection])
  const reload = () => readState().then((state) => {
    setCollections(state.collections || [])
  })
  useEffect(() => {
    reload().catch(() => notify('Could not load collections', 'warning')).finally(() => setLoading(false))
    dataProvider.getList('album', {
      pagination: { page: 1, perPage: 0 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    }).then((res) => setAlbums(res.data || [])).catch(() => notify('Could not load albums', 'warning'))
  }, [dataProvider, notify])
  useEffect(() => { setSelected(new URLSearchParams(location.search).get('selected') || '') }, [location.search])
  const persist = async (next) => {
    try {
      const saved = await saveCollections(next)
      setCollections(saved.collections || [])
      window.dispatchEvent(new Event('navidrome-collections-changed'))
    } catch {
      notify('Could not save changes', 'warning')
    }
  }
  const addCollection = () => {
    const name = newName.trim()
    if (!name) return
    const entry = { id: nowID(), name, albums: [] }
    persist([...collections, entry])
    setSelected(entry.id)
    setNewName('')
  }
  const change = (collectionID, updater) => persist(collections.map((c) =>
    c.id === collectionID ? updater(c) : c))
  const chosen = collections.find((c) => c.id === selected)
  const albumByID = useMemo(() => Object.fromEntries(albums.map((a) => [a.id, a])), [albums])
  const collectionAlbums = useMemo(() => sortCollectionAlbums(
    (chosen?.albums || []).map((id) => albumByID[id] || { id, name: `Album ${id}` }),
    sortBy, sortDirection,
  ), [chosen, albumByID, sortBy, sortDirection])
  const removeAlbum = (id) => change(chosen.id, (c) => ({ ...c, albums: c.albums.filter((a) => a !== id) }))
  return (
    <div style={{ padding: '16px', maxWidth: '1000px' }}>
      <Title title="Album Collections" />
      <style>{`.experimental-cover { width: 100%; aspect-ratio: 1; display: block; border-radius: 5px; background: rgba(128,128,128,.15); }`}</style>
      <Typography variant="h5" gutterBottom>Album Collections</Typography>
      <Typography color="textSecondary" variant="body2" gutterBottom>
        Choose a Collection from the sidebar to browse its albums, or browse all Collections below.
      </Typography>
      <Card><CardContent>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <TextField label="New collection" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button color="primary" variant="contained" onClick={addCollection}>Create</Button>
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} displayEmpty style={{ minWidth: 180 }}>
            <MenuItem value="">Choose a collection</MenuItem>
            {collections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name} ({c.albums.length})</MenuItem>)}
          </Select>
        </div>
      </CardContent></Card>
      {!chosen && !loading && <div style={{ marginBottom: 20 }}>
        <Typography variant="h6" gutterBottom>All Collections ({collections.length})</Typography>
        {collections.length === 0 && <Typography color="textSecondary">No Collections yet. Create one above.</Typography>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 18 }}>
          {collections.map((collection) => {
            const previewAlbums = (collection.albums || []).slice(0, 4).map((id) => albumByID[id]).filter(Boolean)
            return <a key={collection.id} href={`#/collections?selected=${encodeURIComponent(collection.id)}`}
              style={{ textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
              <Card style={{ height: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', aspectRatio: '1', overflow: 'hidden', background: 'rgba(128,128,128,.1)' }}>
                  {previewAlbums.map((album) => <Artwork key={album.id} record={album} square className="experimental-cover" title={album.name} />)}
                  {previewAlbums.length === 0 && <div style={{ gridColumn: 'span 2', alignSelf: 'center', textAlign: 'center', opacity: .65 }}>No albums</div>}
                </div>
                <CardContent>
                  <Typography variant="subtitle1" noWrap title={collection.name}>{collection.name}</Typography>
                  <Typography variant="body2" color="textSecondary">{(collection.albums || []).length} albums</Typography>
                </CardContent>
              </Card>
            </a>
          })}
        </div>
      </div>}
      {(chosen || loading) && <Card style={{ marginTop: 16 }}><CardContent>
        {chosen && <div style={{ marginTop: 18 }}>
          <Typography variant="h6">{chosen.name}</Typography>
          <Button onClick={() => { const name = window.prompt('Rename collection', chosen.name); if (name?.trim()) change(chosen.id, (c) => ({ ...c, name: name.trim() })) }}>Rename</Button>
          <Button onClick={() => { if (window.confirm(`Delete collection ${chosen.name}? Albums will not be deleted.`)) { persist(collections.filter((c) => c.id !== chosen.id)); setSelected('') } }}>Delete collection</Button>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <TextField label="Find album" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={albumId} onChange={(e) => setAlbumId(e.target.value)} displayEmpty style={{ minWidth: 260, maxWidth: '100%' }}>
              <MenuItem value="">Select album</MenuItem>
              {albums.filter((a) => (a.name || '').toLowerCase().includes(search.toLowerCase())).slice(0, 200).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
            </Select>
            <Button color="primary" onClick={() => albumId && change(chosen.id, (c) => ({ ...c, albums: [...new Set([...c.albums, albumId])] }))}>Add album</Button>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <Button variant="outlined" color="primary" onClick={() => setFolderDialogOpen(true)}>
              Browse music folders...
            </Button>
            {folderId && <Typography variant="body2">{folderInfo?.label || 'Selected folder'}</Typography>}
            <Button color="primary" disabled={!folderId} onClick={() => {
              const folder = folderInfo
              if (!folder || !window.confirm(`Add ${folder.albumIds.length} albums from ${folder.label} to ${chosen.name}?`)) return
              change(chosen.id, c => ({ ...c, albums: [...new Set([...c.albums, ...folder.albumIds])] }))
            }}>Add all albums in folder</Button>
            <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} fullWidth maxWidth="md">
              <DialogTitle>Select any music folder</DialogTitle>
              <DialogContent><FolderBrowser selected={folderId} onSelect={(id, entry) => { setFolderId(id); setFolderInfo(entry) }} /></DialogContent>
              <DialogActions><Button onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
                <Button variant="contained" color="primary" disabled={!folderId} onClick={() => setFolderDialogOpen(false)}>Use selected folder</Button>
              </DialogActions>
            </Dialog>
          </div>
          <div style={{ marginTop: 22, marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Typography variant="subtitle1" style={{ marginRight: 'auto' }}>Albums in this collection ({chosen.albums.length})</Typography>
            <TextField select size="small" variant="outlined" label="Sort by" value={sortBy}
              onChange={(event) => setSortBy(event.target.value)} style={{ minWidth: 148 }}>
              <MenuItem value="artist">Artist (Pinyin A–Z)</MenuItem>
              <MenuItem value="album">Album (Pinyin A–Z)</MenuItem>
              <MenuItem value="year">Year</MenuItem>
              <MenuItem value="songCount">Track count</MenuItem>
            </TextField>
            <Tooltip title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}>
              <Button size="small" variant="outlined" aria-label="Reverse sort order"
                onClick={() => setSortDirection((old) => old === 'asc' ? 'desc' : 'asc')}>
                {sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
                {sortDirection === 'asc' ? 'A–Z' : 'Z–A'}
              </Button>
            </Tooltip>
            <ButtonGroup color="primary" size="small" aria-label="Collection view mode">
              <Button variant={viewMode === 'cover' ? 'contained' : 'outlined'}
                aria-label="Cover view" onClick={() => setViewMode('cover')}><ViewModuleIcon fontSize="small" /> Cover</Button>
              <Button variant={viewMode === 'list' ? 'contained' : 'outlined'}
                aria-label="List view" onClick={() => setViewMode('list')}><ViewListIcon fontSize="small" /> List</Button>
            </ButtonGroup>
          </div>
          {viewMode === 'cover' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(135px,1fr))', gap: 18 }}>
              {collectionAlbums.map((album) => (
                <div key={album.id} style={{ minWidth: 0 }}>
                  <a href={`#/album/${album.id}/show`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <Artwork record={album} square className="experimental-cover" title={album.name} />
                    <Typography variant="body2" noWrap title={album.name}>{album.name}</Typography>
                    <Typography variant="caption" color="textSecondary" noWrap title={album.albumArtist || album.artist || ''}
                      style={{ display: 'block' }}>{album.albumArtist || album.artist || 'Unknown artist'}</Typography>
                  </a>
                  <Button size="small" onClick={() => removeAlbum(album.id)}>Remove</Button>
                </div>
              ))}
            </div>
          ) : (
            <TableContainer style={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Albums in Collection">
                <TableHead><TableRow>
                  <TableCell style={{ width: 52 }}>Cover</TableCell>
                  <TableCell><Button size="small" onClick={() => { setSortDirection(sortBy === 'album' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('album') }}>Album {sortBy === 'album' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</Button></TableCell>
                  <TableCell><Button size="small" onClick={() => { setSortDirection(sortBy === 'artist' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('artist') }}>Artist {sortBy === 'artist' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</Button></TableCell>
                  <TableCell align="right"><Button size="small" onClick={() => { setSortDirection(sortBy === 'year' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('year') }}>Year {sortBy === 'year' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</Button></TableCell>
                  <TableCell align="right"><Button size="small" onClick={() => { setSortDirection(sortBy === 'songCount' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('songCount') }}>Tracks {sortBy === 'songCount' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}</Button></TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {collectionAlbums.map((album) => <TableRow key={album.id} hover>
                    <TableCell style={{ width: 52 }}><div style={{ width: 42, height: 42 }}><Artwork record={album} square className="experimental-cover" title={album.name} /></div></TableCell>
                    <TableCell><a href={`#/album/${album.id}/show`} style={{ color: 'inherit', textDecoration: 'none' }}>{album.name}</a></TableCell>
                    <TableCell>{album.albumArtist || album.artist || 'Unknown artist'}</TableCell>
                    <TableCell align="right">{album.year || '—'}</TableCell>
                    <TableCell align="right">{album.songCount ?? '—'}</TableCell>
                    <TableCell align="right"><Button size="small" onClick={() => removeAlbum(album.id)}>Remove</Button></TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>}
        {loading && <Typography>Loading...</Typography>}
      </CardContent></Card>}

    </div>
  )
}
export default Collections

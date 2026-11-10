import React, { useCallback, useEffect, useState } from 'react'
import { Title, useDataProvider } from 'react-admin'
import { Button, Card, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, MenuItem, Select, TextField, Typography } from '@material-ui/core'
import { Artwork } from '../common/Artwork'
import { readState, pinRecentSong, getSongEditor, saveSongTags, getSongCoverFiles,
  useFolderCover, deleteSongCover, uploadSongCover, updateSongPlaylist } from './api'

const fields = [
  ['title', 'Song title'], ['artist', 'Artist'], ['album', 'Album'],
  ['albumArtist', 'Album artist'], ['genre', 'Genre'], ['year', 'Year'],
  ['trackNumber', 'Track number'],
]

export default function RecentSongEditing() {
  const dataProvider = useDataProvider()
  const [recent, setRecent] = useState([])
  const [songs, setSongs] = useState({})
  const [selected, setSelected] = useState(null)
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState({})
  const [pictures, setPictures] = useState([])
  const [folderPicture, setFolderPicture] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const state = await readState()
    const entries = (state.recentSongs || []).slice(0, 5)
    setRecent(entries)
    const results = await Promise.allSettled(entries.map((r) => dataProvider.getOne('song', { id: r.id })))
    const map = {}
    results.forEach((res, i) => { if (res.status === 'fulfilled') map[entries[i].id] = res.value.data })
    setSongs(map)
  }, [dataProvider])
  useEffect(() => { refresh().catch((e) => setError(e.message)) }, [refresh])

  // LAN HTTP pages may not have navigator.clipboard; provide a selection-based fallback.
  const copyText = async (value, description) => {
    setError(''); setMessage('')
    if (!value) { setError(`${description} is unavailable.`); return }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const el = document.createElement('textarea')
        el.value = value
        el.setAttribute('readonly', '')
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(el)
        if (!copied) throw new Error('Clipboard access was denied.')
      }
      setMessage(`${description} copied to clipboard.`)
    } catch (e) { setError(`Cannot copy ${description.toLowerCase()}: ${e.message}`) }
  }
  const openEditor = async (id) => {
    setError(''); setMessage(''); setBusy(true)
    try {
      const [details, covers] = await Promise.all([getSongEditor(id), getSongCoverFiles(id)])
      setSelected(id); setEditor(details)
      const track = details.song || {}
      setForm(Object.fromEntries(fields.map(([key]) => [key, String(track[key] ?? '')])))
      setPictures(covers.files || []); setFolderPicture('')
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const reloadEditor = async () => { if (selected) { const response = await getSongEditor(selected); setEditor(response) } }
  const change = async (action) => {
    setBusy(true); setError(''); setMessage('')
    try { const response = await action(); setMessage(response?.message || 'Saved.'); await reloadEditor(); await refresh() }
    catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }
  // Navidrome auto-imported M3U playlists are protected from edits while sync=true.
  // Reuse the same explicit opt-in toggle as PlaylistShow / M3USync; never silently
  // switch off sync during a track membership change.
  const enablePlaylistEditing = async (pl) => {
    if (!window.confirm(`Enable editing for "${pl.name}"?\n\nThis disables Navidrome's automatic M3U import for this playlist. You can then edit song membership here. To keep the original M3U file in sync, use the existing two-way M3U synchronization interface afterward.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const previous = await dataProvider.getOne('playlist', { id: pl.id })
      if (previous.data?.sync !== true) {
        await reloadEditor()
        setMessage('This playlist no longer has Auto-import enabled. Refreshed editing permissions.')
        return
      }
      await dataProvider.update('playlist', {
        id: pl.id,
        data: { ...previous.data, sync: false },
        previousData: previous.data,
      })
      const verified = await dataProvider.getOne('playlist', { id: pl.id })
      if (verified?.data?.sync !== false) throw new Error('Auto-import is still enabled; playlist settings were not changed.')
      await reloadEditor()
      setMessage(`Editing enabled for "${pl.name}". You may now add or remove this song. Use M3U two-way sync to export these changes to the source M3U file.`)
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const handlePin = (id, pinned) => change(async () => {
    const result = await pinRecentSong(id, pinned)
    setRecent(result.recentSongs || [])
    return { message: pinned ? 'Song pinned.' : 'Song unpinned.' }
  })
  const close = () => { setSelected(null); setEditor(null); setMessage(''); setError('') }
  return <div style={{ padding: 20, maxWidth: 1100 }}>
    <Title title="Recently Played Song Editing" />
    <Typography variant="h5">Recently Played Song Editing</Typography>
    <Typography color="textSecondary" style={{ margin: '8px 0 18px' }}>
      The five most recently played songs. Pinned songs stay in the list; when all five are pinned, new songs do not replace them.
    </Typography>
    {error && <Typography color="error" style={{ marginBottom: 12 }}>{error}</Typography>}
    {message && <Typography color="primary" style={{ marginBottom: 12 }}>{message}</Typography>}
    {!recent.length && <Typography color="textSecondary">Play a song to start the list, including songs played from Search.</Typography>}
    <Grid container spacing={2}>{recent.map((entry) => {
      const song = songs[entry.id]
      return <Grid item xs={12} sm={6} md={4} key={entry.id}>
        <Card style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 70, height: 70, flexShrink: 0, overflow: 'hidden' }}>
            {song && <Artwork record={song} square className="experimental-recent-song-art" />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap title={song?.title || entry.id}>{song?.title || 'Unknown song'}</Typography>
            <Typography variant="caption" color="textSecondary" display="block" noWrap>{song?.artist || '—'} · {song?.album || '—'}</Typography>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => handlePin(entry.id, !entry.pinned)} disabled={busy}>
                {entry.pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button size="small" color="primary" onClick={() => openEditor(entry.id)} disabled={busy}>Edit</Button>
              <Button size="small" onClick={() => copyText(song?.title, 'Song title')} disabled={!song}>Copy title</Button>
              <Button size="small" onClick={async () => {
                try { const info = await getSongEditor(entry.id); await copyText(info.fileName, 'File name') }
                catch (e) { setError(e.message || String(e)) }
              }} disabled={busy}>Copy filename</Button>
            </div>
          </div>
        </Card>
      </Grid>
    })}</Grid>
    <Dialog open={!!selected} onClose={busy ? undefined : close} maxWidth="sm" fullWidth>
      <DialogTitle>Edit song {editor?.song?.title ? `— ${editor.song.title}` : ''}</DialogTitle>
      <DialogContent dividers>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Button variant="outlined" size="small" onClick={() => copyText(editor?.song?.title, 'Song title')}>Copy song title</Button>
          <Button variant="outlined" size="small" onClick={() => copyText(editor?.fileName, 'File name')}>Copy file name</Button>
        </div>
        <Typography variant="h6">Metadata</Typography>
        <Typography variant="caption" color="textSecondary">Changes write to the audio file (administrator only). An original-file backup is retained. A library rescan may be needed.</Typography>
        {fields.map(([key, label]) => <TextField key={key} label={label} fullWidth margin="dense" value={form[key] || ''}
          disabled={busy || !editor?.fileEditingEnabled} onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.value }))} />)}
        {!editor?.fileEditingEnabled && <Typography color="error" variant="body2" style={{ marginTop: 8 }}>
          File editing is disabled until an administrator configures a separate writable music mount.
        </Typography>}
        <Button color="primary" variant="outlined" disabled={busy || !editor?.fileEditingEnabled}
          style={{ marginTop: 12 }} onClick={() => {
            const changed = Object.fromEntries(fields.filter(([key]) => form[key] !== String(editor?.song?.[key] ?? ''))
              .map(([key]) => [key, form[key]]))
            if (Object.keys(changed).length) change(() => saveSongTags(selected, changed))
            else setMessage('No metadata changes to save.')
          }}>Save metadata</Button>
        <Typography variant="h6" style={{ marginTop: 22 }}>Cover picture</Typography>
        <Typography variant="caption" color="textSecondary" display="block">
          Embedded-art editing supports MP3/M4A. Choose a JPEG or PNG from iOS Photos, Files, or a computer folder; or select an existing image in the song folder.
        </Typography>
        <div style={{ marginTop: 10 }}>
          <Button component="label" variant="outlined" color="primary" disabled={busy || !editor?.fileEditingEnabled}>
            Choose image from device
            <input type="file" hidden accept="image/jpeg,image/png" onChange={(e) => {
              const file = e.target.files?.[0]; if (file) change(() => uploadSongCover(selected, file)); e.target.value = ''
            }} />
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <Select value={folderPicture} displayEmpty onChange={(e) => setFolderPicture(e.target.value)}
            disabled={busy || !pictures.length || !editor?.fileEditingEnabled} style={{ minWidth: 180 }}>
            <MenuItem value="">Image in song folder</MenuItem>
            {pictures.map((name) => <MenuItem value={name} key={name}>{name}</MenuItem>)}
          </Select>
          <Button size="small" disabled={!folderPicture || busy || !editor?.fileEditingEnabled}
            onClick={() => change(() => useFolderCover(selected, folderPicture))}>Use folder image</Button>
          <Button size="small" color="secondary" disabled={busy || !editor?.fileEditingEnabled}
            onClick={() => { if (window.confirm('Remove embedded artwork from this song?')) change(() => deleteSongCover(selected)) }}>Remove embedded cover</Button>
        </div>
        <Typography variant="h6" style={{ marginTop: 24 }}>Playlist membership</Typography>
        <Typography variant="caption" color="textSecondary" display="block">
          You can add a song to multiple playlists. File metadata editing is NOT required for playlist membership changes.
          Auto-imported M3U playlists need editing enabled explicitly; smart playlists remain read-only.
        </Typography>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: 8 }}>
          {(editor?.playlists || []).map((pl) => <div key={pl.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <FormControlLabel
              control={<Checkbox checked={!!pl.member} disabled={busy || !pl.editable}
                onChange={(e) => change(() => updateSongPlaylist(selected, pl.id, e.target.checked))} />}
              label={`${pl.name}${pl.smart ? ' (smart playlist — read-only)' : pl.sync ? ' (auto-import enabled)' : !pl.editable ? ' (read-only)' : ''}`} />
            {pl.sync && !pl.smart && <Button size="small" variant="outlined" color="primary"
              disabled={busy} onClick={() => enablePlaylistEditing(pl)}>Enable editing</Button>}
          </div>)}
        </div>
        {editor?.playlists?.length === 0 && <Typography color="textSecondary">No playlists available.</Typography>}
        {error && <Typography color="error" style={{ marginTop: 12 }}>{error}</Typography>}
        {message && <Typography color="primary" style={{ marginTop: 12 }}>{message}</Typography>}
      </DialogContent>
      <DialogActions><Button onClick={close} disabled={busy}>Close</Button></DialogActions>
    </Dialog>
    <style>{`.experimental-recent-song-art { width: 100%; height: 100%; object-fit: cover; }`}</style>
  </div>
}

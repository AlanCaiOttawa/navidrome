import React, { useEffect, useState } from 'react'
import FolderBrowser from './FolderBrowser'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@material-ui/core'

// Central Material-UI dialogs are accessible from album tiles, playlists and context menus.
// Dismissal is distinct from choosing 'Play from beginning'.
export const openExperimentalDialog = (detail) => new Promise((resolve) => {
  window.dispatchEvent(new CustomEvent('navidrome-experimental-dialog', { detail: { ...detail, resolve } }))
})
export const ExperimentalDialogs = () => {
  const [current, setCurrent] = useState(null)
  const [choice, setChoice] = useState('')
  const [newName, setNewName] = useState('')
  const [folder, setFolder] = useState('')
  const [folderInfo, setFolderInfo] = useState(null)
  useEffect(() => {
    const handler = (event) => {
      setCurrent(event.detail)
      setChoice(event.detail.collections?.[0]?.id || '__new__')
      setNewName('')
      setFolder('')
      setFolderInfo(null)
    }
    window.addEventListener('navidrome-experimental-dialog', handler)
    return () => window.removeEventListener('navidrome-experimental-dialog', handler)
  }, [])
  const finish = (value) => { current?.resolve(value); setCurrent(null) }
  return <Dialog open={!!current} onClose={() => finish(null)} fullWidth maxWidth="sm" aria-labelledby="experimental-dialog-title">
    <DialogTitle id="experimental-dialog-title">{current?.kind === 'resume' ? 'Resume playback?' : 'Add to Collection'}</DialogTitle>
    <DialogContent>
      {current?.kind === 'resume' ? <>
        <Typography variant="body1">{current.name}</Typography>
        <Typography color="textSecondary">{current.position}</Typography>
      </> : <>
        <Typography gutterBottom>{current?.kind === 'folder' ? 'Add all albums from this folder (including subfolders)' : current?.albumName}</Typography>
        {current?.kind === 'folder' && <FolderBrowser selected={folder} onSelect={(id, entry) => { setFolder(id); setFolderInfo(entry) }} />}
        <FormControl fullWidth variant="outlined" style={{ marginTop: 12 }}>
          <InputLabel id="experimental-collection-label">Collection</InputLabel>
          <Select labelId="experimental-collection-label" label="Collection" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {(current?.collections || []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            <MenuItem value="__new__">+ Create new collection</MenuItem>
          </Select>
        </FormControl>
        {choice === '__new__' && <TextField autoFocus fullWidth label="New collection name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ marginTop: 14 }} />}
      </>}
    </DialogContent>
    <DialogActions>
      {current?.kind === 'resume' ? <>
        <Button onClick={() => finish(null)}>Cancel</Button>
        <Button onClick={() => finish('start')}>Play from beginning</Button>
        <Button variant="contained" color="primary" onClick={() => finish('resume')}>Resume</Button>
      </> : <>
        <Button onClick={() => finish(null)}>Cancel</Button>
        <Button color="primary" variant="contained" disabled={(choice === '__new__' && !newName.trim()) || (current?.kind === 'folder' && !folder)}
          onClick={() => finish({ id: choice, name: newName.trim(), folderId: folder, folder: folderInfo })}>{current?.kind === 'folder' ? 'Add albums' : 'Add album'}</Button>
      </>}
    </DialogActions>
  </Dialog>
}

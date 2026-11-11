import React, { useCallback, useEffect, useState } from 'react'
import { Title, useDataProvider } from 'react-admin'
import { Button, Card, CardContent, Chip, TextField, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel } from '@material-ui/core'
import { readM3USyncStatus, readPlaylistFolder, savePlaylistFolder, previewM3UWriteback, saveM3UWriteback, previewTwoWaySync, applyTwoWaySync, readM3USchedule, saveM3USchedule, resolveUnmatchedM3U, browseM3USongs, importM3UFile, deleteMissingM3UPlaylist } from './api'
import subsonic from '../subsonic'

export default function M3USync() {
  const dataProvider = useDataProvider()
  const [report, setReport] = useState(null)
  const [syncPreview, setSyncPreview] = useState(null)
  const [folderSync, setFolderSync] = useState([])
  const [unmatchedChoice, setUnmatchedChoice] = useState(null)
  const [songBrowser, setSongBrowser] = useState(null)
  const [browseError, setBrowseError] = useState('')
  const [folder, setFolder] = useState('')
  const [activeFolder, setActiveFolder] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [writePreview, setWritePreview] = useState(null)
  const [schedule, setSchedule] = useState({ enabled: false, time: '00:00', timezone: 'America/Toronto' })
  const [lastRun, setLastRun] = useState(null)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const reloadSchedule = useCallback(async () => {
    const settings = await readM3USchedule()
    setSchedule(settings.schedule)
    setLastRun(settings.lastRun)
  }, [])
  const updateSchedule = async () => {
    setScheduleBusy(true); setScheduleError(''); setScheduleMessage('')
    try {
      const saved = await saveM3USchedule(schedule)
      setSchedule(saved.schedule)
      setScheduleMessage('Saved. The server checks for due synchronization jobs every 30 seconds. Conflicts are skipped.')
      await reloadSchedule()
    } catch (e) { setScheduleError(e?.message || String(e)) }
    finally { setScheduleBusy(false) }
  }

  const reload = useCallback(async () => {
    setBusy(true)
    try { setReport(await readM3USyncStatus()); setError('') }
    catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => {
    reload()
    reloadSchedule().catch((e) => setScheduleError(e?.message || String(e)))
    readPlaylistFolder().then((r) => { setFolder(r.folder || r.activeFolder || ''); setActiveFolder(r.activeFolder || '') })
      .catch(() => setMessage('Only administrators can edit the playlist folder setting.'))
  }, [reload])
  const saveFolder = async () => {
    setBusy(true)
    try {
      const r = await savePlaylistFolder(folder)
      setFolder(r.folder)
      setMessage('Folder saved. Restart the Navidrome container, then run Import from M3U Folder.')
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const scan = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      // Navidrome exposes an administrator-only scanner via its Subsonic API.
      // GET startScan initiates a background library scan including M3U imports.
      const response = await subsonic.startScan({ fullScan: false })
      if (response?.json?.['subsonic-response']?.status === 'failed') {
        throw new Error(response.json['subsonic-response'].error?.message || 'Navidrome scan failed')
      }
      setMessage('Library scan started. Navidrome will import changes from M3U files. Open Playlists after the scan finishes.')
      await reload()
    } catch (e) { setError(`M3U import scan failed: ${e?.message || String(e)}. Check Docker container logs for the backend error.`) }
    finally { setBusy(false) }
  }
  const importOne = async (file) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const imported = await importM3UFile(file.name)
      setMessage(`Imported ${file.name} into Navidrome as ${imported.name}.`)
      await reload()
    } catch (e) { setError(`Import failed: ${e?.message || e}`) }
    finally { setBusy(false) }
  }
  const deleteMissing = async (file) => {
    if (!window.confirm(`The source M3U ${file.name} is missing from Synology. Delete ONLY its Navidrome playlist? This cannot be undone.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await deleteMissingM3UPlaylist(file.playlistId)
      setMessage(`Deleted Navidrome playlist ${result.name}. The Synology files were not changed.`)
      await reload()
    } catch (e) { setError(`Deletion failed: ${e?.message || e}`) }
    finally { setBusy(false) }
  }
  const previewWrite = async (file) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const preview = await previewM3UWriteback(file.playlistId)
      setWritePreview({ ...preview, playlistId: file.playlistId })
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const writeBack = async () => {
    if (!writePreview) return
    setBusy(true); setError('')
    try {
      const saved = await saveM3UWriteback(writePreview.playlistId, writePreview.hash)
      setMessage(`Saved ${saved.filename} with backup ${saved.backup}. The next scan will read the updated M3U.`)
      setWritePreview(null)
      await reload()
    } catch (e) { setError(e?.message || String(e)); setWritePreview(null) }
    finally { setBusy(false) }
  }
  const enableEditing = async (file) => {
    setBusy(true); setError(''); setMessage('')
    try {
      await dataProvider.update('playlist', { id: file.playlistId, data: { sync: false }, previousData: { id: file.playlistId, sync: true } })
      setMessage(`Editing enabled for ${file.name}. Reload the playlist page to show song selection checkboxes. Use Preview two-way sync before importing or exporting changes.`)
      await reload()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const previewSync = async (file) => {
    setBusy(true); setError(''); setMessage('')
    try { setSyncPreview(await previewTwoWaySync(file.playlistId)) }
    catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const resolveUnmatched = async (action, candidate = '') => {
    if (!syncPreview || !unmatchedChoice) return
    setBusy(true); setError('')
    try {
      await resolveUnmatchedM3U(syncPreview.playlistId, {
        token: syncPreview.token, path: unmatchedChoice.path, action, candidate,
      })
      const next = await previewTwoWaySync(syncPreview.playlistId)
      setSyncPreview(next)
      setUnmatchedChoice(null)
      setSongBrowser(null)
      setMessage(`Unmatched entry ${action === 'ignore' ? 'will be ignored on future synchronization' : 'resolved'}.`)
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const openSongBrowser = async (folder = '') => {
    setBrowseError('')
    try { setSongBrowser(await browseM3USongs(folder)) }
    catch (e) { setBrowseError(e?.message || String(e)) }
  }
  const previewFolderSync = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const inventory = await readM3USyncStatus()
      const candidates = (inventory.files || []).filter((f) => f.playlistId && !f.sync)
      const results = await Promise.all(candidates.map(async (f) => {
        try { return { ...await previewTwoWaySync(f.playlistId), error: null } }
        catch (error) { return { fileName: f.name, error: error?.message || String(error) } }
      }))
      setFolderSync(results)
      if (!candidates.length) setMessage('No editable linked playlists. For each imported M3U playlist, select Enable editing / two-way sync first.')
    } catch (e) { setError(`Folder synchronization preview failed: ${e?.message || String(e)}. See the Navidrome container logs for details.`) }
    finally { setBusy(false) }
  }
  const syncFolderSafe = async () => {
    setBusy(true); setError(''); setMessage('')
    let applied = 0, skipped = 0
    try {
      for (const item of folderSync) {
        const choices = { initialize: 'initialize', 'already-equal': 'initialize', 'import-file': 'file', 'export-nav': 'navidrome' }
        const choice = choices[item.status]
        if (!choice || item.error) { skipped++; continue }
        try { await applyTwoWaySync(item.playlistId, item.token, choice); applied++ }
        catch (e) { skipped++; setError(`Sync stopped on ${item.fileName}: ${e?.message || e}`); break }
      }
      setMessage(`Applied ${applied} safe one-sided synchronizations; skipped ${skipped} conflicted or blocked playlists. Review conflicts individually.`)
      setFolderSync([])
      await reload()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }
  const executeSync = async (choice) => {
    if (!syncPreview) return
    setBusy(true); setError('')
    try {
      await applyTwoWaySync(syncPreview.playlistId, syncPreview.token, choice)
      setMessage('Two-way synchronization finished. Baseline and reference M3U were updated. Refresh the playlist to see changes.')
      setSyncPreview(null)
      await reload()
    } catch (e) { setError(e?.message || String(e)); setSyncPreview(null) }
    finally { setBusy(false) }
  }
  return <div style={{ padding: 20, maxWidth: 980 }}>
    <Title title="Synology M3U Playlist Sync" />
    <Typography variant="h5" gutterBottom>Synology M3U Playlist Sync</Typography>
    <Card style={{ marginBottom: 16 }}><CardContent>
      <Typography variant="h6" gutterBottom>Playlist folder</Typography>
      <Typography color="textSecondary" variant="body2" gutterBottom>
        Choose a folder relative to /music, such as Playlist. Docker must already mount this directory.
      </Typography>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField label="Playlist folder under /music" value={folder} onChange={(e) => setFolder(e.target.value)} style={{ minWidth: 270 }} />
        <Button variant="contained" color="primary" disabled={busy} onClick={saveFolder}>Save folder</Button>
      </div>
      <Typography variant="caption" display="block">Active folder: {activeFolder || '(default)'}</Typography>
    </CardContent></Card>
    <Card style={{ marginBottom: 16 }}><CardContent>
      <Typography variant="h6" gutterBottom>Automatic two-way synchronization</Typography>
      <Typography color="textSecondary" variant="body2" gutterBottom>
        Run a safe, baseline-based sync once daily. One-sided changes are applied, and simultaneous changes,
        unmatched tracks, missing playlists, and initial mismatches are left for manual review.
        Source M3U files are backed up before every automatic write. Scheduling works only while Navidrome is running.
      </Typography>
      <FormControlLabel control={<Switch color="primary" checked={!!schedule.enabled}
        onChange={(e) => setSchedule((old) => ({ ...old, enabled: e.target.checked }))} />}
        label="Enable automatic synchronization" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Typography component="label" htmlFor="m3u-daily-sync-time" variant="body2" style={{ whiteSpace: 'nowrap' }}>
            Daily synchronization time
          </Typography>
          <TextField id="m3u-daily-sync-time" type="time" variant="outlined" size="small"
            inputProps={{ step: 60, 'aria-label': 'Daily synchronization time' }}
            style={{ width: 155 }} value={schedule.time || '00:00'}
            onChange={(e) => setSchedule((old) => ({ ...old, time: e.target.value }))} />
        </div>
        <Typography variant="body2" color="textSecondary">Timezone: America/Toronto</Typography>
        <Button variant="contained" color="primary" disabled={scheduleBusy} onClick={updateSchedule}>Save schedule</Button>
        <Button disabled={scheduleBusy} onClick={() => reloadSchedule().catch((e) => setScheduleError(e.message))}>Refresh status</Button>
      </div>
      <Typography variant="caption" display="block" style={{ marginTop: 10 }}>
        A missed run executes once after the server starts, if the scheduled time has already passed that day.
        First-time nonmatching playlists and conflicts will never be resolved automatically.
      </Typography>
      {scheduleMessage && <Typography>{scheduleMessage}</Typography>}
      {scheduleError && <Typography color="error">{scheduleError}</Typography>}
      {lastRun && <div style={{ marginTop: 14 }}>
        <Typography variant="subtitle2">Last automatic synchronization: {lastRun.startedAt || lastRun.date}</Typography>
        <Typography variant="body2">Applied / baselines: {lastRun.applied || 0} · Skipped: {lastRun.skipped || 0}</Typography>
        {(lastRun.outcomes || []).map((row, i) => <Typography key={i} variant="caption" display="block">
          {row.fileName || '(folder)'}: {row.action}{row.detail ? ` — ${row.detail}` : ''}
        </Typography>)}
      </div>}
    </CardContent></Card>
    <Card><CardContent>
      <Typography variant="h6" gutterBottom>Playlist synchronization</Typography>
      <Typography color="textSecondary" gutterBottom>
        Import from M3U Folder reads new and modified files into Navidrome for auto-import playlists.
        For M3U playlists, enable editing first (this disables Navidrome's one-way auto-import). Then Preview two-way sync to compare the M3U and Navidrome against a saved reference. One-sided edits sync in their direction; concurrent edits require an explicit choice.
      </Typography>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="contained" color="primary" onClick={scan} disabled={busy}>Import from M3U Folder</Button>
        <Button onClick={reload} disabled={busy}>Refresh folder inventory</Button>
        <Button variant="outlined" color="primary" onClick={previewFolderSync} disabled={busy}>Sync entire M3U folder ↔ Navidrome</Button>
      </div>
      {error && <Typography color="error" style={{ marginTop: 12 }}>{error}</Typography>}
      {message && <Typography style={{ marginTop: 12 }}>{message}</Typography>}
      {folderSync.length > 0 && <Card style={{ marginTop: 14, padding: 14 }}>
        <Typography variant="h6">Folder-wide three-way sync preview</Typography>
        <Typography color="textSecondary" variant="body2">Only matching, one-sided changes will be applied automatically. Concurrent changes require individual review and selection; blocked files remain untouched.</Typography>
        {folderSync.map((item, i) => <div key={`${item.fileName}-${i}`} style={{ padding: 8, borderBottom: '1px solid #777' }}>
          <Typography>{item.fileName}: <strong>{item.error || item.status}</strong></Typography>
          {!item.error && <Typography variant="caption">M3U {item.fileCount} tracks · Navidrome {item.navidromeCount} tracks</Typography>}
          {['conflict', 'first-run-conflict', 'unmatched'].includes(item.status) && <Button size="small" color="secondary" onClick={() => setSyncPreview(item)}>{item.status === 'unmatched' ? 'Review unmatched tracks' : 'Resolve conflict'}</Button>}
        </div>)}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button color="primary" variant="contained" disabled={busy} onClick={syncFolderSafe}>Apply safe changes</Button>
          <Button onClick={() => setFolderSync([])}>Cancel</Button>
        </div>
      </Card>}
      {report && <>
        <Typography style={{ marginTop: 14 }}>Folder: {report.folder} · M3U files: {report.count}</Typography>
        <div style={{ display: 'grid', gap: 10, marginTop: 15 }}>
          {report.files.map((f) => <Card key={f.name}><CardContent>
            <Typography variant="subtitle1">{f.name}</Typography>
            <Chip size="small" label={`${f.tracks} tracks`} />{' '}
            <Chip size="small" label={f.status} />
            <Typography variant="caption" display="block" color="textSecondary">Last modified: {f.modifiedAt}</Typography>
            {!f.playlistId && !f.missing && <Button size="small" variant="contained" color="primary" disabled={busy}
              style={{ marginTop: 8 }} onClick={() => importOne(f)}>Import to Navidrome</Button>}
            {f.missing && f.playlistId && <Button size="small" variant="outlined" color="secondary" disabled={busy}
              style={{ marginTop: 8 }} onClick={() => deleteMissing(f)}>Delete in Navidrome</Button>}
            {!f.missing && f.playlistId && !f.sync && <Button size="small" color="primary" disabled={busy} style={{ marginTop: 8 }}
              onClick={() => previewWrite(f)}>Preview Navidrome → M3U writeback</Button>}
            {!f.missing && f.playlistId && f.sync && <div style={{ marginTop: 8 }}>
              <Typography variant="caption" display="block" color="textSecondary">Auto-import locks editing and hides song checkboxes. Enable editing to use custom two-way sync; regular library scans will no longer overwrite local playlist edits.</Typography>
              <Button size="small" color="primary" disabled={busy} onClick={() => enableEditing(f)}>Enable editing / two-way sync</Button>
            </div>}
            {!f.missing && f.playlistId && !f.sync && <Button size="small" variant="contained" color="primary" disabled={busy} style={{ marginTop: 8, marginLeft: 8 }} onClick={() => previewSync(f)}>Preview two-way sync</Button>}
          </CardContent></Card>)}
        </div>
      </>}
      <Typography variant="body2" color="textSecondary" style={{ marginTop: 16 }}>
        Manual two-way sync is also available. Scheduled safe synchronization runs only when enabled. A baseline snapshot and a reference M3U copy are saved under /data/experimental/m3u-sync. Concurrent edits are never merged or overwritten silently: you must choose a side. M3U writes create timestamped backups. Missing source M3Us can be removed from Navidrome individually after explicit confirmation; source files are never deleted by this control. Automatic merging is not supported. Conflicts are never overwritten by scheduled sync.
      </Typography>
    </CardContent></Card>
    <Dialog open={!!syncPreview} onClose={() => setSyncPreview(null)} fullWidth maxWidth="sm">
      <DialogTitle>Two-way playlist synchronization</DialogTitle>
      <DialogContent>
        <Typography gutterBottom><strong>{syncPreview?.fileName}</strong></Typography>
        <Typography gutterBottom>M3U: {syncPreview?.fileCount} tracks · Navidrome: {syncPreview?.navidromeCount} tracks</Typography>
        <Typography gutterBottom>Status: <strong>{syncPreview?.status}</strong></Typography>
        {syncPreview?.status === 'unmatched' && <>
          <Typography color="error" gutterBottom>
            New M3U entries cannot be matched to indexed songs. Resolve each one before synchronization.
            This is not used for songs deleted from either side.
          </Typography>
          {(syncPreview?.unmatched || []).map((entry) => <Card key={entry.path} style={{ marginBottom: 10, padding: 12 }}>
            <Typography variant="body2" style={{ overflowWrap: 'anywhere' }}>{entry.entry}</Typography>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Button size="small" disabled={busy} onClick={() => setUnmatchedChoice(entry)}>Choose action</Button>
            </div>
          </Card>)}
        </>}
        {syncPreview?.status === 'initialize' && <Typography>Both playlists match. Create a saved baseline to track future edits.</Typography>}
        {syncPreview?.status === 'already-equal' && <Typography>Both playlists match. Refresh the baseline.</Typography>}
        {syncPreview?.status === 'import-file' && <Typography>The M3U has changed since the baseline. Import its track list into Navidrome.</Typography>}
        {syncPreview?.status === 'export-nav' && <Typography>Navidrome has changed since the baseline. Export its track list into M3U with an automatic backup.</Typography>}
        {['conflict','first-run-conflict'].includes(syncPreview?.status) && <Typography color="error">Both sides differ from the baseline (or have no common baseline). Choose which side should win. The discarded side will be replaced. There is no automatic merge.</Typography>}
      </DialogContent>
      <DialogActions style={{ flexWrap: 'wrap' }}>
        <Button onClick={() => setSyncPreview(null)}>Cancel</Button>
        {['initialize','already-equal'].includes(syncPreview?.status) && <Button disabled={busy} variant="contained" color="primary" onClick={() => executeSync('initialize')}>Save baseline</Button>}
        {['import-file','conflict','first-run-conflict'].includes(syncPreview?.status) && <Button disabled={busy} variant="contained" color="primary" onClick={() => executeSync('file')}>Use M3U → Navidrome</Button>}
        {['export-nav','conflict','first-run-conflict'].includes(syncPreview?.status) && <Button disabled={busy} variant="contained" color="secondary" onClick={() => executeSync('navidrome')}>Use Navidrome → M3U</Button>}
      </DialogActions>
    </Dialog>
    <Dialog open={!!unmatchedChoice} onClose={() => { setUnmatchedChoice(null); setSongBrowser(null) }} fullWidth maxWidth="md">
      <DialogTitle>Unmatched song added to M3U</DialogTitle>
      <DialogContent>
        <Typography style={{ overflowWrap: 'anywhere' }} gutterBottom>{unmatchedChoice?.entry}</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Remove deletes only this M3U entry (after backing up the M3U).
          Ignore leaves it untouched and excludes it from future matching attempts.
          Locate lets you browse the mounted music folders and repair the M3U path.
        </Typography>
        {songBrowser && <Card style={{ padding: 12, marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
          <Typography variant="subtitle2">Folder: {songBrowser.folder || '/music'}</Typography>
          <Button onClick={() => openSongBrowser((songBrowser.folder || '').split('/').slice(0, -1).join('/'))}>Up one level</Button>
          {(songBrowser.folders || []).map((f) => <div key={f.path}>
            <Button size="small" onClick={() => openSongBrowser(f.path)}>📁 {f.name}</Button>
          </div>)}
          {(songBrowser.files || []).map((f) => <div key={f.path}>
            <Button size="small" onClick={() => resolveUnmatched('locate', f.path)} disabled={busy}>{f.name}</Button>
          </div>)}
          {browseError && <Typography color="error">{browseError}</Typography>}
        </Card>}
      </DialogContent>
      <DialogActions style={{ flexWrap: 'wrap' }}>
        <Button onClick={() => { setUnmatchedChoice(null); setSongBrowser(null) }}>Cancel</Button>
        <Button disabled={busy} color="secondary" onClick={() => resolveUnmatched('ignore')}>Keep and ignore</Button>
        <Button disabled={busy} color="secondary" onClick={() => resolveUnmatched('remove')}>Remove from M3U</Button>
        <Button disabled={busy} variant="contained" color="primary" onClick={() => openSongBrowser('')}>Find song in folders</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={!!writePreview} onClose={() => setWritePreview(null)} fullWidth maxWidth="md">
      <DialogTitle>Confirm M3U writeback</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>Save Navidrome's current playlist to {writePreview?.filename}?</Typography>
        <Typography color="textSecondary" variant="body2" gutterBottom>
          A backup will be made and the operation will be rejected if the source M3U has changed since preview.
          Verify track order and paths below before saving.
        </Typography>
        <pre style={{ maxHeight: 320, overflow: 'auto', padding: 12, whiteSpace: 'pre-wrap', background: 'rgba(128,128,128,.12)' }}>
          {writePreview?.preview}
        </pre>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setWritePreview(null)}>Cancel</Button>
        <Button variant="contained" color="primary" disabled={busy} onClick={writeBack}>Save to M3U</Button>
      </DialogActions>
    </Dialog>
  </div>
}

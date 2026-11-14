// Read-only M3U synchronization status displayed alongside Navidrome playlists.
// Reuse the same authoritative preview endpoint as Playlist Setting: never infer
// conflict solely from track counts or a stale, client-maintained flag.
import React, { useEffect, useState } from 'react'
import { Button, Chip, CircularProgress, Typography } from '@material-ui/core'
import WarningIcon from '@material-ui/icons/Warning'
import { useRecordContext } from 'react-admin'
import { previewTwoWaySync } from '../experimental/api'

// Bound concurrent inspections on the playlist list; the endpoint reads M3U
// files and their baselines. Cache briefly to avoid repeating work on rerenders.
const cache = new Map()
const pending = []
let running = 0
const MAX_PARALLEL = 3
const CACHE_MS = 30000
function next() {
  while (running < MAX_PARALLEL && pending.length) {
    const job = pending.shift()
    running += 1
    job().finally(() => { running -= 1; next() })
  }
}
function inspect(id, force = false) {
  const key = String(id)
  const cached = cache.get(key)
  if (!force && cached && (cached.promise || Date.now() - cached.time < CACHE_MS)) {
    return cached.promise || Promise.resolve(cached.result)
  }
  if (cached?.promise) return cached.promise
  let resolveTask
  let rejectTask
  const promise = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject })
  cache.set(key, { promise, time: Date.now() })
  pending.push(async () => {
    try {
      const result = await previewTwoWaySync(key)
      cache.set(key, { result, time: Date.now() })
      resolveTask(result)
    } catch (err) {
      // Do not cache failure. A temporary network/permission problem must not
      // be mistaken for a healthy synchronized playlist.
      cache.delete(key)
      rejectTask(err)
    }
  })
  next()
  return promise
}
const labels = {
  conflict: 'M3U conflict',
  'first-run-conflict': 'M3U conflict',
  unmatched: 'M3U unmatched tracks',
  'import-file': 'M3U has changes',
  'export-nav': 'Navidrome has changes',
  initialize: 'M3U baseline needed',
}

const useSyncStatus = (record, enabled) => {
  const id = record?.id
  const applicable = !!(id && record?.path && !record?.sync && enabled)
  const [state, setState] = useState({ loading: applicable, status: '', error: '' })
  useEffect(() => {
    if (!applicable) { setState({ loading: false, status: '', error: '' }); return undefined }
    let live = true
    const load = (force = false) => {
      if (live) setState((old) => ({ ...old, loading: true }))
      inspect(id, force).then((r) => {
        if (live) setState({ loading: false, status: r.status || '', error: '' })
      }).catch((e) => {
        if (live) setState({ loading: false, status: '', error: e?.message || 'Sync status unavailable' })
      })
    }
    load()
    // Refetch after returning from Playlist Setting or another browser tab.
    const onFocus = () => { cache.delete(String(id)); load(true) }
    window.addEventListener('focus', onFocus)
    return () => { live = false; window.removeEventListener('focus', onFocus) }
  }, [id, applicable])
  return { ...state, applicable, recheck: () => {
    if (applicable) { cache.delete(String(id)); return inspect(id, true).then((r) => setState({ loading: false, status: r.status || '', error: '' })).catch((e) => setState({ loading: false, status: '', error: e?.message || 'Sync status unavailable' })) }
  } }
}

// Datagrid field: only the linked, editable M3U playlists need an inspection.
export const PlaylistSyncField = ({ record: passedRecord }) => {
  const contextRecord = useRecordContext()
  const record = passedRecord || contextRecord
  const { loading, status, error, applicable } = useSyncStatus(record, true)
  if (!applicable) return null
  const text = labels[status]
  if (loading) return <CircularProgress size={14} />
  if (error) return <Chip size="small" variant="outlined" label="Sync check unavailable" title={error} />
  if (!text) return <Chip size="small" variant="outlined" label="M3U in sync" />
  return <a href="#/m3u-sync" onClick={(e) => e.stopPropagation()} title="Open Playlist Setting to review synchronization">
    <Chip clickable size="small" color={status === 'conflict' || status === 'first-run-conflict' || status === 'unmatched' ? 'secondary' : 'default'}
      icon={<WarningIcon />} label={text} />
  </a>
}
PlaylistSyncField.defaultProps = { source: 'm3uSyncStatus', label: 'M3U Sync', sortable: false }

// Playlist details: show a readable warning with a direct review link.
export const PlaylistSyncNotice = ({ record }) => {
  const { loading, status, error, applicable, recheck } = useSyncStatus(record, true)
  if (!applicable) return null
  const text = labels[status]
  if (!text && !error) return null
  return <div style={{ margin: '12px 0', border: '1px solid #bb8330', borderRadius: 6, padding: 12 }}>
    <Typography variant="subtitle2">
      <WarningIcon fontSize="small" style={{ verticalAlign: 'middle', marginRight: 6 }} />
      {error ? 'M3U sync status could not be checked' : text}
    </Typography>
    <Typography variant="body2" style={{ marginTop: 5 }}>
      {error ? error : 'The Synology M3U and Navidrome playlist need review. A sync conflict can block automatic sorting. Review the difference and choose the correct synchronization direction before sorting again.'}
    </Typography>
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Button size="small" variant="outlined" color="primary" href="#/m3u-sync">Open Playlist Setting</Button>
      <Button size="small" onClick={recheck} disabled={loading}>Recheck</Button>
    </div>
  </div>
}

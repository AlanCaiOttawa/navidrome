import { openExperimentalDialog } from './Dialogs'
import { httpClient } from '../dataProvider'

const url = '/api/experimental'
export const readState = async () =>
  (await httpClient(`${url}/state`)).json
export const saveCollections = async (items) =>
  (await httpClient(`${url}/collections`, {
    method: 'PUT',
    body: JSON.stringify(items),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })).json
// Serialize progress writes: asynchronous requests must never overtake one another.
// Keep the newest snapshot in memory so a context change can flush it immediately.
let progressWriteQueue = Promise.resolve()
let latestProgressSnapshot = null
const postProgress = (value) =>
  (httpClient(`${url}/progress`, {
    method: 'PUT',
    body: JSON.stringify(value),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })).then((response) => response.json)

export const saveProgress = (value) => {
  const position = { ...value, recordedAt: value.recordedAt || new Date().toISOString() }
  // Keep failed requests from permanently poisoning the queue.
  const writing = progressWriteQueue.catch(() => {}).then(() => postProgress(position))
  progressWriteQueue = writing
  return writing
}

export const rememberPlaybackPosition = (value) => {
  if (value?.id && value?.trackId && Number.isFinite(value.seconds) && value.seconds >= 0) {
    latestProgressSnapshot = { ...value, seconds: 0, duration: 0,
      recordedAt: new Date().toISOString() }
  }
}
export const flushPlaybackPosition = () => {
  const snapshot = latestProgressSnapshot
  if (!snapshot) return progressWriteQueue.catch(() => {})
  latestProgressSnapshot = null
  return saveProgress(snapshot)
}

const contextKey = 'nd-experimental-context'
const resumeKey = 'nd-experimental-resume'
export const setPlaybackContext = (type, id, name, resume = null, trackIds = []) => {
  // Flush the previous album/playlist before replacing its playback context.
  flushPlaybackPosition().catch((error) => console.warn('Previous position not saved:', error))
  sessionStorage.setItem(contextKey, JSON.stringify({ type, id, name, trackIds }))
  if (resume?.trackId && resume.seconds > 0) {
    sessionStorage.setItem(resumeKey, JSON.stringify({
      trackId: resume.trackId,
      seconds: resume.seconds,
    }))
  } else {
    sessionStorage.removeItem(resumeKey)
  }
}
export const getPlaybackContext = () => {
  try { return JSON.parse(sessionStorage.getItem(contextKey)) } catch { return null }
}
export const getResumeSeek = () => {
  try { return JSON.parse(sessionStorage.getItem(resumeKey)) } catch { return null }
}
export const clearResumeSeek = () => sessionStorage.removeItem(resumeKey)
// Music playback remembers only the last track, not its playback seconds.
// Resume always starts at the BEGINNING of the following track, wrapping
// to track 1 after the final track. Existing server records remain usable.
export const choosePlayback = async (type, id, name, data, ids, dispatch, playTracks) => {
  await flushPlaybackPosition().catch((error) => console.warn('Previous track not saved:', error))
  const orderedKeys = (ids?.length ? ids : Object.keys(data)).filter((key) => data[key])
  const trackIdOf = (key) => String(data[key]?.mediaFileId || data[key]?.id || '')
  let selectedKey = null
  try {
    const state = await readState()
    const prior = state.progress?.find((p) => p.type === type && p.id === id)
    const previousIndex = prior?.trackId
      ? orderedKeys.findIndex((key) => trackIdOf(key) === String(prior.trackId))
      : -1
    if (previousIndex >= 0 && orderedKeys.length > 0) {
      const nextKey = orderedKeys[(previousIndex + 1) % orderedKeys.length]
      const nextSong = data[nextKey]
      const decision = await openExperimentalDialog({ kind: 'resume', name,
        position: `Next track: ${nextSong?.title || nextSong?.name || `#${(previousIndex + 1) % orderedKeys.length + 1}`}` })
      if (decision === null) return
      if (decision === 'resume') selectedKey = nextKey
    }
  } catch (error) {
    console.warn('Could not read last played track:', error)
  }
  // No within-track seeking for albums or playlists, including old progress.
  setPlaybackContext(type, id, name, null, orderedKeys.map(trackIdOf).filter(Boolean))
  dispatch(playTracks(data, ids, selectedKey || undefined))
}

export const readPlaylistFolder = async () => (await httpClient(`${url}/playlist-folder`)).json
export const savePlaylistFolder = async (folder) => (await httpClient(`${url}/playlist-folder`, {
  method: 'PUT',
  body: JSON.stringify({ folder }),
  headers: new Headers({ 'Content-Type': 'application/json' }),
})).json

// Add one album to a selected collection, creating a collection when requested.
// The server persists collections per logged-in Navidrome user.
export const addAlbumToCollection = async (albumId, albumName) => {
  const state = await readState()
  const items = state.collections || []
  const picked = await openExperimentalDialog({ kind: 'collection', albumName, collections: items })
  if (!picked) return false
  const target = items.find((item) => item.id === picked.id)
  const collection = target || {
    id: `collection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: picked.name,
    albums: [],
  }
  const next = target ? items.map((item) => item.id === target.id
    ? { ...item, albums: [...new Set([...(item.albums || []), albumId])] }
    : item)
    : [...items, { ...collection, albums: [albumId] }]
  await saveCollections(next)
  window.dispatchEvent(new Event('navidrome-collections-changed'))
  return true
}

export const readCollectionFolders = async () =>
  (await httpClient(`${url}/collection-folders`)).json

export const readFolderTree = async ({ parent, search } = {}) => {
  const params = new URLSearchParams()
  if (parent) params.set('parent', parent)
  if (search) params.set('search', search)
  const qs = params.toString()
  return (await httpClient(`${url}/collection-folder-tree${qs ? `?${qs}` : ''}`)).json
}

export const readM3USyncStatus = async () => (await httpClient(`${url}/m3u-folder-status`)).json

// Choose an indexed music folder and destination using the same native dialog.
export const addFolderToCollection = async () => {
  const state = await readState()
  const items = state.collections || []
  const picked = await openExperimentalDialog({ kind: 'folder', collections: items })
  if (!picked) return false
  const selectedFolder = picked.folder
  if (!selectedFolder) throw new Error('Select a valid music folder')
  const target = items.find((item) => item.id === picked.id)
  const created = { id: `collection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: picked.name, albums: [] }
  const next = target ? items.map((item) => item.id === target.id
    ? { ...item, albums: [...new Set([...(item.albums || []), ...selectedFolder.albumIds])] }
    : item)
    : [...items, { ...created, albums: selectedFolder.albumIds }]
  await saveCollections(next)
  window.dispatchEvent(new Event('navidrome-collections-changed'))
  return true
}

export const previewM3UWriteback = async (playlistId) =>
  (await httpClient(`${url}/m3u/${encodeURIComponent(playlistId)}`)).json
export const saveM3UWriteback = async (playlistId, expectedHash) =>
  (await httpClient(`${url}/m3u/${encodeURIComponent(playlistId)}`, {
    method: 'POST',
    body: JSON.stringify({ expectedHash }),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })).json

// Explicit baseline-based two-way synchronization.
export const previewTwoWaySync = async (playlistId) =>
  (await httpClient(`${url}/m3u-sync/${encodeURIComponent(playlistId)}`)).json
export const applyTwoWaySync = async (playlistId, token, choice) => {
  try {
    return (await httpClient(`${url}/m3u-sync/${encodeURIComponent(playlistId)}`, {
      method: 'POST',
      body: JSON.stringify({ token, choice }),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })).json
  } catch (e) {
    // Navidrome's Go handler returns an explanatory plain-text error body.
    // react-admin otherwise often reduces it to "Internal Server Error".
    const details = typeof e?.body === 'string' ? e.body :
      (typeof e?.body?.message === 'string' ? e.body.message : '')
    throw new Error(`Playlist synchronization failed (HTTP ${e?.status || 'unknown'}): ${details || e?.message || String(e)}`)
  }
}

// Administrator-only scheduled sync settings, persisted server-side.
export const readM3USchedule = async () =>
  (await httpClient(`${url}/m3u-auto-schedule`)).json
export const saveM3USchedule = async (schedule) =>
  (await httpClient(`${url}/m3u-auto-schedule`, {
    method: 'PUT',
    body: JSON.stringify(schedule),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })).json

// Resolve only newly added M3U entries that are not indexed in Navidrome.
export const resolveUnmatchedM3U = async (playlistId, data) =>
  (await httpClient(`${url}/m3u-sync/${encodeURIComponent(playlistId)}/resolve`, {
    method: 'POST', body: JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })).json
export const browseM3USongs = async (folder = '') =>
  (await httpClient(`${url}/m3u-sync-browse?folder=${encodeURIComponent(folder)}`)).json

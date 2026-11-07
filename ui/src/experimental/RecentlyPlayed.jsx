import React, { useEffect, useState } from 'react'
import { Title, useDataProvider } from 'react-admin'
import { Card, CardContent, Typography } from '@material-ui/core'
import { Artwork } from '../common/Artwork'
import { readState } from './api'

export default function RecentlyPlayed({ type }) {
  const dataProvider = useDataProvider()
  const [items, setItems] = useState([])
  const [records, setRecords] = useState({})
  const [error, setError] = useState('')
  const resource = type === 'album' ? 'album' : 'playlist'
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const state = await readState()
        const next = (state.progress || []).filter((p) => p.type === type)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 60)
        if (!active) return
        setItems(next)
        if (!next.length) { setRecords({}); return }
        // Fetch only the actual recently played items, not an entire large library.
        const results = await Promise.allSettled(next.map((item) => dataProvider.getOne(resource, { id: item.id })))
        if (!active) return
        const byId = {}
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value?.data) {
            byId[next[index].id] = result.value.data
          }
        })
        setRecords(byId)
      } catch (e) { if (active) setError(e?.message || String(e)) }
    }
    load()
    return () => { active = false }
  }, [type, resource, dataProvider])
  const label = type === 'album' ? 'Albums' : 'Playlists'
  return <div style={{ padding: 20, maxWidth: 1200 }}>
    <Title title={`Recently Played ${label}`} />
    <Typography variant="h5" gutterBottom>Recently Played {label}</Typography>
    {error && <Typography color="error">{error}</Typography>}
    {!items.length && <Typography color="textSecondary">No {label.toLowerCase()} playback history yet.</Typography>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 18, marginTop: 18 }}>
      {items.map((item) => {
        const rec = records[item.id]
        return <Card key={item.id}><CardContent style={{ padding: 10 }}>
          <a href={`#/${type}/${item.id}/show`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <div style={{ aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 5, background: 'rgba(128,128,128,.12)' }}>
              {rec && <Artwork record={type === 'playlist' ? { ...rec, sync: !!rec.sync } : rec}
                square className="experimental-recent-cover" title={rec.name || item.name} />}
            </div>
            <Typography variant="body2" noWrap title={rec?.name || item.name || item.id} style={{ marginTop: 7 }}>
              {rec?.name || item.name || item.id}
            </Typography>
          </a>
          <Typography variant="caption" color="textSecondary" display="block">
            {Math.floor((item.seconds || 0) / 60)}:{String(Math.floor((item.seconds || 0) % 60)).padStart(2, '0')}
          </Typography>
          <Typography variant="caption" color="textSecondary" display="block">
            {item.updatedAt && new Date(item.updatedAt).toLocaleString()}
          </Typography>
        </CardContent></Card>
      })}
    </div>
    <style>{`.experimental-recent-cover { width: 100%; height: 100%; display: block; }`}</style>
  </div>
}

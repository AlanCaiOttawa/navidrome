import React, { useEffect, useRef } from 'react'
import { IconButton, Paper, Typography } from '@material-ui/core'
import { Close as CloseIcon } from '@material-ui/icons'

// Self-contained visual layer: does not change playback, the existing lyrics
// panel, or any of the user's customized catalogue/playlist behaviours.
const PluginLyricsPanel = ({ lyrics, trackTitle, currentTime, loading, error, onClose }) => {
  const active = lyrics?.synced
    ? lyrics.lines.reduce((result, line, index) => line.time <= currentTime + 0.05 ? index : result, -1)
    : -1
  const activeRef = useRef(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [active])

  return (
    <Paper elevation={12} role="region" aria-label="Online lyrics" style={{
      position: 'fixed', zIndex: 1400, top: 85, right: 18,
      width: 'min(420px, calc(100vw - 36px))', maxHeight: 'calc(100vh - 110px)',
      display: 'flex', flexDirection: 'column', background: '#202124', color: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 8 }}>
        <Typography variant="subtitle1" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Lyrics — {trackTitle || 'Current song'}
        </Typography>
        <IconButton size="small" aria-label="Close online lyrics" onClick={onClose} style={{ color: '#fff' }}><CloseIcon /></IconButton>
      </div>
      <div style={{ overflowY: 'auto', padding: '18px 22px', minHeight: 100, maxHeight: 'calc(100vh - 185px)', textAlign: 'center' }}>
        {loading && <Typography>Retrieving lyrics…</Typography>}
        {!loading && error && <Typography>Unable to retrieve lyrics. Check the plugin and server logs.</Typography>}
        {!loading && !error && !lyrics && <Typography>No lyrics available for this song.</Typography>}
        {!loading && lyrics?.lines.map((line, index) => (
          <p key={`${index}-${line.time}`} ref={index === active ? activeRef : null} style={{
            fontSize: 17, lineHeight: 1.65, margin: '0 0 16px', whiteSpace: 'pre-wrap',
            color: active === index ? '#93e4bb' : '#ddd', fontWeight: active === index ? 700 : 400,
          }}>{line.text || '\u00a0'}</p>
        ))}
      </div>
    </Paper>
  )
}

export default PluginLyricsPanel

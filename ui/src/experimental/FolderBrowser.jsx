import React, { useEffect, useState } from 'react'
import { Button, TextField, Typography } from '@material-ui/core'
import { ChevronRight, ExpandMore, FolderOutlined, Search } from '@material-ui/icons'
import { readFolderTree } from './api'

// Loads each branch on demand: no global folder cap, and multilingual names are
// treated exactly as returned by the Go filesystem layer.
export default function FolderBrowser({ selected = '', onSelect }) {
  const [root, setRoot] = useState([])
  const [children, setChildren] = useState({})
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState({})
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    let active = true
    readFolderTree().then(data => { if (active) setRoot(data.folders || []) })
      .catch(err => { if (active) setError(err.message || 'Could not load folders') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (!term) { setMatches([]); setSearching(false); return }
    let active = true
    const timer = setTimeout(() => {
      setSearching(true)
      readFolderTree({ search: term }).then(data => { if (active) { setMatches(data.folders || []); setError(data.truncated ? 'Showing first 200 matches; refine search for more.' : '') } })
        .catch(err => { if (active) setError(err.message || 'Folder search failed') })
        .finally(() => { if (active) setSearching(false) })
    }, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [query])

  const expand = async item => {
    if (expanded[item.id]) { setExpanded(old => ({ ...old, [item.id]: false })); return }
    setExpanded(old => ({ ...old, [item.id]: true }))
    if (children[item.id] !== undefined || !item.hasChildren) return
    setLoading(old => ({ ...old, [item.id]: true }))
    try {
      const data = await readFolderTree({ parent: item.id })
      setChildren(old => ({ ...old, [item.id]: data.folders || [] }))
    } catch (err) { setError(err.message || 'Cannot load subfolders') }
    finally { setLoading(old => ({ ...old, [item.id]: false })) }
  }

  const render = (item, depth = 0, flat = false) => <React.Fragment key={item.id}>
    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: flat ? 0 : Math.min(depth, 30) * 16,
      background: selected === item.id ? 'rgba(100,165,245,.22)' : 'transparent', borderRadius: 4, minHeight: 35 }}>
      <Button size="small" style={{ minWidth: 32, width: 32 }} disabled={flat || !item.hasChildren} onClick={() => expand(item)}>
        {!flat && item.hasChildren ? (expanded[item.id] ? <ExpandMore fontSize="small"/> : <ChevronRight fontSize="small"/>) : null}
      </Button>
      <FolderOutlined fontSize="small" style={{ marginRight: 8, opacity: .75 }}/>
      <button type="button" style={{ flex: 1, textAlign: 'left', background: 'transparent', color: 'inherit', border: 0,
        padding: 7, cursor: 'pointer', fontSize: 14 }} onClick={() => onSelect(item.id, item)}>
        {flat ? item.label : item.name} ({item.albumIds?.length || 0} albums)
      </button>
    </div>
    {!flat && expanded[item.id] && (children[item.id] || []).map(child => render(child, depth + 1))}
    {!flat && loading[item.id] && <Typography variant="caption" style={{ marginLeft: (depth + 1) * 16 + 40 }}>Loading folders...</Typography>}
  </React.Fragment>

  return <div>
    <TextField fullWidth size="small" variant="outlined" placeholder="Search folders by name or path (中文 supported)"
      value={query} onChange={e => setQuery(e.target.value)}
      InputProps={{ startAdornment: <Search fontSize="small" style={{ marginRight: 8, opacity: .65 }} /> }}/>
    {error && <Typography color="error" variant="caption">{error}</Typography>}
    <div role="tree" aria-label="Music folders" style={{ marginTop: 12, overflowY: 'auto', maxHeight: 380,
      border: '1px solid rgba(128,128,128,.35)', borderRadius: 5, padding: 8 }}>
      {query.trim() ? (searching ? <Typography>Searching all folders...</Typography> :
        matches.length ? matches.map(item => render(item, 0, true)) : <Typography>No matching folders</Typography>) :
        root.map(item => render(item))}
    </div>
  </div>
}

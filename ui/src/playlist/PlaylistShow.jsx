import React, { useState } from 'react'
import {
  ReferenceManyField,
  ShowContextProvider,
  useShowContext,
  useShowController,
  useDataProvider,
  useNotify,
  Title as RaTitle,
} from 'react-admin'
import { makeStyles } from '@material-ui/core/styles'
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, CircularProgress } from '@material-ui/core'
import EditIcon from '@material-ui/icons/Edit'
import PlaylistDetails from './PlaylistDetails'
import PlaylistSongs from './PlaylistSongs'
import PlaylistActions from './PlaylistActions'
import {
  Pagination,
  Title,
  canChangeTracks,
  isWritable,
  getStoredPerPage,
  useResourceRefresh,
} from '../common'

const playlistTrackPerPageOptions = [100, 250, 500]

const useStyles = makeStyles(
  (theme) => ({
    playlistActions: {
      width: '100%',
    },
  }),
  {
    name: 'NDPlaylistShow',
  },
)

// Explicitly unlock an imported M3U playlist for Navidrome-side editing.
// The native auto-import flag MUST be disabled first, otherwise the scanner
// can replace locally edited tracks with the source M3U on the next scan.
const EnableImportedPlaylistEditing = ({ record }) => {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const dataProvider = useDataProvider()
  const notify = useNotify()

  if (!record?.path || !record.sync || !isWritable(record.ownerId)) return null

  const enable = async () => {
    setBusy(true)
    try {
      await dataProvider.update('playlist', {
        id: record.id,
        data: { ...record, sync: false },
        previousData: record,
      })
      // Read back the persisted flag; don't claim the playlist is editable
      // just because the API accepted an update request.
      const updated = await dataProvider.getOne('playlist', { id: record.id })
      if (updated?.data?.sync !== false) {
        throw new Error('Auto-import is still enabled. Please check playlist permissions.')
      }
      setOpen(false)
      window.location.reload()
    } catch (error) {
      notify(`Unable to enable editing: ${error?.message || error}`, 'warning')
      setBusy(false)
    }
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <Button color="primary" variant="outlined" startIcon={<EditIcon />} onClick={() => setOpen(true)}>
        Enable Editing (M3U Playlist)
      </Button>
      <Typography variant="caption" color="textSecondary" display="block">
        This imported playlist is currently read-only because Auto-import is enabled.
      </Typography>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Enable playlist editing?</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            This disables Navidrome's original automatic M3U import for this playlist.
            You can then select, remove, and reorder songs here.
          </Typography>
          <Typography>
            To reconcile later changes with the source M3U file, use the separate
            M3U Playlist Sync page. Your M3U file will not be changed by this action.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy} color="primary" variant="contained" onClick={enable}>
            {busy ? <CircularProgress size={20} /> : 'Enable Editing'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

const PlaylistShowLayout = (props) => {
  const { loading, ...context } = useShowContext(props)
  const { record } = context
  const classes = useStyles()
  useResourceRefresh('playlistTrack', 'song')

  return (
    <>
      {record && <RaTitle title={<Title subTitle={record.name} />} />}
      {record && <PlaylistDetails {...context} />}
      {record && <EnableImportedPlaylistEditing record={record} />}
      {record && (
        <ReferenceManyField
          {...context}
          addLabel={false}
          reference="playlistTrack"
          target="playlist_id"
          sort={{ field: 'id', order: 'ASC' }}
          perPage={getStoredPerPage(
            'playlistTrack',
            playlistTrackPerPageOptions,
          )}
          filter={{ playlist_id: props.id }}
        >
          <PlaylistSongs
            {...props}
            readOnly={!canChangeTracks(record)}
            title={<Title subTitle={record.name} />}
            actions={
              <PlaylistActions
                className={classes.playlistActions}
                record={record}
              />
            }
            resource={'playlistTrack'}
            exporter={false}
            pagination={
              <Pagination rowsPerPageOptions={playlistTrackPerPageOptions} />
            }
          />
        </ReferenceManyField>
      )}
    </>
  )
}

const PlaylistShow = (props) => {
  const controllerProps = useShowController(props)
  return (
    <ShowContextProvider value={controllerProps}>
      <PlaylistShowLayout {...props} {...controllerProps} />
    </ShowContextProvider>
  )
}

export default PlaylistShow

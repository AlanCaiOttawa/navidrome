import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Avatar, Divider, makeStyles, Tooltip } from '@material-ui/core'
import clsx from 'clsx'
import { useTranslate, MenuItemLink, getResources } from 'react-admin'
import ViewListIcon from '@material-ui/icons/ViewList'
import AlbumIcon from '@material-ui/icons/Album'
import CollectionsBookmarkIcon from '@material-ui/icons/CollectionsBookmark'
import SubMenu from './SubMenu'
import { humanize, pluralize } from 'inflection'
import albumLists from '../album/albumLists'
import PlaylistsSubMenu from './PlaylistsSubMenu'
import LibrarySelector from '../common/LibrarySelector'
import config from '../config'
import { readState } from '../experimental/api'
import FolderSpecialIcon from '@material-ui/icons/FolderSpecial'
import SyncIcon from '@material-ui/icons/Sync'
import ViewModuleIcon from '@material-ui/icons/ViewModule'
import MusicNoteIcon from '@material-ui/icons/MusicNote'
import LibraryMusicIcon from '@material-ui/icons/LibraryMusic'

const useStyles = makeStyles((theme) => ({
  root: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
    paddingBottom: (props) => (props.addPadding ? '80px' : '20px'),
  },
  open: {
    width: 240,
  },
  closed: {
    width: 55,
  },
  active: {
    color: theme.palette.text.primary,
    fontWeight: 'bold',
  },
  collectionChildren: {
    // Indent named collections while the menu is expanded.
    '& a': { paddingLeft: `${theme.spacing(4)}px !important` },
  },
  collectionChildrenCollapsed: {
    // Keep one centered icon per row, like Navidrome's built-in collapsed menu.
    '& a': { paddingLeft: `${theme.spacing(2)}px !important` },
  },
  collectionLetter: {
    width: theme.spacing(3),
    height: theme.spacing(3),
    fontSize: '0.85rem',
    fontWeight: 600,
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.action.selected,
    border: `1px solid ${theme.palette.divider}`,
  },
}))

const translatedResourceName = (resource, translate) =>
  translate(`resources.${resource.name}.name`, {
    smart_count: 2,
    _:
      resource.options && resource.options.label
        ? translate(resource.options.label, {
            smart_count: 2,
            _: resource.options.label,
          })
        : humanize(pluralize(resource.name)),
  })

const Menu = ({ dense = false }) => {
  const open = useSelector((state) => state.admin.ui.sidebarOpen)
  const translate = useTranslate()
  const queue = useSelector((state) => state.player?.queue)
  const classes = useStyles({ addPadding: queue.length > 0 })
  const resources = useSelector(getResources)
  const [collections, setCollections] = useState([])
  useEffect(() => {
    let live = true
    const reload = () => readState().then((r) => { if (live) setCollections(r.collections || []) }).catch(() => {})
    reload()
    window.addEventListener('navidrome-collections-changed', reload)
    window.addEventListener('focus', reload)
    return () => { live = false; window.removeEventListener('navidrome-collections-changed', reload); window.removeEventListener('focus', reload) }
  }, [])

  // TODO State is not persisted in mobile when you close the sidebar menu. Move to redux?
  const [state, setState] = useState({
    menuAlbumList: true,
    menuPlaylists: true,
    menuSharedPlaylists: true,
    menuCollections: true,
  })

  const handleToggle = (menu) => {
    setState((state) => ({ ...state, [menu]: !state[menu] }))
  }

  const renderResourceMenuItemLink = (resource) => (
    <MenuItemLink
      key={resource.name}
      to={`/${resource.name}`}
      activeClassName={classes.active}
      primaryText={translatedResourceName(resource, translate)}
      leftIcon={resource.icon || <ViewListIcon />}
      sidebarIsOpen={open}
      dense={dense}
    />
  )

  const renderAlbumMenuItemLink = (type, al) => {
    const resource = resources.find((r) => r.name === 'album')
    if (!resource) {
      return null
    }

    const albumListAddress = `/album/${type}`

    const name = translate(`resources.album.lists.${type || 'default'}`, {
      _: translatedResourceName(resource, translate),
    })

    return (
      <MenuItemLink
        key={albumListAddress}
        to={albumListAddress}
        activeClassName={classes.active}
        primaryText={name}
        leftIcon={al.icon || <ViewListIcon />}
        sidebarIsOpen={open}
        dense={dense}
        exact
      />
    )
  }

  const collectionInitial = (name) => Array.from((name || '').trim())[0] || '?'

  const collectionItem = (collection) => {
    const label = `${collection.name} (${(collection.albums || []).length})`
    const link = (
      <MenuItemLink
        key={collection.id}
        to={`/collections?selected=${encodeURIComponent(collection.id)}`}
        primaryText={label}
        leftIcon={
          <Avatar className={classes.collectionLetter} aria-hidden="true">
            {collectionInitial(collection.name)}
          </Avatar>
        }
        activeClassName={classes.active}
        sidebarIsOpen={open}
        dense={dense}
      />
    )
    return open ? link : (
      <Tooltip key={collection.id} title={label} placement="right" arrow>
        <div>{link}</div>
      </Tooltip>
    )
  }

  const subItems = (subMenu) => (resource) =>
    resource.hasList && resource.options && resource.options.subMenu === subMenu

  return (
    <div
      className={clsx(classes.root, {
        [classes.open]: open,
        [classes.closed]: !open,
      })}
    >
      {open && <LibrarySelector />}
      <SubMenu
        handleToggle={() => handleToggle('menuCollections')}
        isOpen={state.menuCollections}
        sidebarIsOpen={open}
        name="Collections"
        icon={<FolderSpecialIcon />}
        showIconWhenCollapsed
        dense={dense}
      >
        <div className={open ? classes.collectionChildren : classes.collectionChildrenCollapsed}>
          <MenuItemLink
            to="/collections"
            primaryText="Browse Collections"
            leftIcon={<ViewModuleIcon />}
            activeClassName={classes.active}
            sidebarIsOpen={open}
            dense={dense}
          />
          {collections.map(collectionItem)}
        </div>
      </SubMenu>
      <MenuItemLink to="/catalogue" primaryText="Catalogue"
        leftIcon={<LibraryMusicIcon />} sidebarIsOpen={open} dense={dense} />
      <MenuItemLink to="/m3u-sync" primaryText="M3U Playlist Sync"
        leftIcon={<SyncIcon />} sidebarIsOpen={open} dense={dense} />
      <MenuItemLink to="/recent-albums" primaryText="Recently Played Albums"
        leftIcon={<AlbumIcon />} sidebarIsOpen={open} dense={dense} />
      <MenuItemLink to="/recent-playlists" primaryText="Recently Played Playlists"
        leftIcon={<CollectionsBookmarkIcon />} sidebarIsOpen={open} dense={dense} />
      <MenuItemLink to="/recent-song-editing" primaryText="Recently Played Song Editing"
        leftIcon={<MusicNoteIcon />} sidebarIsOpen={open} dense={dense} />
      <SubMenu
        handleToggle={() => handleToggle('menuAlbumList')}
        isOpen={state.menuAlbumList}
        sidebarIsOpen={open}
        name="menu.albumList"
        icon={<AlbumIcon />}
        dense={dense}
      >
        {Object.keys(albumLists).map((type) =>
          renderAlbumMenuItemLink(type, albumLists[type]),
        )}
      </SubMenu>
      {resources.filter(subItems(undefined)).map(renderResourceMenuItemLink)}
      {config.devSidebarPlaylists && open ? (
        <>
          <Divider />
          <PlaylistsSubMenu
            state={state}
            setState={setState}
            sidebarIsOpen={open}
            dense={dense}
          />
        </>
      ) : (
        resources.filter(subItems('playlist')).map(renderResourceMenuItemLink)
      )}
    </div>
  )
}

export default Menu

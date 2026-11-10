import React from 'react'
import { Route } from 'react-router-dom'
import Personal from './personal/Personal'
import Collections from './experimental/Collections'
import Catalogue from './experimental/Catalogue'
import M3USync from './experimental/M3USync'
import RecentlyPlayed from './experimental/RecentlyPlayed'
import RecentSongEditing from './experimental/RecentSongEditing'

const routes = [
  <Route exact path="/recent-albums" render={() => <RecentlyPlayed type="album" />} key="recent-albums" />,
  <Route exact path="/recent-playlists" render={() => <RecentlyPlayed type="playlist" />} key="recent-playlists" />,
  <Route exact path="/recent-song-editing" component={RecentSongEditing} key="recent-song-editing" />,
  <Route exact path="/m3u-sync" render={() => <M3USync />} key="m3u-sync" />,
  <Route exact path="/catalogue" component={Catalogue} key="catalogue" />,
  <Route exact path="/collections" render={() => <Collections />} key="collections" />,
  <Route exact path="/personal" render={() => <Personal />} key={'personal'} />,
]

export default routes

'use strict'
const EventEmitter = require('events')
const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const AppAPI = require('./api-db.js')
// Create a server and provide it a callback to be executed for every HTTP request
// coming into localhost:3000.
var app = express()
var server = require('http').Server(app)
var io = require('socket.io')(server)
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cookieParser())

// Event emitter for database changes
var dbEmitter = new EventEmitter()

server.listen(3000)

var fileServeOptions = {
  root: __dirname
}

function sendHTML (request, response) {
  console.log('tab path received, sending html')
  response.status(200)
  response.set({
    'content-type': 'text/html',
    'cache-control': 'public, max-age=1800'
  })
  response.sendFile('playlist.html', fileServeOptions)
}

app.get('/', (request, response) => {
  console.log('no path received, redirecting')
  response.redirect(301, '/playlists')
})
app.get('/login', sendHTML)
app.get(/^\/(playlists|library|search)$/, (request, response) => {
  AppAPI.checkSession(request.cookies.sessionKey).then(_ => {
    sendHTML(request, response)
  }, _ => {
    console.log('session ' + request.cookies.sessionKey + ' not found, redirecting')
    response.redirect(303, '/login')
  })
})

app.get('/playlist.css', (request, response) => {
  console.log('css path received, sending css')
  response.status(200)
  response.set({
    'content-type': 'text/css',
    'cache-control': 'public, max-age=1800'
  })
  response.sendFile('playlist.css', fileServeOptions)
})

app.get('/music-app.js', (request, response) => {
  console.log('script path received, sending css')
  response.status(200)
  response.set({
    'content-type': 'application/javascript',
    'cache-control': 'public, max-age=1800'
  })
  response.sendFile('music-app.js', fileServeOptions)
})

app.get('/api/songs', (request, response) => {
  console.log('GET songs received, sending songs')
  AppAPI.getAllSongs().then(data => {
    response.status(200)
    response.json(data)
  }).catch(err => {
    response.status(500)
    response.json(err)
  })
})

app.get('/api/playlists', (request, response) => {
  console.log('GET playlists received, sending playlists')
  AppAPI.sessionGetAllPlaylists(request.cookies.sessionKey).then(data => {
    response.status(200)
    response.json(data)
  }).catch(err => {
    response.status(500)
    response.json(err)
  })
})

app.get('/api/users/', (request, response) => {
  console.log('GET users received, sending users')
  AppAPI.getAllUsers().then(data => {
    response.status(200)
    response.json(data)
  }).catch(err => {
    response.status(500)
    response.json(err)
  })
})

app.post('/login', (request, response) => {
  AppAPI.createSession(request.body['username'], request.body['password']).then(result => {
    response.status(200)
    response.cookie('sessionKey', result['sessionKey'])
    return {'status': 'ok'}
  }, result => {
    response.status(401)
    return {
      'status': 'error',
      'reason': 'failed to authenticate'
    }
  }).then(result => {
    console.log('request: ' + JSON.stringify(request.body))
    console.log('response: ' + JSON.stringify(result))
    response.json(result)
  })
})
app.post('/api/playlists', (request, response) => {
  AppAPI.sessionCreatePlaylist(request.cookies.sessionKey, request.body['name']).then(result => {
    response.status(200)
    return result
  }, result => {
    response.status(500)
    return result
  }).then(result => {
    console.log('request: ' + JSON.stringify(request.body))
    console.log('response: ' + JSON.stringify(result))
    response.json(result)
  })
})

app.post('/api/playlists/:playlistID', (request, response) => {
  var songID = request.body['song']
  var playlistID = request.params.playlistID
  AppAPI.sessionAddSongToPlaylist(request.cookies.sessionKey, songID, playlistID).then(result => {
    dbEmitter.emit('addSongToPlaylist', songID, playlistID)
    response.status(200)
    return {}
  }, result => {
    response.status(500)
    return result
  }).then(result => {
    console.log('request: ' + JSON.stringify(request.body))
    console.log('response: ' + JSON.stringify(result))
    response.json(result)
  })
})
app.post('/api/playlists/:playlistID/users', (request, response) => {
  AppAPI.sessionAddUserToPlaylist(request.cookies.sessionKey, request.body['user'], request.params.playlistID).then(result => {
    response.status(200)
    return {}
  }, result => {
    response.status(500)
    return result
  }).then(result => {
    console.log('request: ' + JSON.stringify(request.body))
    console.log('response: ' + JSON.stringify(result))
    response.json(result)
  })
})
app.delete('/api/playlists/:playlistID', (request, response) => {
  var songID = request.body['song']
  var playlistID = request.params.playlistID
  AppAPI.sessionRemoveSongFromPlaylist(request.cookies.sessionKey, songID, playlistID).then(result => {
    dbEmitter.emit('deleteSongToPlaylist', songID, playlistID)
    response.status(200)
    return result
  }, result => {
    response.status(500)
    return result
  }).then(result => {
    console.log('request: ' + JSON.stringify(request.body))
    console.log('response: ' + JSON.stringify(result))
    response.json(result)
  })
})

app.get('*', (request, response) => {
  console.log('request not understood: ' + request.url)
  response.sendStatus(404)
})

function parseCookie (str, name) {
  str = '; ' + str
  var tmp = str.split('; ' + name + '=')
  if (tmp.length === 2) {
    return tmp[1].split(';')[0]
  }
}

io.use((socket, next) => {
  // parse only the cookies I care about
  var header = socket.request.headers
  var cookie = {}
  cookie.sessionKey = parseCookie(header.cookie, 'sessionKey')
  header.cookie = cookie
  next()
})
io.on('connection', socket => {
  console.log('[connect] ' + socket.request.headers.cookie.sessionKey)

  var interestedPlaylists = {}

  socket.on('getPlaylistContent', data => {
    console.log('[request][getPlaylistContent] ' + socket.request.headers.cookie.sessionKey)
    var playlistID = data['playlistID']
    // do nothing if this connection has already received playlist content
    if (interestedPlaylists[playlistID]) {
      return
    }
    AppAPI.sessionGetSongIDsFromPlaylist(socket.request.headers.cookie.sessionKey, playlistID).then(songIDs => {
      // remember that this connection has received playlist content already
      interestedPlaylists[playlistID] = true

      songIDs.forEach(songID => {
        socket.emit('addPlaylistContent', {
          'playlistID': playlistID,
          'songID': songID
        })
      })
    }, error => {
      console.log('[error] ' + JSON.stringify(error))
    })
  })

  dbEmitter.on('addSongToPlaylist', (songID, playlistID) => {
    // don't send update messages if the connection never asked for this playlist
    if (!interestedPlaylists[playlistID]) {
      return
    }
    var message = {
      'playlistID': playlistID,
      'songID': songID
    }
    console.log('sending update message: ' + JSON.stringify(message))
    socket.emit('addPlaylistContent', message)
  })
  dbEmitter.on('deleteSongToPlaylist', (songID, playlistID) => {
    // don't send update messages if the connection never asked for this playlist
    if (!interestedPlaylists[playlistID]) {
      return
    }
    var message = {
      'playlistID': playlistID,
      'songID': songID
    }
    console.log('sending delete message')
    socket.emit('deletePlaylistContent', message)
  })
})

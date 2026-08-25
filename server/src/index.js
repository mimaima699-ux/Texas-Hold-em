// Server entry point: Express (static assets + room list API) + Socket.IO
// (realtime game communication).

import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { CONFIG } from './config.js'
import { createRoom, getRoom, rooms } from './room.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// Room list (shown on the join screen)
app.get('/api/rooms', (_req, res) => {
  res.json(
    [...rooms.values()].map((r) => ({
      id: r.id,
      phase: r.phase,
      players: r.seats.filter(Boolean).length,
      online: r.sockets.size,
      max: CONFIG.MAX_PLAYERS,
    }))
  )
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// If the client has been built (npm run build), serve it directly
const dist = path.resolve(__dirname, '../../client/dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
}

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' },
})

io.on('connection', (socket) => {
  let room = null
  // Player id bound to this connection (from the sockets table after joining)
  const me = () => (room ? room.sockets.get(socket.id) ?? null : null)
  const needRoom = (cb) => {
    if (!room) {
      cb({ ok: false, error: 'Join a room first' })
      return null
    }
    return room
  }

  socket.on('room:create', ({ name } = {}, cb = () => {}) => {
    room?.removeSocket(socket.id)
    room = createRoom()
    room.attach(io)
    cb({ ...room.join({ name, socketId: socket.id }), roomId: room.id })
  })

  socket.on('room:join', ({ roomId, name, playerId } = {}, cb = () => {}) => {
    const target = getRoom(roomId)
    if (!target) return cb({ ok: false, error: 'Room not found' })
    room?.removeSocket(socket.id)
    room = target
    room.attach(io)
    cb({ ...room.join({ name, playerId, socketId: socket.id }), roomId: target.id })
  })

  socket.on('room:addBot', (_data, cb = () => {}) => {
    const r = needRoom(cb)
    if (r) cb(r.addBot(me()))
  })

  socket.on('game:start', (_data, cb = () => {}) => {
    const r = needRoom(cb)
    if (r) cb(r.start(me()))
  })

  socket.on('game:action', (action, cb = () => {}) => {
    const r = needRoom(cb)
    if (r) cb(r.applyAction(me(), action))
  })

  socket.on('game:rebuy', (_data, cb = () => {}) => {
    const r = needRoom(cb)
    if (r) cb(r.rebuy(me()))
  })

  socket.on('disconnect', () => {
    room?.removeSocket(socket.id)
    room = null
  })
})

server.listen(CONFIG.PORT, () => {
  console.log(`Texas Hold'em server running at http://localhost:${CONFIG.PORT}`)
})

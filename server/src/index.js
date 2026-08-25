// 服务器入口：Express（静态资源 + 房间列表接口）+ Socket.IO（对局实时通信）。

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

// 房间列表（供加入页展示）
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

// 若前端已构建（npm run build），直接托管
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
  // 当前连接绑定的玩家 id（加入房间后由 sockets 表给出）
  const me = () => (room ? room.sockets.get(socket.id) ?? null : null)
  const needRoom = (cb) => {
    if (!room) {
      cb({ ok: false, error: '请先加入房间' })
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
    if (!target) return cb({ ok: false, error: '房间不存在' })
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
  console.log(`德州扑克服务器已启动: http://localhost:${CONFIG.PORT}`)
})

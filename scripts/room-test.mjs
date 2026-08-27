// Room lifecycle + chat e2e test. Needs a test server with a short expiry:
//   ROOM_LOBBY_EXPIRE_MS=5000 PORT=3002 node server/src/index.js
// then: node scripts/room-test.mjs

import { io } from 'socket.io-client'

const URL = process.env.TEST_URL || 'http://127.0.0.1:3002'
const fail = (m) => {
  console.error('❌', m)
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const emitAck = (s, ev, data) => new Promise((res) => s.emit(ev, data, res))

// ---- Case 1: chat works, never-started room closes on expiry ----
const s1 = io(URL, { transports: ['websocket'] })
await new Promise((res) => s1.on('connect', res))
let closed = null
let chatSeen = null
s1.on('room:closed', (d) => (closed = d))
s1.on('state', (st) => {
  if (st.chat?.length) chatSeen = st.chat
})

const created = await emitAck(s1, 'room:create', { name: 'T1' })
if (!created?.ok) fail(`create failed: ${created?.error}`)

const sent = await emitAck(s1, 'chat:send', { text: 'hello 👋' })
if (!sent?.ok) fail(`chat rejected: ${sent?.error}`)
await sleep(400)
const last = chatSeen?.at(-1)
if (!last || !last.text.includes('hello')) fail('chat message not broadcast in state')
console.log(`✓ chat works: ${last.name}: ${last.text}`)

console.log('waiting for room expiry (5s)...')
await sleep(7000)
if (!closed) fail('never-started room did NOT close after expiry')
console.log(`✓ room closed on expiry: ${closed.reason}`)
s1.disconnect()

// ---- Case 2: a started room survives past the expiry deadline ----
const s2 = io(URL, { transports: ['websocket'] })
await new Promise((res) => s2.on('connect', res))
let closed2 = false
s2.on('room:closed', () => (closed2 = true))

const c2 = await emitAck(s2, 'room:create', { name: 'T2' })
if (!c2?.ok) fail(`create 2 failed`)
await emitAck(s2, 'room:addBot', {})
const started = await emitAck(s2, 'game:start', {})
if (!started?.ok) fail(`start failed: ${started?.error}`)

await sleep(7000)
if (closed2) fail('started room was closed incorrectly')
console.log('✓ started room survives the expiry deadline')
console.log('✅ all room lifecycle tests passed')
s2.disconnect()
process.exit(0)

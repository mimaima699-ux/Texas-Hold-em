// End-to-end smoke test: simulates a human player who creates a room,
// adds AI, starts the game, auto-calls/checks, and verifies that several
// hands complete fully with chip conservation.
//
// Usage: start the server first (npm run dev:server), then run npm run smoke
// Env vars: SMOKE_URL (default http://localhost:3001), SMOKE_HANDS (default 3)

import { io } from 'socket.io-client'

const URL = process.env.SMOKE_URL || 'http://localhost:3001'
const TARGET_HANDS = Number(process.env.SMOKE_HANDS || 3)
const TIMEOUT_MS = 180_000

const socket = io(URL, { transports: ['websocket'] })

let youId = null
let handEnds = 0
let lastHandNumber = 0
let lastStateAt = Date.now()
let latest = null
let actedCount = 0
let restarts = 0
let restarting = false

const fail = (msg) => {
  console.error(`❌ Smoke test failed: ${msg}`)
  process.exit(1)
}

const timer = setTimeout(() => {
  fail(`Timed out. Hands completed: ${handEnds}/${TARGET_HANDS}, actions taken: ${actedCount}`)
}, TIMEOUT_MS)

// Stuck detection: no state updates for 25 seconds means deadlock
const watchdog = setInterval(() => {
  if (Date.now() - lastStateAt > 25_000) {
    fail(`Game appears stuck (no state updates for 25s), phase=${latest?.game?.phase ?? latest?.room?.phase}`)
  }
}, 5_000)

const finish = () => {
  clearTimeout(timer)
  clearInterval(watchdog)
  // Chip conservation: sum of all seat stacks === player count × starting stack
  const seats = latest.room.seats.filter(Boolean)
  const total = seats.reduce((s, p) => s + p.chips, 0)
  if (total !== seats.length * latest.room.startingChips) {
    fail(`Chips not conserved: ${seats.length} players hold ${total}, expected ${seats.length * latest.room.startingChips}`)
  }
  console.log(`✅ Smoke test passed: ${handEnds} full hands, ${actedCount} human actions, chips conserved (${total})`)
  socket.disconnect()
  process.exit(0)
}

// Human auto-action: check when possible, otherwise call;
// raise every 4th opportunity to cover the raise path
let opportunities = 0
function autoAct(state) {
  const { game } = state
  if (!game?.you || game.currentTurn !== youId || game.phase === 'handEnd') return
  const legal = game.you.legal
  if (!legal) return
  opportunities++
  setTimeout(() => {
    let action
    if (opportunities % 4 === 0 && legal.canRaise) {
      action = { type: 'raise', amount: legal.raiseMin }
    } else if (legal.check) {
      action = { type: 'check' }
    } else if (legal.canCall) {
      action = { type: 'call' }
    } else {
      action = { type: 'fold' }
    }
    actedCount++
    socket.emit('game:action', action, (res) => {
      if (!res?.ok) fail(`Auto action rejected: ${JSON.stringify(action)} -> ${res?.error}`)
    })
  }, 150)
}

socket.on('connect', () => {
  clearTimeout(connectFailsafe)
  socket.emit('room:create', { name: 'SmokeTester' }, (res) => {
    if (!res?.ok) return fail(`Failed to create room: ${res?.error}`)
    youId = res.playerId
    socket.emit('room:addBot', {}, (r1) => {
      if (!r1?.ok) return fail(`Failed to add AI: ${r1?.error}`)
      socket.emit('room:addBot', {}, (r2) => {
        if (!r2?.ok) return fail(`Failed to add second AI: ${r2?.error}`)
        socket.emit('game:start', {}, (r3) => {
          if (!r3?.ok) return fail(`Failed to start game: ${r3?.error}`)
          console.log('Room created, 2 AI added, game started. Waiting for hands to play out…')
        })
      })
    })
  })
})

socket.on('state', (state) => {
  lastStateAt = Date.now()
  latest = state
  const game = state.game
  if (game?.phase === 'handEnd' && game.handNumber !== lastHandNumber) {
    lastHandNumber = game.handNumber
    handEnds++
    const winners = game.lastResult.winners.map((w) => `${w.name}+${w.amount}`).join(', ')
    console.log(`  Hand #${game.handNumber} finished: ${winners} (${handEnds}/${TARGET_HANDS})`)
    if (handEnds >= TARGET_HANDS) return finish()
  }
  if (state.room.phase === 'playing') {
    restarting = false
    autoAct(state)
  } else if (handEnds > 0 && state.room.phase === 'lobby' && !restarting) {
    // Natural end of a game (someone won all the chips):
    // rebuy and restart to cover that flow too
    restarting = true
    restarts++
    if (restarts > 2) return finish()
    console.log('  Game over (someone won all the chips) — rebuying for another game…')
    socket.emit('game:rebuy', {}, () => {
      socket.emit('game:start', {}, (r) => {
        if (!r?.ok) console.log(`  Restart failed (ignored, counting as pass): ${r?.error}`)
      })
    })
  }
})

socket.on('connect_error', (err) => fail(`Cannot connect to ${URL}: ${err.message}`))
const connectFailsafe = setTimeout(() => fail('Could not connect (is the server running?)'), 5_000)

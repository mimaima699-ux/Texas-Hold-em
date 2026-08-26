// Room layer: manages seats and the overall game loop.
// The engine only handles rules for a single hand; cross-hand concerns —
// chip stacks, dealer rotation, players joining/leaving, action timers
// (human timeouts / AI delays), result display and the next hand — live here.

import { randomUUID } from 'node:crypto'
import { PokerGame } from './game/gameEngine.js'
import { decide } from './ai/aiPlayer.js'
import { cardLabel } from './game/deck.js'
import { CONFIG } from './config.js'

// AI name pool (wolf-game themed)
const BOT_NAMES = ['Big Bad Wolf', 'Little Red', 'Old Hunter', 'Bunny', 'Seer', 'Witch', 'Guard', 'Night Owl', 'Villager']
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const rooms = new Map()

function newRoomCode() {
  while (true) {
    let code = ''
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    if (!rooms.has(code)) return code
  }
}

export function createRoom(options) {
  const room = new Room(options)
  rooms.set(room.id, room)
  return room
}

export function getRoom(id) {
  return rooms.get(String(id || '').toUpperCase()) ?? null
}

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))

// Coerce a value into an integer within [lo, hi], falling back when invalid
const clampInt = (v, fallback, lo, hi) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

export class Room {
  constructor(options = {}) {
    this.id = newRoomCode()
    this.seats = Array(CONFIG.MAX_PLAYERS).fill(null) // seat number -> player | null
    this.hostId = null
    this.phase = 'lobby' // lobby | playing
    this.engine = null // engine instance for the current hand (one per hand)
    this.io = null
    this.sockets = new Map() // socketId -> playerId
    this.log = []
    this.dealerSeat = null // previous hand's dealer seat (for rotation)
    this.handCount = 0
    this.turnTimer = null
    this.handTimer = null
    this.turnEndsAt = null
    this.turnDurationMs = null
    this.revealed = new Set() // playerIds who chose to show their hand this hand
    // Host-configured room settings, clamped to sane ranges
    this.startingChips = clampInt(options.startingChips, CONFIG.DEFAULT_STARTING_CHIPS, 100, 1_000_000)
    this.smallBlind = clampInt(options.smallBlind, CONFIG.DEFAULT_SMALL_BLIND, 1, 100_000)
    this.bigBlind = clampInt(options.bigBlind, CONFIG.DEFAULT_BIG_BLIND, 1, 200_000)
    if (this.bigBlind <= this.smallBlind) this.bigBlind = this.smallBlind * 2
  }

  attach(io) {
    this.io = io
  }

  // ==== Helpers ====

  seatedPlayers() {
    return this.seats.filter(Boolean) // in seat order
  }

  playerById(id) {
    return this.seatedPlayers().find((p) => p.id === id) ?? null
  }

  // Only players with chips who are present (humans must be online)
  // are eligible for the next hand
  eligiblePlayers() {
    return this.seatedPlayers().filter((p) => p.chips > 0 && (p.isBot || p.socketId != null))
  }

  addLog(text) {
    this.log.push({ text, t: Date.now() })
    if (this.log.length > 100) this.log.splice(0, this.log.length - 100)
  }

  broadcast() {
    if (!this.io) return
    for (const [socketId, playerId] of this.sockets) {
      this.io.to(socketId).emit('state', this.stateFor(playerId))
    }
  }

  stateFor(playerId) {
    let game = null
    if (this.engine && this.phase === 'playing') {
      game = this.engine.serializeFor(playerId)
      const epById = new Map(this.engine.players.map((p) => [p.id, p]))
      const seatById = new Map(this.seats.filter(Boolean).map((p) => [p.id, p]))
      const isHandEnd = this.engine.phase === 'handEnd'

      for (const gp of game.players) {
        gp.wins = seatById.get(gp.id)?.wins ?? 0
        // Reveal: only show hole cards + hand name for players who opted in
        if (isHandEnd && this.revealed.has(gp.id) && !gp.folded) {
          const ep = epById.get(gp.id)
          if (ep) {
            gp.hole = ep.hole
            gp.handName = ep.eval?.name ?? null
          }
        }
        gp.revealed = this.revealed.has(gp.id)
      }

      game.revealWindow = isHandEnd
      if (game.you) {
        game.you.wins = seatById.get(game.you.id)?.wins ?? 0
        game.you.canReveal = isHandEnd && !game.you.folded && !this.revealed.has(playerId)
        game.you.revealed = this.revealed.has(playerId)
      }
    }

    return {
      room: {
        id: this.id,
        phase: this.phase,
        hostId: this.hostId,
        youId: playerId,
        startingChips: this.startingChips,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        maxPlayers: this.seats.length,
        seats: this.seats.map((p, seat) =>
          p && {
            seat,
            id: p.id,
            name: p.name,
            isBot: p.isBot,
            chips: p.chips,
            wins: p.wins || 0,
            connected: p.socketId != null,
            isHost: p.id === this.hostId,
          }
        ),
        turnEndsAt: this.turnEndsAt,
        turnDurationMs: this.turnDurationMs,
        serverTime: Date.now(),
      },
      game,
      log: this.log,
    }
  }

  // ==== Player management ====

  join({ name, playerId, socketId }) {
    // Reconnect: player still seated
    const existing = playerId ? this.playerById(playerId) : null
    if (existing) {
      existing.socketId = socketId
      if (name) existing.name = String(name).slice(0, 12) || existing.name
      this.sockets.set(socketId, existing.id)
      this.addLog(`${existing.name} reconnected`)
      this.broadcast()
      return { ok: true, playerId: existing.id }
    }
    const seat = this.seats.findIndex((s) => s === null)
    if (seat === -1) return { ok: false, error: 'Room is full' }
    const player = {
      id: playerId || randomUUID(),
      seat,
      name: String(name || 'Player').slice(0, 12),
      isBot: false,
      chips: this.startingChips,
      socketId,
      wins: 0,
    }
    this.seats[seat] = player
    this.sockets.set(socketId, player.id)
    if (!this.hostId) this.hostId = player.id
    this.addLog(`${player.name} joined the room`)
    this.broadcast()
    return { ok: true, playerId: player.id }
  }

  removeSocket(socketId) {
    const playerId = this.sockets.get(socketId)
    this.sockets.delete(socketId)
    const p = playerId != null ? this.playerById(playerId) : null
    if (p && p.socketId === socketId) {
      p.socketId = null
      this.addLog(`${p.name} left`)
      if (p.id === this.hostId) this.transferHost()
      // Shorten the timeout if it's the disconnected player's turn,
      // so the table doesn't sit waiting
      if (this.phase === 'playing' && this.engine?.currentActor?.id === p.id) {
        this.scheduleTurn(CONFIG.OFFLINE_ACTION_TIMEOUT_MS)
      }
    }
    if (this.sockets.size === 0) {
      this.destroy()
      return true
    }
    this.broadcast()
    return false
  }

  transferHost() {
    const next = this.seatedPlayers().find((p) => p.socketId != null) ?? this.seatedPlayers()[0]
    this.hostId = next ? next.id : null
    if (next) this.addLog(`${next.name} is now the host`)
  }

  addBot(actorId) {
    if (actorId !== this.hostId) return { ok: false, error: 'Only the host can add AI players' }
    const seat = this.seats.findIndex((s) => s === null)
    if (seat === -1) return { ok: false, error: 'Room is full' }
    const used = new Set(this.seatedPlayers().map((p) => p.name))
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI ${seat}`
    this.seats[seat] = {
      id: `bot-${randomUUID().slice(0, 8)}`,
      seat,
      name,
      isBot: true,
      chips: this.startingChips,
      socketId: null,
      wins: 0,
    }
    this.addLog(`AI "${name}" joined the room`)
    this.broadcast()
    return { ok: true }
  }

  rebuy(playerId) {
    const p = this.playerById(playerId)
    if (!p) return { ok: false, error: 'You are not seated' }
    if (p.isBot) return { ok: false, error: 'Bots cannot rebuy' }
    if (p.chips > 0) return { ok: false, error: 'You still have chips, no rebuy needed' }
    // Block rebuy while still in the current hand unfolded (may be all-in);
    // wait until the hand ends
    const inHand = this.phase === 'playing' && this.engine?.playerById(playerId)
    if (inHand && !inHand.folded) return { ok: false, error: 'Rebuy is available after this hand ends' }
    p.chips = this.startingChips
    this.addLog(`${p.name} rebought ${this.startingChips} chips`)
    this.broadcast()
    return { ok: true }
  }

  // Opt-in reveal: a contestant chooses to show their cards after the hand ends
  reveal(playerId) {
    if (this.phase !== 'playing' || !this.engine || this.engine.phase !== 'handEnd') {
      return { ok: false, error: 'Reveal is only available right after a hand ends' }
    }
    const p = this.engine.playerById(playerId)
    if (!p || p.folded) return { ok: false, error: 'You cannot reveal a folded hand' }
    this.revealed.add(playerId)
    this.addLog(`${p.name} shows their hand`)
    this.broadcast()
    return { ok: true }
  }

  destroy() {
    this.clearTimers()
    this.phase = 'lobby'
    rooms.delete(this.id)
  }

  // ==== Game loop ====

  start(actorId) {
    if (actorId !== this.hostId) return { ok: false, error: 'Only the host can start the game' }
    if (this.phase === 'playing') return { ok: false, error: 'Game already in progress' }
    // Starting a new game: reset every seat's chips to the starting stack
    // (the previous game's champion is already recorded in the log)
    for (const p of this.seatedPlayers()) p.chips = this.startingChips
    this.dealerSeat = null
    const present = this.seatedPlayers().filter((p) => p.isBot || p.socketId != null)
    if (present.length < CONFIG.MIN_PLAYERS) {
      return { ok: false, error: `At least ${CONFIG.MIN_PLAYERS} online players are needed (add AI to fill seats)` }
    }
    this.phase = 'playing'
    this.addLog('Game started!')
    this.startHand()
    return { ok: true }
  }

  startHand() {
    this.clearTimers()
    this.revealed = new Set()
    const eligible = this.eligiblePlayers()
    if (this.phase !== 'playing' || eligible.length < CONFIG.MIN_PLAYERS) {
      this.endGame(eligible)
      return
    }

    // Dealer rotates by seat order
    const seats = eligible.map((p) => p.seat)
    if (this.dealerSeat == null || !seats.includes(this.dealerSeat)) {
      this.dealerSeat = seats[0]
    } else {
      this.dealerSeat = seats[(seats.indexOf(this.dealerSeat) + 1) % seats.length]
    }
    this.handCount++

    this.engine = new PokerGame({
      players: eligible.map((p) => ({ ...p })),
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      initialDealerIndex: eligible.findIndex((p) => p.seat === this.dealerSeat),
      onResult: (result) => this.onHandEnd(result),
    })
    this.engine.handNumber = this.handCount - 1 // startHand increments it; align with room count

    this.addLog(`—— Hand ${this.handCount} ——`)
    this.engine.startHand()
    this.scheduleTurn()
    this.broadcast()
  }

  endGame(eligible = this.eligiblePlayers()) {
    this.clearTimers()
    this.engine = null
    this.phase = 'lobby'
    const champ = eligible[0]
    if (champ) this.addLog(`🏆 ${champ.name} wins the whole game!`)
    this.broadcast()
  }

  onHandEnd() {
    this.clearTurnTimer()
    // Engine players are copies of the seated players; write settled chips back
    for (const ep of this.engine.players) {
      const seatP = this.seats[ep.seat]
      if (seatP && seatP.id === ep.id) seatP.chips = ep.chips
    }
    const result = this.engine.lastResult
    // Persist a win for each winner on their seat (shown as a hand counter)
    for (const w of result.winners) {
      const seatP = this.seats.find((s) => s && s.id === w.id)
      if (seatP) seatP.wins = (seatP.wins || 0) + 1
    }
    if (result.uncontested) {
      const w = result.winners[0]
      this.addLog(`Everyone else folded — ${w.name} wins ${w.amount}`)
    } else {
      for (const w of result.winners) {
        const reveal = result.reveal.find((r) => r.id === w.id)
        this.addLog(`${w.name}${reveal ? ` (${reveal.handName})` : ''} wins ${w.amount}`)
      }
    }
    this.broadcast()
    // Show the result for a while, then start the next hand
    this.handTimer = setTimeout(() => {
      this.handTimer = null
      this.startHand()
    }, CONFIG.HAND_END_PAUSE_MS)
  }

  // ==== Actions ====

  applyAction(playerId, action) {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No game in progress' }
    if (!action || typeof action.type !== 'string') return { ok: false, error: 'Invalid action' }
    return this.step(playerId, action)
  }

  // Execute one action and handle progression, logging and broadcasting;
  // returns an error if the decision is illegal
  step(playerId, action) {
    const prevCommunity = this.engine.community.length
    const res = this.engine.act(playerId, action)
    if (!res.ok) return res
    this.logAction(playerId, action)
    if (this.engine.community.length > prevCommunity && this.engine.phase !== 'handEnd') {
      this.addLog(`Board: ${this.engine.community.map(cardLabel).join(' ')}`)
    }
    this.scheduleTurn()
    this.broadcast()
    return { ok: true }
  }

  logAction(playerId, action) {
    const p = this.engine.playerById(playerId)
    if (!p) return
    if (action.type === 'fold') this.addLog(`${p.name} folds`)
    else if (action.type === 'check') this.addLog(`${p.name} checks`)
    else if (action.type === 'call') this.addLog(`${p.name} ${p.allIn ? 'calls all-in' : 'calls'} ${p.bet}`)
    else if (action.type === 'raise') this.addLog(`${p.name} ${p.allIn ? 'shoves all-in' : 'raises to'} ${p.bet}`)
  }

  // ==== Turn scheduling ====

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer)
      this.turnTimer = null
    }
    this.turnEndsAt = null
    this.turnDurationMs = null
  }

  clearTimers() {
    this.clearTurnTimer()
    if (this.handTimer) {
      clearTimeout(this.handTimer)
      this.handTimer = null
    }
  }

  scheduleTurn(timeoutOverrideMs = null) {
    this.clearTurnTimer()
    if (!this.engine || this.engine.phase === 'handEnd') return
    const actor = this.engine.currentActor
    if (!actor) return

    if (actor.isBot) {
      const delay = randInt(CONFIG.AI_ACT_MIN_MS, CONFIG.AI_ACT_MAX_MS)
      this.turnEndsAt = Date.now() + delay
      this.turnDurationMs = delay
      this.turnTimer = setTimeout(() => this.botAct(actor.id), delay)
    } else {
      // Online status must come from the room's seat player (which carries
      // socketId); the engine player is a stripped copy without that field.
      const seatP = this.playerById(actor.id)
      const online = !!seatP?.socketId
      const timeout =
        timeoutOverrideMs ?? (online ? CONFIG.ACTION_TIMEOUT_MS : CONFIG.OFFLINE_ACTION_TIMEOUT_MS)
      this.turnEndsAt = Date.now() + timeout
      this.turnDurationMs = timeout
      this.turnTimer = setTimeout(() => this.autoAct(actor.id), timeout)
    }
  }

  // Human timeout → AI plays for them:
  // someone ahead raised (can't check) → fold; otherwise (all checked) → check
  autoAct(playerId) {
    this.turnTimer = null
    if (!this.engine || this.engine.currentActor?.id !== playerId) return
    const legal = this.engine.getLegalActions(playerId)
    const p = this.engine.playerById(playerId)
    const facingRaise = !legal.check
    const action = facingRaise ? { type: 'fold' } : { type: 'check' }
    this.addLog(`${p.name} timed out — auto-${facingRaise ? 'folded (facing a raise)' : 'checked'}`)
    this.step(playerId, action)
  }

  botAct(botId) {
    this.turnTimer = null
    if (!this.engine || this.engine.currentActor?.id !== botId) return
    const actor = this.engine.currentActor
    const legal = this.engine.getLegalActions(botId)

    // Position: 0 = first to act after the dealer (early), 1 = dealer button (late)
    const players = this.engine.players
    const n = players.length
    const dist = (players.indexOf(actor) - this.engine.dealerIndex + n) % n
    const position = n <= 1 ? 1 : ((dist - 1 + n) % n) / (n - 1)

    const action = decide({
      hole: actor.hole,
      community: this.engine.community,
      toCall: legal.toCall,
      currentBet: this.engine.streetBet,
      potSize: this.engine.potForDisplay(),
      legal,
      position,
      bigBlind: this.bigBlind,
      rng: Math.random,
    })

    let res = this.step(botId, action)
    if (!res.ok) {
      // Fallback if the decision was illegal
      res = this.step(botId, legal.check ? { type: 'check' } : { type: 'fold' })
    }
    return res
  }
}

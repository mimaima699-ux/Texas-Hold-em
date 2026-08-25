// 房间层：管理座位与整局对局循环。
// 引擎只负责单手牌的规则推进；跨手的筹码、庄家轮转、玩家进出、
// 行动计时器（真人超时 / AI 延迟）、结算展示与下一手衔接都由这里负责。

import { randomUUID } from 'node:crypto'
import { PokerGame } from './game/gameEngine.js'
import { decide } from './ai/aiPlayer.js'
import { cardLabel } from './game/deck.js'
import { CONFIG } from './config.js'

// AI 名字池（狼人杀主题）
const BOT_NAMES = ['大灰狼', '小红帽', '老猎人', '小白兔', '预言家', '女巫', '守卫', '夜猫子', '村民']
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

export class Room {
  constructor(options = {}) {
    this.id = newRoomCode()
    this.seats = Array(CONFIG.MAX_PLAYERS).fill(null) // 座位号 -> 玩家 | null
    this.hostId = null
    this.phase = 'lobby' // lobby | playing
    this.engine = null // 当前手牌的引擎实例（一手一个）
    this.io = null
    this.sockets = new Map() // socketId -> playerId
    this.log = []
    this.dealerSeat = null // 上一手的庄家座位（用于轮转）
    this.handCount = 0
    this.turnTimer = null
    this.handTimer = null
    this.turnEndsAt = null
    this.turnDurationMs = null
    this.startingChips = options.startingChips ?? CONFIG.DEFAULT_STARTING_CHIPS
    this.smallBlind = options.smallBlind ?? CONFIG.DEFAULT_SMALL_BLIND
    this.bigBlind = options.bigBlind ?? CONFIG.DEFAULT_BIG_BLIND
  }

  attach(io) {
    this.io = io
  }

  // ==== 基础工具 ====

  seatedPlayers() {
    return this.seats.filter(Boolean) // 按座位顺序
  }

  playerById(id) {
    return this.seatedPlayers().find((p) => p.id === id) ?? null
  }

  // 有筹码且在场（真人需在线）的玩家才有资格参与下一手
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
            connected: p.socketId != null,
            isHost: p.id === this.hostId,
          }
        ),
        turnEndsAt: this.turnEndsAt,
        turnDurationMs: this.turnDurationMs,
        serverTime: Date.now(),
      },
      game: this.engine && this.phase === 'playing' ? this.engine.serializeFor(playerId) : null,
      log: this.log,
    }
  }

  // ==== 玩家管理 ====

  join({ name, playerId, socketId }) {
    // 重连：玩家仍在座位上
    const existing = playerId ? this.playerById(playerId) : null
    if (existing) {
      existing.socketId = socketId
      if (name) existing.name = String(name).slice(0, 12) || existing.name
      this.sockets.set(socketId, existing.id)
      this.addLog(`${existing.name} 重新连接`)
      this.broadcast()
      return { ok: true, playerId: existing.id }
    }
    const seat = this.seats.findIndex((s) => s === null)
    if (seat === -1) return { ok: false, error: '房间已满' }
    const player = {
      id: playerId || randomUUID(),
      seat,
      name: String(name || '玩家').slice(0, 12),
      isBot: false,
      chips: this.startingChips,
      socketId,
    }
    this.seats[seat] = player
    this.sockets.set(socketId, player.id)
    if (!this.hostId) this.hostId = player.id
    this.addLog(`${player.name} 加入了房间`)
    this.broadcast()
    return { ok: true, playerId: player.id }
  }

  removeSocket(socketId) {
    const playerId = this.sockets.get(socketId)
    this.sockets.delete(socketId)
    const p = playerId != null ? this.playerById(playerId) : null
    if (p && p.socketId === socketId) {
      p.socketId = null
      this.addLog(`${p.name} 离开了`)
      if (p.id === this.hostId) this.transferHost()
      // 轮到掉线玩家行动时缩短超时，避免整桌干等
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
    if (next) this.addLog(`${next.name} 成为房主`)
  }

  addBot(actorId) {
    if (actorId !== this.hostId) return { ok: false, error: '只有房主可以添加 AI' }
    const seat = this.seats.findIndex((s) => s === null)
    if (seat === -1) return { ok: false, error: '房间已满' }
    const used = new Set(this.seatedPlayers().map((p) => p.name))
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI${seat}`
    this.seats[seat] = {
      id: `bot-${randomUUID().slice(0, 8)}`,
      seat,
      name,
      isBot: true,
      chips: this.startingChips,
      socketId: null,
    }
    this.addLog(`AI「${name}」加入了房间`)
    this.broadcast()
    return { ok: true }
  }

  rebuy(playerId) {
    const p = this.playerById(playerId)
    if (!p) return { ok: false, error: '你不在座位上' }
    if (p.isBot) return { ok: false, error: 'AI 不能重新买入' }
    if (p.chips > 0) return { ok: false, error: '还有筹码，无需重新买入' }
    // 还在当前手牌中且未弃牌（可能正全下）时不允许，等本手结束
    const inHand = this.phase === 'playing' && this.engine?.playerById(playerId)
    if (inHand && !inHand.folded) return { ok: false, error: '本手结束后才能重新买入' }
    p.chips = this.startingChips
    this.addLog(`${p.name} 重新买入 ${this.startingChips}`)
    this.broadcast()
    return { ok: true }
  }

  destroy() {
    this.clearTimers()
    this.phase = 'lobby'
    rooms.delete(this.id)
  }

  // ==== 对局循环 ====

  start(actorId) {
    if (actorId !== this.hostId) return { ok: false, error: '只有房主可以开始游戏' }
    if (this.phase === 'playing') return { ok: false, error: '游戏已在进行中' }
    // 新开一局：所有座位筹码重置为初始值（上一局冠军已记录在日志中）
    for (const p of this.seatedPlayers()) p.chips = this.startingChips
    this.dealerSeat = null
    const present = this.seatedPlayers().filter((p) => p.isBot || p.socketId != null)
    if (present.length < CONFIG.MIN_PLAYERS) {
      return { ok: false, error: `至少需要 ${CONFIG.MIN_PLAYERS} 名在线玩家（可添加 AI 补位）` }
    }
    this.phase = 'playing'
    this.addLog('游戏开始！')
    this.startHand()
    return { ok: true }
  }

  startHand() {
    this.clearTimers()
    const eligible = this.eligiblePlayers()
    if (this.phase !== 'playing' || eligible.length < CONFIG.MIN_PLAYERS) {
      this.endGame(eligible)
      return
    }

    // 庄家按座位顺序轮转
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
    this.engine.handNumber = this.handCount - 1 // startHand 内会 +1，对齐房间手数

    this.addLog(`—— 第 ${this.handCount} 手 ——`)
    this.engine.startHand()
    this.scheduleTurn()
    this.broadcast()
  }

  endGame(eligible = this.eligiblePlayers()) {
    this.clearTimers()
    this.engine = null
    this.phase = 'lobby'
    const champ = eligible[0]
    if (champ) this.addLog(`🏆 ${champ.name} 赢得了全场胜利！`)
    this.broadcast()
  }

  onHandEnd() {
    this.clearTurnTimer()
    // 引擎内是座位玩家的副本，结算后把筹码写回座位
    for (const ep of this.engine.players) {
      const seatP = this.seats[ep.seat]
      if (seatP && seatP.id === ep.id) seatP.chips = ep.chips
    }
    const result = this.engine.lastResult
    if (result.uncontested) {
      const w = result.winners[0]
      this.addLog(`其余玩家全部弃牌，${w.name} 赢得 ${w.amount}`)
    } else {
      for (const w of result.winners) {
        const reveal = result.reveal.find((r) => r.id === w.id)
        this.addLog(`${w.name}${reveal ? `（${reveal.handName}）` : ''} 赢得 ${w.amount}`)
      }
    }
    this.broadcast()
    // 展示一段时间后进入下一手
    this.handTimer = setTimeout(() => {
      this.handTimer = null
      this.startHand()
    }, CONFIG.HAND_END_PAUSE_MS)
  }

  // ==== 行动 ====

  applyAction(playerId, action) {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: '当前没有进行中的牌局' }
    if (!action || typeof action.type !== 'string') return { ok: false, error: '无效操作' }
    return this.step(playerId, action)
  }

  // 执行一次行动并统一处理推进、日志与广播；决策不合法时返回错误
  step(playerId, action) {
    const prevCommunity = this.engine.community.length
    const res = this.engine.act(playerId, action)
    if (!res.ok) return res
    this.logAction(playerId, action)
    if (this.engine.community.length > prevCommunity && this.engine.phase !== 'handEnd') {
      this.addLog(`公共牌：${this.engine.community.map(cardLabel).join(' ')}`)
    }
    this.scheduleTurn()
    this.broadcast()
    return { ok: true }
  }

  logAction(playerId, action) {
    const p = this.engine.playerById(playerId)
    if (!p) return
    if (action.type === 'fold') this.addLog(`${p.name} 弃牌`)
    else if (action.type === 'check') this.addLog(`${p.name} 过牌`)
    else if (action.type === 'call') this.addLog(`${p.name} ${p.allIn ? '全下跟注' : '跟注'} ${p.bet}`)
    else if (action.type === 'raise') this.addLog(`${p.name} ${p.allIn ? '全下' : '加注到'} ${p.bet}`)
  }

  // ==== 回合调度 ====

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
      const timeout =
        timeoutOverrideMs ?? (actor.socketId == null ? CONFIG.OFFLINE_ACTION_TIMEOUT_MS : CONFIG.ACTION_TIMEOUT_MS)
      this.turnEndsAt = Date.now() + timeout
      this.turnDurationMs = timeout
      this.turnTimer = setTimeout(() => this.autoAct(actor.id), timeout)
    }
  }

  // 真人超时：能过牌则过牌，否则弃牌
  autoAct(playerId) {
    this.turnTimer = null
    if (!this.engine || this.engine.currentActor?.id !== playerId) return
    const legal = this.engine.getLegalActions(playerId)
    const p = this.engine.playerById(playerId)
    const action = legal.check ? { type: 'check' } : { type: 'fold' }
    this.addLog(`${p.name} 超时，自动${legal.check ? '过牌' : '弃牌'}`)
    this.step(playerId, action)
  }

  botAct(botId) {
    this.turnTimer = null
    if (!this.engine || this.engine.currentActor?.id !== botId) return
    const actor = this.engine.currentActor
    const legal = this.engine.getLegalActions(botId)

    // 位置：0 = 庄家后第一个行动（前位），1 = 庄家位（后位）
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
      // 决策不合法时兜底
      res = this.step(botId, legal.check ? { type: 'check' } : { type: 'fold' })
    }
    return res
  }
}

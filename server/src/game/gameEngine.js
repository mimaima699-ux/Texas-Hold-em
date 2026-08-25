// 德州扑克游戏状态机（服务器权威）。
// 引擎只负责规则与状态推进；计时器、AI、广播由房间层驱动。

import { createDeck, shuffle } from './deck.js'
import { evaluate } from './handEvaluator.js'
import { awardPots, totalPot } from './pot.js'

export class PokerGame {
  // players: [{ id, seat, name, chips, isBot }]
  // initialDealerIndex: 首手的庄家在 players 中的下标（省略时首手庄家为 0 号位）
  constructor({ players, smallBlind, bigBlind, onResult, initialDealerIndex }) {
    this.players = players
      .map((p, i) => ({
        id: p.id,
        seat: p.seat ?? i,
        name: p.name,
        isBot: !!p.isBot,
        chips: p.chips,
        hole: [],
        folded: false,
        allIn: false,
        bet: 0, // 当前下注轮投入
        committed: 0, // 本手总投入（用于边池）
        acted: false, // 当前下注轮是否已行动
      }))
      .sort((a, b) => a.seat - b.seat)

    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.minRaise = bigBlind // 简化：最小加注幅度固定为大盲

    // -1 表示"下一手庄家为 0 号位"；房间层每手重建引擎时传入上一手的庄家实现轮转
    this.dealerIndex = initialDealerIndex == null ? -1 : initialDealerIndex - 1
    this.deck = []
    this.community = []
    this.phase = 'waiting'
    this.streetBet = 0 // 当前下注轮的最高下注
    this.currentIndex = -1
    this.handNumber = 0
    this.lastResult = null
    this.onResult = onResult || (() => {})
  }

  get currentActor() {
    return this.players[this.currentIndex] ?? null
  }

  get activePlayers() {
    return this.players.filter((p) => !p.folded)
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) ?? null
  }

  nextIndex(i) {
    return (i + 1) % this.players.length
  }

  // 从 startIndex 起，找下一个能行动的玩家（未弃牌且还有筹码）
  findNextActor(startIndex) {
    const n = this.players.length
    for (let k = 0; k < n; k++) {
      const idx = ((startIndex % n) + n + k) % n
      const p = this.players[idx]
      if (!p.folded && p.chips > 0) return idx
    }
    return -1
  }

  // ==== 开局 ====

  startHand() {
    this.handNumber++
    this.deck = shuffle(createDeck())
    this.community = []
    this.phase = 'preflop'
    this.streetBet = 0
    this.lastResult = null
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length

    for (const p of this.players) {
      p.hole = []
      p.folded = false
      p.allIn = false
      p.bet = 0
      p.committed = 0
      p.acted = false
    }

    // 轮流发两张底牌
    for (let round = 0; round < 2; round++) {
      for (const p of this.players) p.hole.push(this.deck.pop())
    }

    this.postBlinds()
    this.startBettingRound(this.firstActorPreflop())
  }

  postBlinds() {
    const n = this.players.length
    let sbIdx
    let bbIdx
    if (n === 2) {
      // 单挑：庄家即小盲
      sbIdx = this.dealerIndex
      bbIdx = this.nextIndex(sbIdx)
    } else {
      sbIdx = this.nextIndex(this.dealerIndex)
      bbIdx = this.nextIndex(sbIdx)
    }
    this.postBet(sbIdx, this.smallBlind)
    this.postBet(bbIdx, this.bigBlind)
  }

  postBet(idx, amount) {
    const p = this.players[idx]
    const actual = Math.min(amount, p.chips)
    p.chips -= actual
    p.bet += actual
    p.committed += actual
    if (p.chips === 0) p.allIn = true
  }

  firstActorPreflop() {
    const n = this.players.length
    const bbIdx = n === 2 ? this.nextIndex(this.dealerIndex) : this.nextIndex(this.nextIndex(this.dealerIndex))
    return this.nextIndex(bbIdx)
  }

  startBettingRound(firstIdx) {
    for (const p of this.players) p.acted = false
    this.streetBet = Math.max(0, ...this.players.map((p) => p.bet))
    const idx = this.findNextActor(firstIdx)
    // 没人还能行动（其余全部全下）：直接发完公共牌摊牌，避免卡死
    if (idx === -1) {
      this.currentIndex = -1
      this.runOut()
      return
    }
    this.currentIndex = idx
  }

  // ==== 行动 ====

  getLegalActions(playerId) {
    const p = this.playerById(playerId)
    if (!p) return null
    const toCall = Math.max(0, this.streetBet - p.bet)
    const canCheck = toCall === 0
    const callAmount = Math.min(toCall, p.chips) // 若筹码不足则为全下跟注
    const allInTo = p.bet + p.chips
    // 只有还存在能响应加注的对手（未弃牌且有筹码）时，加注才有意义
    const hasResponsiveOpponent = this.players.some((q) => q.id !== p.id && !q.folded && q.chips > 0)
    return {
      fold: true,
      check: canCheck,
      canCall: toCall > 0,
      call: callAmount,
      toCall,
      canRaise: p.chips > toCall && hasResponsiveOpponent,
      raiseMin: Math.min(this.streetBet + this.minRaise, allInTo),
      raiseMax: allInTo,
    }
  }

  commit(p, amount) {
    const actual = Math.min(amount, p.chips)
    p.chips -= actual
    p.bet += actual
    p.committed += actual
    if (p.chips === 0) p.allIn = true
    if (p.bet > this.streetBet) this.streetBet = p.bet
  }

  act(playerId, action) {
    const p = this.playerById(playerId)
    if (!p || this.currentActor?.id !== playerId) {
      return { ok: false, error: '还轮不到你行动' }
    }
    const legal = this.getLegalActions(playerId)

    switch (action.type) {
      case 'fold':
        p.folded = true
        p.acted = true
        break
      case 'check':
        if (!legal.check) return { ok: false, error: '当前不能过牌' }
        p.acted = true
        break
      case 'call': {
        if (legal.toCall === 0) return { ok: false, error: '当前无注可跟' }
        this.commit(p, legal.call)
        p.acted = true
        break
      }
      case 'raise': {
        const target = action.amount
        if (typeof target !== 'number' || target < legal.raiseMin || target > legal.raiseMax) {
          return { ok: false, error: '加注额度不合法' }
        }
        this.commit(p, target - p.bet)
        p.acted = true
        // 有人加注，其余可行动玩家需要重新决策
        for (const q of this.players) {
          if (q.id !== p.id && !q.folded && q.chips > 0) q.acted = false
        }
        break
      }
      default:
        return { ok: false, error: '未知操作' }
    }

    this.advance()
    return { ok: true }
  }

  // ==== 状态推进 ====

  advance() {
    const active = this.activePlayers
    if (active.length === 1) {
      this.endHandUncontested(active[0])
      return
    }
    if (this.isBettingRoundComplete()) {
      this.nextStreet()
      return
    }
    const next = this.findNextActor(this.currentIndex + 1)
    if (next === -1) {
      // 无人能再行动（全下或弃牌），直接发完公共牌进入摊牌
      this.runOut()
      return
    }
    this.currentIndex = next
  }

  isBettingRoundComplete() {
    for (const p of this.players) {
      if (p.folded || p.allIn) continue
      if (!p.acted || p.bet !== this.streetBet) return false
    }
    return true
  }

  dealCommunity(count) {
    this.deck.pop() // 烧一张
    for (let i = 0; i < count; i++) this.community.push(this.deck.pop())
  }

  nextStreet() {
    // 收起本轮下注
    for (const p of this.players) p.bet = 0

    if (this.phase === 'preflop') {
      this.dealCommunity(3)
      this.phase = 'flop'
    } else if (this.phase === 'flop') {
      this.dealCommunity(1)
      this.phase = 'turn'
    } else if (this.phase === 'turn') {
      this.dealCommunity(1)
      this.phase = 'river'
    } else if (this.phase === 'river') {
      this.showdown()
      return
    }

    // 翻牌后由庄家左侧第一个未弃牌玩家先行动
    this.startBettingRound(this.dealerIndex + 1)
  }

  runOut() {
    while (this.community.length < 5) {
      this.dealCommunity(this.community.length === 0 ? 3 : 1)
    }
    this.showdown()
  }

  showdown() {
    this.phase = 'showdown'
    const contestants = this.activePlayers
    for (const p of contestants) {
      p.eval = evaluate([...p.hole, ...this.community])
    }

    const entries = this.players.map((p) => ({
      playerId: p.id,
      committed: p.committed,
      folded: p.folded,
      handScore: p.eval?.score ?? null,
    }))
    const { pots, awards } = awardPots(entries)

    for (const p of this.players) {
      p.chips += awards[p.id] || 0
    }

    this.lastResult = {
      type: 'handEnd',
      pots,
      awards,
      winners: this.players
        .filter((p) => (awards[p.id] || 0) > 0)
        .map((p) => ({ id: p.id, name: p.name, amount: awards[p.id] })),
      reveal: contestants.map((p) => ({
        id: p.id,
        name: p.name,
        hole: p.hole,
        handName: p.eval.name,
        score: p.eval.score,
      })),
    }
    this.phase = 'handEnd'
    this.onResult(this.lastResult)
  }

  endHandUncontested(winner) {
    const total = totalPot(this.players.map((p) => ({ committed: p.committed })))
    winner.chips += total
    this.lastResult = {
      type: 'handEnd',
      uncontested: true,
      pots: [{ amount: total, winners: [winner.id] }],
      awards: { [winner.id]: total },
      winners: [{ id: winner.id, name: winner.name, amount: total }],
      reveal: [],
    }
    this.phase = 'handEnd'
    this.onResult(this.lastResult)
  }

  // ==== 序列化（个性化视图） ====

  potForDisplay() {
    return this.players.reduce((s, p) => s + p.committed, 0)
  }

  serializeFor(playerId) {
    const you = this.playerById(playerId)
    const isReveal = this.phase === 'handEnd' || this.phase === 'showdown'
    return {
      phase: this.phase,
      handNumber: this.handNumber,
      community: this.community,
      pot: this.potForDisplay(),
      streetBet: this.streetBet,
      minRaise: this.minRaise,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      dealerSeat: this.players[this.dealerIndex]?.seat ?? null,
      currentTurn: this.currentActor?.id ?? null,
      you: you
        ? {
            id: you.id,
            name: you.name,
            chips: you.chips,
            hole: you.hole,
            folded: you.folded,
            allIn: you.allIn,
            bet: you.bet,
            toCall: Math.max(0, this.streetBet - you.bet),
            legal: this.getLegalActions(you.id),
          }
        : null,
      players: this.players.map((p) => {
        let hole
        if (p.id === playerId) {
          hole = p.hole
        } else if (isReveal && !p.folded) {
          hole = p.hole // 摊牌时亮出进入摊牌玩家的牌
        } else if (p.folded) {
          hole = []
        } else {
          hole = [null, null] // 牌背
        }
        return {
          id: p.id,
          seat: p.seat,
          name: p.name,
          isBot: p.isBot,
          chips: p.chips,
          folded: p.folded,
          allIn: p.allIn,
          bet: p.bet,
          committed: p.committed,
          hole,
          isDealer: this.players[this.dealerIndex]?.id === p.id,
          handName: isReveal && !p.folded ? p.eval?.name ?? null : null,
        }
      }),
      lastResult: this.lastResult,
    }
  }
}

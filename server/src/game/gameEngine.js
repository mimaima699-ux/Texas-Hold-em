// Texas Hold'em game state machine (server authoritative).
// The engine only handles rules and state progression; timers, AI and
// broadcasting are driven by the room layer.

import { createDeck, shuffle } from './deck.js'
import { evaluate } from './handEvaluator.js'
import { awardPots, totalPot } from './pot.js'

export class PokerGame {
  // players: [{ id, seat, name, chips, isBot }]
  // initialDealerIndex: index in players of the first hand's dealer
  // (omitted means player 0 deals the first hand)
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
        bet: 0, // invested in the current betting round
        committed: 0, // total invested this hand (for side pots)
        acted: false, // whether they have acted in the current betting round
      }))
      .sort((a, b) => a.seat - b.seat)

    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.minRaise = bigBlind // simplified: minimum raise size is fixed at one big blind

    // -1 means "next hand's dealer is player 0"; the room layer passes the
    // previous hand's dealer each time it rebuilds the engine to keep rotation
    this.dealerIndex = initialDealerIndex == null ? -1 : initialDealerIndex - 1
    this.deck = []
    this.community = []
    this.phase = 'waiting'
    this.streetBet = 0 // highest bet in the current betting round
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

  // Starting from startIndex, find the next player who can act
  // (not folded and still has chips)
  findNextActor(startIndex) {
    const n = this.players.length
    for (let k = 0; k < n; k++) {
      const idx = ((startIndex % n) + n + k) % n
      const p = this.players[idx]
      if (!p.folded && p.chips > 0) return idx
    }
    return -1
  }

  // ==== Starting a hand ====

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

    // Deal two hole cards each, one at a time
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
      // Heads-up: the dealer is the small blind
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
    // Nobody can act anymore (everyone else is all-in): run out the board
    // and go to showdown directly to avoid stalling
    if (idx === -1) {
      this.currentIndex = -1
      this.runOut()
      return
    }
    this.currentIndex = idx
  }

  // ==== Actions ====

  getLegalActions(playerId) {
    const p = this.playerById(playerId)
    if (!p) return null
    const toCall = Math.max(0, this.streetBet - p.bet)
    const canCheck = toCall === 0
    const callAmount = Math.min(toCall, p.chips) // short call becomes an all-in call
    const allInTo = p.bet + p.chips
    // Raising is only meaningful when an opponent can still respond
    // (not folded and has chips)
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
      return { ok: false, error: 'Not your turn to act' }
    }
    const legal = this.getLegalActions(playerId)

    switch (action.type) {
      case 'fold':
        p.folded = true
        p.acted = true
        break
      case 'check':
        if (!legal.check) return { ok: false, error: 'Cannot check' }
        p.acted = true
        break
      case 'call': {
        if (legal.toCall === 0) return { ok: false, error: 'Nothing to call' }
        this.commit(p, legal.call)
        p.acted = true
        break
      }
      case 'raise': {
        const target = action.amount
        if (typeof target !== 'number' || target < legal.raiseMin || target > legal.raiseMax) {
          return { ok: false, error: 'Invalid raise amount' }
        }
        this.commit(p, target - p.bet)
        p.acted = true
        // A raise re-opens action for everyone else who can still act
        for (const q of this.players) {
          if (q.id !== p.id && !q.folded && q.chips > 0) q.acted = false
        }
        break
      }
      default:
        return { ok: false, error: 'Unknown action' }
    }

    this.advance()
    return { ok: true }
  }

  // ==== State progression ====

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
      // Nobody can act (all-in or folded); deal out the board and go to showdown
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
    this.deck.pop() // burn one card
    for (let i = 0; i < count; i++) this.community.push(this.deck.pop())
  }

  nextStreet() {
    // Collect this round's bets
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

    // Post-flop, first to act is the first unfolded player left of the dealer
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

  // ==== Serialization (personalized views) ====

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
          hole = p.hole // reveal showdown contestants' cards at showdown
        } else if (p.folded) {
          hole = []
        } else {
          hole = [null, null] // card backs
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

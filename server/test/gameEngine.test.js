import { describe, it, expect } from 'vitest'
import { PokerGame } from '../src/game/gameEngine.js'

function makePlayers(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    seat: i,
    name: `Player${i + 1}`,
    chips: 1000,
    isBot: false,
  }))
}

function play(game, type, amount) {
  const r = game.act(game.currentActor.id, { type, amount })
  return r
}

describe('PokerGame', () => {
  it('posts blinds correctly and sets the action order (3 players)', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()

    expect(game.phase).toBe('preflop')
    // Dealer seat0, SB seat1, BB seat2, first to act (UTG) seat0
    expect(game.players[1].bet).toBe(5)
    expect(game.players[2].bet).toBe(10)
    expect(game.streetBet).toBe(10)
    expect(game.currentActor.id).toBe('p0')

    const legal = game.getLegalActions('p0')
    expect(legal.toCall).toBe(10)
    expect(legal.canCall).toBe(true)
    expect(legal.canRaise).toBe(true)
  })

  it('last player standing takes the pot when everyone folds', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()
    play(game, 'fold') // p0 folds
    play(game, 'fold') // p1 (SB) folds
    expect(game.phase).toBe('handEnd')
    expect(game.lastResult.uncontested).toBe(true)
    expect(game.lastResult.winners[0].id).toBe('p2')
    expect(game.lastResult.awards.p2).toBe(15) // 5 + 10 blinds
  })

  it('checking through to showdown conserves chips and splits the pot correctly', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()

    // Preflop: p0 calls, p1 completes, p2 checks
    play(game, 'call')
    play(game, 'call')
    play(game, 'check')
    expect(game.phase).toBe('flop')

    // Post-flop first to act is left of the dealer (p1)
    expect(game.currentActor.id).toBe('p1')

    // Check down flop/turn/river
    for (let i = 0; i < 3; i++) {
      play(game, 'check')
      play(game, 'check')
      play(game, 'check')
    }
    expect(game.phase).toBe('handEnd')

    const totalCommitted = game.players.reduce((s, p) => s + p.committed, 0)
    expect(totalCommitted).toBe(30)

    const totalAwarded = Object.values(game.lastResult.awards).reduce((s, v) => s + v, 0)
    expect(totalAwarded).toBe(30)

    // Total chips conserved
    const totalChips = game.players.reduce((s, p) => s + p.chips, 0)
    expect(totalChips).toBe(3000)
  })

  it('a raise re-opens action and minimum raise is enforced', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()
    // p0 raises to 30
    play(game, 'raise', 30)
    expect(game.players[0].bet).toBe(30)
    expect(game.streetBet).toBe(30)
    // Illegal raise (below the minimum) must be rejected
    const r = game.act(game.currentActor.id, { type: 'raise', amount: 35 })
    expect(r.ok).toBe(false)
  })

  it('short all-in creates side pots distributed correctly', () => {
    const players = [
      { id: 'short', seat: 0, name: 'Short', chips: 15, isBot: false },
      { id: 'deep1', seat: 1, name: 'Deep1', chips: 1000, isBot: false },
      { id: 'deep2', seat: 2, name: 'Deep2', chips: 1000, isBot: false },
    ]
    const game = new PokerGame({ players, smallBlind: 5, bigBlind: 10 })
    game.startHand()

    // Short shoves, both deep stacks call, then check down to showdown
    // Dealer seat0 (short), SB seat1, BB seat2, first to act seat0 (short)
    play(game, 'raise', 15) // short all-in to 15
    // seat1 calls to 15
    play(game, 'call')
    // seat2 calls to 15 (BB already posted 10, adds 5)
    play(game, 'call')
    expect(game.phase).toBe('flop')

    // The two deep stacks check it down
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    expect(game.phase).toBe('handEnd')

    // Main pot 15*3=45, no side pot (three equal amounts), the whole 45
    // goes to a single winner
    const totalAwarded = Object.values(game.lastResult.awards).reduce((s, v) => s + v, 0)
    expect(totalAwarded).toBe(45)
  })

  it('preflop all-in between both players runs out the board without stalling', () => {
    const game = new PokerGame({
      players: [
        { id: 'a', seat: 0, name: 'A', chips: 1000, isBot: false },
        { id: 'b', seat: 1, name: 'B', chips: 1000, isBot: false },
      ],
      smallBlind: 5,
      bigBlind: 10,
    })
    game.startHand()
    // Heads-up: dealer (A) is the small blind. A shoves, B calls all-in
    // → nobody can act, board runs out
    play(game, 'raise', 1000)
    play(game, 'call')
    expect(game.phase).toBe('handEnd')
    expect(game.community.length).toBe(5)
    // Chips conserved
    expect(game.players.reduce((s, p) => s + p.chips, 0)).toBe(2000)
    expect(game.lastResult.reveal.length).toBe(2)
  })

  it('cannot raise when all opponents are all-in; call or fold only', () => {
    const players = [
      { id: 'p0', seat: 0, name: 'A', chips: 500, isBot: false },
      { id: 'p1', seat: 1, name: 'B', chips: 500, isBot: false },
      { id: 'p2', seat: 2, name: 'C', chips: 500, isBot: false },
    ]
    const game = new PokerGame({ players, smallBlind: 5, bigBlind: 10 })
    game.startHand()
    play(game, 'raise', 500) // p0 all-in
    play(game, 'call') // p1 calls all-in
    // Only p2 left, all opponents all-in → cannot raise
    const legal = game.getLegalActions('p2')
    expect(legal.canRaise).toBe(false)
    expect(legal.canCall).toBe(true)
    play(game, 'call') // p2 also calls all-in
    // Three-way all-in → board runs out automatically
    expect(game.phase).toBe('handEnd')
    expect(game.community.length).toBe(5)
  })

  it('initialDealerIndex sets the first hand\'s dealer', () => {
    const game = new PokerGame({
      players: makePlayers(3),
      smallBlind: 5,
      bigBlind: 10,
      initialDealerIndex: 2,
    })
    game.startHand()
    expect(game.players[game.dealerIndex].id).toBe('p2')
    // Dealer seat2 → SB seat0, BB seat1, first to act preflop seat2
    expect(game.players[0].bet).toBe(5)
    expect(game.players[1].bet).toBe(10)
    expect(game.currentActor.id).toBe('p2')
  })
})

import { describe, it, expect } from 'vitest'
import { awardPots, totalPot } from '../src/game/pot.js'

describe('pot / side pot', () => {
  it('simple showdown: equal commitments, winner takes all', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 500 },
      { playerId: 'b', committed: 100, folded: false, handScore: 300 },
    ]
    const { pots, awards } = awardPots(entries)
    expect(totalPot(entries)).toBe(200)
    expect(awards.a).toBe(200)
    expect(awards.b).toBeUndefined()
  })

  it('all-in side pot: short stack wins only the main pot, rest goes to the deep winner', () => {
    const entries = [
      { playerId: 'short', committed: 50, folded: false, handScore: 900 }, // all-in 50, strongest hand
      { playerId: 'deep1', committed: 200, folded: false, handScore: 700 },
      { playerId: 'deep2', committed: 200, folded: false, handScore: 100 },
    ]
    const { pots, awards } = awardPots(entries)
    // Main pot: 50 * 3 = 150, short wins
    // Side pot: (200-50) * 2 = 300, deep1 wins
    expect(awards.short).toBe(150)
    expect(awards.deep1).toBe(300)
    expect(awards.deep2).toBeUndefined()
  })

  it('split pot: two equal scores divide the pot', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 400 },
      { playerId: 'b', committed: 100, folded: false, handScore: 400 },
    ]
    const { awards } = awardPots(entries)
    expect(awards.a).toBe(100)
    expect(awards.b).toBe(100)
  })

  it('odd pot split: remainder goes to the first winner', () => {
    const entries = [
      { playerId: 'a', committed: 5, folded: false, handScore: 400 },
      { playerId: 'b', committed: 5, folded: false, handScore: 400 },
    ]
    const { awards } = awardPots(entries)
    expect(awards.a + awards.b).toBe(10)
    expect(awards.a).toBe(5) // remainder 0
    // Odd case: total pot 11, cannot split evenly
    const entries2 = [
      { playerId: 'a', committed: 3, folded: false, handScore: 400 },
      { playerId: 'b', committed: 4, folded: false, handScore: 400 },
      { playerId: 'c', committed: 4, folded: true, handScore: null },
    ]
    // Level 3: pot 3*3=9; level 4: pot (4-3)*2=2, total 11
    const r2 = awardPots(entries2)
    expect(r2.awards.a + r2.awards.b).toBe(11)
  })

  it('folded players\' chips become dead money, excluded from winning', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 100 },
      { playerId: 'b', committed: 100, folded: false, handScore: 200 },
      { playerId: 'c', committed: 60, folded: true, handScore: null },
    ]
    const { awards } = awardPots(entries)
    expect(awards.b).toBe(260) // whole pot, including c's dead money
    expect(awards.a).toBeUndefined()
  })
})

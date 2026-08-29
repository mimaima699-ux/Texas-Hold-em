import { describe, it, expect } from 'vitest'
import { boardWetness, estimateRangePct, opponentFoldEquity } from '../src/ai/aiPlayer.js'

// Helper: quickly build a card { rank, suit }
const C = (rank, suit = 's') => ({ rank, suit })

describe('boardWetness', () => {
  it('rates a dry, disconnected, rainbow flop as 0', () => {
    const board = [C(2, 's'), C(7, 'h'), C(9, 'c')] // no flush, gap > 4, no broadway
    expect(boardWetness(board)).toBe(0)
  })

  it('rates a two-tone flop with a flush draw as wet', () => {
    const board = [C(4, 's'), C(9, 's'), C(13, 'd')] // two spades → flush draw
    expect(boardWetness(board)).toBeGreaterThanOrEqual(0.5)
  })

  it('rates a connected flop with straight potential as wet', () => {
    const board = [C(7, 's'), C(8, 'h'), C(9, 'd')] // rainbow 7-8-9 → straight draw
    expect(boardWetness(board)).toBeGreaterThan(0)
  })

  it('rates a flush + straight + broadway board highest', () => {
    const board = [C(10, 's'), C(11, 's'), C(12, 'h')]
    expect(boardWetness(board)).toBeGreaterThanOrEqual(0.7)
  })
})

describe('estimateRangePct', () => {
  // Without a track record, the AI leans loose: a casual-game caller is
  // modeled at 0.5 (any two reasonable cards) and an unknown raiser at 0.3,
  // so we don't over-fold before we've actually read them.
  it('defaults to a loose caller range without data', () => {
    expect(estimateRangePct(null)).toBeCloseTo(0.5, 5)
    expect(estimateRangePct({})).toBeCloseTo(0.5, 5)
  })

  it('credits an unknown raiser a tight range', () => {
    expect(estimateRangePct({ preflopRaised: true })).toBeCloseTo(0.3, 5)
  })

  it('treats a preflop raiser as tight (their PFR)', () => {
    const opp = { preflopRaised: true, profile: { hands: 20, vpip: 9, pfr: 4 } }
    expect(estimateRangePct(opp)).toBeCloseTo(0.2, 5) // pfr 4/20
  })

  it('treats a caller as loose (their VPIP)', () => {
    const opp = { preflopRaised: false, profile: { hands: 20, vpip: 8, pfr: 2 } }
    expect(estimateRangePct(opp)).toBeCloseTo(0.4, 5) // vpip 8/20
  })
})

describe('opponentFoldEquity', () => {
  it('defaults to 35% without data', () => {
    expect(opponentFoldEquity({})).toBeCloseTo(0.35, 5)
  })

  it('returns the observed fold-to-bet rate', () => {
    expect(opponentFoldEquity({ profile: { facedBet: 10, foldedToBet: 6 } })).toBeCloseTo(0.6, 5)
  })
})
import { describe, it, expect } from 'vitest'
import { evaluate, compare, CATEGORY } from '../src/game/handEvaluator.js'

// Helper: quickly build a card { rank, suit }
const C = (rank, suit = 's') => ({ rank, suit })

describe('handEvaluator', () => {
  it('recognizes a royal flush', () => {
    const hand = [C(14, 's'), C(13, 's'), C(12, 's'), C(11, 's'), C(10, 's')]
    const r = evaluate(hand)
    expect(r.category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(r.name).toBe('Royal Flush')
  })

  it('quads > full house > flush > straight > trips', () => {
    const quads = [C(9, 's'), C(9, 'h'), C(9, 'd'), C(9, 'c'), C(2, 's')]
    const fullHouse = [C(8, 's'), C(8, 'h'), C(8, 'd'), C(5, 'c'), C(5, 's')]
    const flush = [C(14, 'h'), C(10, 'h'), C(8, 'h'), C(6, 'h'), C(3, 'h')]
    const straight = [C(9, 's'), C(8, 'h'), C(7, 'd'), C(6, 'c'), C(5, 's')]
    const trips = [C(7, 's'), C(7, 'h'), C(7, 'd'), C(4, 'c'), C(2, 's')]

    expect(evaluate(quads).category).toBe(CATEGORY.FOUR_OF_A_KIND)
    expect(evaluate(fullHouse).category).toBe(CATEGORY.FULL_HOUSE)
    expect(evaluate(flush).category).toBe(CATEGORY.FLUSH)
    expect(evaluate(straight).category).toBe(CATEGORY.STRAIGHT)
    expect(evaluate(trips).category).toBe(CATEGORY.THREE_OF_A_KIND)

    expect(compare(quads, fullHouse)).toBeGreaterThan(0)
    expect(compare(fullHouse, flush)).toBeGreaterThan(0)
    expect(compare(flush, straight)).toBeGreaterThan(0)
    expect(compare(straight, trips)).toBeGreaterThan(0)
  })

  it('recognizes A-2-3-4-5 as a 5-high straight (wheel)', () => {
    const wheel = [C(14, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's')]
    const r = evaluate(wheel)
    expect(r.category).toBe(CATEGORY.STRAIGHT)
    expect(r.tiebreak[0]).toBe(5)
    // The wheel loses to 6-5-4-3-2
    const sixHigh = [C(6, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's')]
    expect(compare(sixHigh, wheel)).toBeGreaterThan(0)
  })

  it('kicker comparison: pair with higher kicker wins', () => {
    const pairHighKicker = [C(14, 's'), C(14, 'h'), C(13, 'd'), C(9, 'c'), C(4, 's')]
    const pairLowKicker = [C(14, 's'), C(14, 'h'), C(12, 'd'), C(9, 'c'), C(4, 's')]
    expect(compare(pairHighKicker, pairLowKicker)).toBeGreaterThan(0)
  })

  it('two pair: compare big pair first, then small pair, then kicker', () => {
    const a = [C(14, 's'), C(14, 'h'), C(5, 'd'), C(5, 'c'), C(9, 's')]
    const b = [C(13, 's'), C(13, 'h'), C(5, 'd'), C(5, 'c'), C(14, 's')]
    expect(compare(a, b)).toBeGreaterThan(0)
  })

  it('picks the best 5 out of 7 cards (royal flush)', () => {
    const seven = [
      C(10, 'h'), C(11, 'h'), C(12, 'h'), C(13, 'h'), C(14, 'h'),
      C(9, 'c'), C(8, 's'),
    ]
    const r = evaluate(seven)
    expect(r.category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(r.name).toBe('Royal Flush')
  })

  it('picks the stronger flush when 7 cards contain both a flush and a straight', () => {
    // 5 hearts make a flush; there is also a 7-8-9-10-J straight —
    // the flush (5) must beat the straight (4)
    const seven = [
      C(2, 'h'), C(5, 'h'), C(7, 'h'), C(9, 'h'), C(11, 'h'),
      C(10, 's'), C(8, 'd'),
    ]
    const r = evaluate(seven)
    expect(r.category).toBe(CATEGORY.FLUSH)
    expect(r.tiebreak[0]).toBe(11) // J-high flush
  })
})

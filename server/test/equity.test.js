import { describe, it, expect } from 'vitest'
import { monteCarloEquity, preflopEquity, equityFor, equityVsRanges, countOuts } from '../src/ai/equity.js'

// Helper: quickly build a card { rank, suit }
const C = (rank, suit = 's') => ({ rank, suit })

// Monte Carlo results carry sampling noise, so these assert on wide,
// well-separated intervals (roughly ±5σ) rather than exact values.

describe('monteCarloEquity', () => {
  it('gauges pocket aces as a huge favorite vs one opponent preflop', () => {
    const eq = monteCarloEquity([C(14, 's'), C(14, 'h')], [], { opponents: 1, iterations: 500 })
    expect(eq).toBeGreaterThan(0.75) // true ~0.85
    expect(eq).toBeLessThan(0.95)
  })

  it('gauges 3-2 offsuit as an underdog vs one opponent preflop', () => {
    const eq = monteCarloEquity([C(3, 's'), C(2, 'h')], [], { opponents: 1, iterations: 500 })
    expect(eq).toBeGreaterThan(0.15) // true ~0.32
    expect(eq).toBeLessThan(0.5)
  })

  it('gauges trip aces on the flop as a near-lock', () => {
    const hole = [C(14, 's'), C(14, 'h')]
    const board = [C(14, 'd'), C(7, 'c'), C(2, 's')]
    const eq = monteCarloEquity(hole, board, { opponents: 1, iterations: 500 })
    expect(eq).toBeGreaterThan(0.85)
  })

  it('drops equity as more opponents contest the pot', () => {
    const hole = [C(14, 's'), C(14, 'h')]
    const one = monteCarloEquity(hole, [], { opponents: 1, iterations: 400 })
    const four = monteCarloEquity(hole, [], { opponents: 4, iterations: 400 })
    expect(one).toBeGreaterThan(four)
  })
})

describe('preflopEquity', () => {
  it('is cached: the same hand class returns an identical value', () => {
    const a = preflopEquity(C(14, 's'), C(13, 's'), 1)
    const b = preflopEquity(C(14, 'h'), C(13, 'h'), 1) // same class, different suits
    expect(a).toBe(b)
  })

  it('ranks pocket aces clearly above ace-king offsuit', () => {
    expect(preflopEquity(C(14, 's'), C(14, 'h'), 1)).toBeGreaterThan(
      preflopEquity(C(14, 's'), C(13, 'h'), 1) + 0.1
    )
  })

  it('prefers suited connectors over their offsuit equivalent', () => {
    expect(preflopEquity(C(11, 's'), C(10, 's'), 1)).toBeGreaterThan(
      preflopEquity(C(11, 's'), C(10, 'h'), 1)
    )
  })
})

describe('equityFor', () => {
  it('routes preflop through the cache and postflop through Monte Carlo', () => {
    expect(equityFor([C(14, 's'), C(14, 'h')], [], 1)).toBe(preflopEquity(C(14, 's'), C(14, 'h'), 1))
    const post = equityFor([C(14, 's'), C(14, 'h')], [C(14, 'd'), C(7, 'c'), C(2, 's')], 1)
    expect(post).toBeGreaterThan(0.85)
  })
})

describe('countOuts', () => {
  it('counts a flush draw as 9 outs', () => {
    const hole = [C(14, 'h'), C(13, 'h')]
    const board = [C(2, 'h'), C(7, 'h'), C(11, 's'), C(3, 'c')]
    expect(countOuts(hole, board)).toBe(9)
  })

  it('counts an open-ended straight draw as 8 outs', () => {
    const hole = [C(5, 'h'), C(6, 'h')]
    const board = [C(7, 's'), C(8, 'd'), C(13, 'c')]
    expect(countOuts(hole, board)).toBe(8)
  })

  it('does not double-count the shared card of a flush + straight combo draw', () => {
    // A♥K♥ on Q♥J♥2♣: 9 flush outs, 4 gutshot tens — T♥ completes both,
    // so the total is 12 distinct outs, not 13.
    const hole = [C(14, 'h'), C(13, 'h')]
    const board = [C(12, 'h'), C(11, 'h'), C(2, 'c')]
    expect(countOuts(hole, board)).toBe(12)
  })
})

describe('equityVsRanges', () => {
  it('matches random equity when the range is 1.0', () => {
    const eq = equityVsRanges([C(14, 's'), C(14, 'h')], [], [1.0], { iterations: 400 })
    expect(eq).toBeGreaterThan(0.75) // ~0.85 vs any two
    expect(eq).toBeLessThan(0.95)
  })

  it('drops a marginal hand against a tight range vs random', () => {
    const hole = [C(12, 's'), C(11, 'h')] // QJo
    const vsRandom = equityVsRanges(hole, [], [1.0], { iterations: 400 })
    const vsTight = equityVsRanges(hole, [], [0.05], { iterations: 400 })
    expect(vsTight).toBeLessThan(vsRandom - 0.15) // top 5% dominates QJo
  })

  it('keeps aces strong even against a tight range', () => {
    const eq = equityVsRanges([C(14, 's'), C(14, 'h')], [], [0.05], { iterations: 400 })
    expect(eq).toBeGreaterThan(0.75)
  })
})
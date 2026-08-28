// Hand equity used by the AI.
//
// `monteCarloEquity` is the workhorse: it repeatedly deals out the rest of the
// board and each opponent's unknown hole cards, then grades the hands with the
// server's exact `evaluate` and compares. This replaces the old category-based
// approximation (a made-hand "baseline" plus a linear outs bonus), which read a
// fixed strength off the hand type — unable to tell "my small flush" from
// "their bigger flush" and systematically over-counting combo draws.
//
// `preflopEquity` caches Monte Carlo results per hand class (pair / suited /
// offsuit) × opponent count, so hands already seen don't re-roll the sim.

import { evaluate } from '../game/handEvaluator.js'
import { createDeck, shuffle, SUITS, RANKS } from '../game/deck.js'

const SUIT_INDEX = { c: 0, d: 1, h: 2, s: 3 }
const cardKey = (c) => c.rank * 4 + SUIT_INDEX[c.suit]

// Monte Carlo equity: chance that `hole` beats or ties every opponent, given
// the current board. Remaining streets and each opponent's hole cards are
// sampled uniformly from the unseen cards. `opponents` is the number of
// non-folded opponents still contesting the pot.
export function monteCarloEquity(hole, community, { opponents = 1, iterations = 500, rng = Math.random } = {}) {
  if (!hole || hole.length < 2) return 0
  const seen = new Set([...hole, ...community].map(cardKey))
  const unseen = createDeck().filter((c) => !seen.has(cardKey(c)))

  let win = 0
  let tie = 0

  for (let it = 0; it < iterations; it++) {
    // Sample a full ordering of the unseen cards, then slice what we need
    const deck = shuffle([...unseen], rng)
    let p = 0
    const board = community.concat(deck.slice(0, 5 - community.length))
    p = 5 - community.length
    const myScore = evaluate([...hole, ...board]).score

    let lost = false
    let tied = false
    for (let o = 0; o < opponents; o++) {
      const score = evaluate([...deck.slice(p, p + 2), ...board]).score
      p += 2
      if (score > myScore) lost = true
      else if (score === myScore) tied = true
    }

    if (!lost) (tied ? tie++ : win++)
  }

  // A tie counts as half a win — exact heads-up; a close approximation multiway
  // where pot splits get more complicated.
  return (win + tie * 0.5) / iterations
}

const preflopCache = new Map()

// Equity of a starting-hand class against `opponents` random hands. Results are
// cached forever — a concrete canonical instance stands in for the whole class
// (e.g. A♠K♠ for "AK suited"), so re-seen hands return immediately.
export function preflopEquity(c1, c2, opponents) {
  const high = Math.max(c1.rank, c2.rank)
  const low = Math.min(c1.rank, c2.rank)
  const suited = c1.suit === c2.suit
  const key = `${high}-${low}-${suited ? 's' : 'o'}-${opponents}`

  if (!preflopCache.has(key)) {
    const hole =
      high === low
        ? [{ rank: high, suit: 's' }, { rank: high, suit: 'h' }] // pocket pair
        : suited
          ? [{ rank: high, suit: 's' }, { rank: low, suit: 's' }]
          : [{ rank: high, suit: 's' }, { rank: low, suit: 'h' }]
    preflopCache.set(key, monteCarloEquity(hole, [], { opponents, iterations: 5000 }))
  }
  return preflopCache.get(key)
}

// One entry point for the AI: real equity against `opponents` remaining players.
export function equityFor(hole, community, opponents) {
  if (!hole || hole.length < 2) return 0
  if (community.length === 0) return preflopEquity(hole[0], hole[1], opponents)
  return monteCarloEquity(hole, community, { opponents })
}

// Rough "outs" count (unseen cards that complete a strong draw), used only to
// pace semi-bluffs. Each card is counted once even when it fills both a flush
// and straight draw (a combo draw doesn't double-count its shared card).
export function countOuts(hole, community) {
  const cards = [...hole, ...community]
  if (community.length === 0) return 0

  const outs = new Set()

  // Flush draw: exactly 4 of one suit → the 9 unseen cards of that suit
  const suitCounts = {}
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1
  const flushSuit = Object.keys(suitCounts).find((s) => suitCounts[s] === 4)
  if (flushSuit) {
    for (const rank of RANKS) {
      if (!cards.some((c) => c.rank === rank && c.suit === flushSuit)) {
        outs.add(`${rank}-${flushSuit}`)
      }
    }
  }

  // Straight draw: any rank completing 4-of-the-5 straight, all four suits
  const ranksHave = new Set(cards.map((c) => c.rank))
  const highs = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  for (const high of highs) {
    const need = high === 5 ? [14, 2, 3, 4, 5] : [high - 4, high - 3, high - 2, high - 1, high]
    if (need.filter((r) => ranksHave.has(r)).length === 4) {
      for (const r of need) {
        if (!ranksHave.has(r)) for (const s of SUITS) outs.add(`${r}-${s}`)
      }
    }
  }

  return Math.min(outs.size, 18)
}

// ---------------------------------------------------------------------------
// Range-aware equity. Instead of assuming an opponent holds any two cards, we
// assume they hold something in the top `p`% of starting hands (where p comes
// from their VPIP/PFR and preflop aggression — see aiPlayer.js). Each hand
// class is ranked by a deterministic strength score so "top 20%" has a stable
// meaning; the score only needs to ORDER strong hands above weak ones, not to
// measure equity.
// ---------------------------------------------------------------------------

// Deterministic preflop rank score (0..1), used ONLY to order the 169 classes.
function preflopRankScore(c1, c2) {
  const high = Math.max(c1.rank, c2.rank)
  const low = Math.min(c1.rank, c2.rank)
  const suited = c1.suit === c2.suit
  if (high === low) return 0.5 + ((high - 2) / 12) * 0.5 // 22 → 0.5 … AA → 1.0
  let s = ((high - 2) / 12) * 0.4 + ((low - 2) / 12) * 0.2
  if (suited) s += 0.04
  const gap = high - low
  if (gap === 1) s += 0.04
  else if (gap === 2) s += 0.02
  return s
}

// The 169 preflop classes (13 pairs + 78 suited + 78 offsuit), strongest first.
const RANGE_ORDER = (() => {
  const classes = []
  for (let high = 14; high >= 2; high--) {
    for (let low = high; low >= 2; low--) {
      if (high === low) {
        classes.push({ high, low, suited: false, score: preflopRankScore({ rank: high, suit: 's' }, { rank: low, suit: 'h' }) })
      } else {
        classes.push({ high, low, suited: true, score: preflopRankScore({ rank: high, suit: 's' }, { rank: low, suit: 's' }) })
        classes.push({ high, low, suited: false, score: preflopRankScore({ rank: high, suit: 's' }, { rank: low, suit: 'h' }) })
      }
    }
  }
  classes.sort((a, b) => b.score - a.score)
  return classes
})()

// Sample one hand class from the top `p`% of the ranking and materialize two
// concrete cards that don't collide with anything in `used`.
function sampleFromRange(p, used, rng) {
  const top = Math.max(1, Math.round(Math.min(1, p) * RANGE_ORDER.length))
  for (let attempt = 0; attempt < 24; attempt++) {
    const { high, low, suited } = RANGE_ORDER[Math.floor(rng() * top)]
    let cards
    if (high === low) {
      const [s1, s2] = shuffle([...SUITS], rng)
      cards = [{ rank: high, suit: s1 }, { rank: high, suit: s2 }]
    } else if (suited) {
      const s = SUITS[Math.floor(rng() * 4)]
      cards = [{ rank: high, suit: s }, { rank: low, suit: s }]
    } else {
      const [s1, s2] = shuffle([...SUITS], rng)
      cards = [{ rank: high, suit: s1 }, { rank: low, suit: s2 }]
    }
    if (!cards.some((c) => used.has(cardKey(c)))) return cards
  }
  return null
}

// Equity against a specific range per opponent. `ranges` is one percentile
// (0..1) per non-folded opponent; 1.0 ≈ any two cards (uniform). Empty ranges
// mean we win uncontested.
export function equityVsRanges(hole, community, ranges, { iterations = 500, rng = Math.random } = {}) {
  if (!hole || hole.length < 2) return 0
  const seen = new Set([...hole, ...community].map(cardKey))
  let win = 0
  let tie = 0

  for (let it = 0; it < iterations; it++) {
    const used = new Set(seen)
    const oppHoles = []
    let ok = true
    for (const p of ranges) {
      const cards = sampleFromRange(p, used, rng)
      if (!cards) {
        ok = false
        break
      }
      cards.forEach((c) => used.add(cardKey(c)))
      oppHoles.push(cards)
    }
    if (!ok) continue // couldn't place the range (pathological) — skip the try

    const remaining = createDeck().filter((c) => !used.has(cardKey(c)))
    const deck = shuffle(remaining, rng)
    const board = community.concat(deck.slice(0, 5 - community.length))
    const myScore = evaluate([...hole, ...board]).score

    let lost = false
    let tied = false
    for (const oh of oppHoles) {
      const score = evaluate([...oh, ...board]).score
      if (score > myScore) lost = true
      else if (score === myScore) tied = true
    }
    if (!lost) (tied ? tie++ : win++)
  }

  return (win + tie * 0.5) / iterations
}
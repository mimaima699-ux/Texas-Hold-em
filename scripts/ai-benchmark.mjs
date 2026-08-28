// AI benchmark: plays the current heuristic AI and the pre-refactor AI against
// ONE hand-written, deterministic baseline opponent, over paired seeded deals
// so card luck cancels and the improvement is measured with low variance.
//
// Usage: node scripts/ai-benchmark.mjs [hands] [seeds]   (default 150 / 3)

import { PokerGame } from '../server/src/game/gameEngine.js'
import { decide as newDecide } from '../server/src/ai/aiPlayer.js'
import { evaluate, CATEGORY } from '../server/src/game/handEvaluator.js'

const HANDS = Number(process.argv[2] || 150)
const SEEDS = Number(process.argv[3] || 3)
const START = 1000
const SB = 5
const BB = 10

// Deterministic PRNG so a given seed reproduces the same deals (and only the
// same deals — the AI's internal randomness uses a separate stream).
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Fixed baseline opponent — hand-written, medium-tight, fully deterministic
// (no randomness in its decisions), and independent of the AI under test.
// ---------------------------------------------------------------------------

// Chen-style preflop score (0..1), deterministic
function basePreflop(c1, c2) {
  const rankPoint = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2)
  const high = Math.max(c1.rank, c2.rank)
  const low = Math.min(c1.rank, c2.rank)
  const gap = high - low
  let s
  if (high === low) s = Math.max(5, rankPoint(high)) * 2
  else {
    s = rankPoint(high)
    if (gap === 2) s -= 1
    else if (gap === 3) s -= 2
    else if (gap === 4) s -= 4
    else if (gap >= 5) s -= 5
    if (c1.suit === c2.suit) s += 2
  }
  return Math.max(0, s / 20)
}

const BASE_CAT = {
  [CATEGORY.HIGH_CARD]: 0.15,
  [CATEGORY.ONE_PAIR]: 0.42,
  [CATEGORY.TWO_PAIR]: 0.6,
  [CATEGORY.THREE_OF_A_KIND]: 0.72,
  [CATEGORY.STRAIGHT]: 0.82,
  [CATEGORY.FLUSH]: 0.87,
  [CATEGORY.FULL_HOUSE]: 0.93,
  [CATEGORY.FOUR_OF_A_KIND]: 0.97,
  [CATEGORY.STRAIGHT_FLUSH]: 0.99,
}

function baselineStrength(hole, community) {
  if (community.length === 0) return basePreflop(hole[0], hole[1])
  const ev = evaluate([...hole, ...community])
  return (BASE_CAT[ev.category] ?? 0.1) + ((ev.tiebreak[0] ?? 0) / 14) * 0.04
}

const baseClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function baseRaise(ctx, frac) {
  const target = ctx.currentBet + ctx.toCall + Math.round(ctx.potSize * frac)
  return { type: 'raise', amount: Math.round(baseClamp(target, ctx.legal.raiseMin, ctx.legal.raiseMax)) }
}

function baselineDecide(ctx) {
  const st = baselineStrength(ctx.hole, ctx.community)
  const { toCall, potSize, legal, community } = ctx
  if (community.length === 0) {
    if (toCall === 0) {
      return st > 0.62 && legal.canRaise ? baseRaise(ctx, 0.5) : { type: 'check' }
    }
    const price = toCall / (potSize + toCall)
    if (st > 0.78 && legal.canRaise) return baseRaise(ctx, 0.6) // 3-bet top ~10%
    if (st > price + 0.06) return { type: 'call' }
    return { type: 'fold' }
  }
  const price = toCall > 0 ? toCall / (potSize + toCall) : 0
  if (toCall === 0) {
    if (st > 0.7 && legal.canRaise) return baseRaise(ctx, 0.6) // value bet
    return { type: 'check' }
  }
  if (st > price + 0.05) return { type: 'call' }
  return { type: 'fold' }
}

// ---------------------------------------------------------------------------
// Old AI (pre-refactor), inlined for comparison so we don't depend on the
// deleted equity.js exports. Identical logic to the previous aiPlayer/equity.
// ---------------------------------------------------------------------------

function oldPreflopStrength(c1, c2) {
  const r1 = c1.rank
  const r2 = c2.rank
  const suited = c1.suit === c2.suit
  const high = Math.max(r1, r2)
  const low = Math.min(r1, r2)
  let s
  if (r1 === r2) {
    s = 0.6 + ((r1 - 2) / 12) * 0.38
  } else {
    s = 0.28 + ((high - 2) / 12) * 0.4 + ((low - 2) / 12) * 0.08
    if (suited) s += 0.04
    const gap = high - low
    if (gap === 1) s += 0.06
    else if (gap === 2) s += 0.03
    else if (gap <= 4) s += 0.01
    if (high >= 13) s += 0.03
  }
  return Math.max(0.05, Math.min(0.98, s))
}

const OLD_CATEGORY_BASE = {
  [CATEGORY.HIGH_CARD]: 0.08,
  [CATEGORY.ONE_PAIR]: 0.32,
  [CATEGORY.TWO_PAIR]: 0.62,
  [CATEGORY.THREE_OF_A_KIND]: 0.74,
  [CATEGORY.STRAIGHT]: 0.84,
  [CATEGORY.FLUSH]: 0.88,
  [CATEGORY.FULL_HOUSE]: 0.94,
  [CATEGORY.FOUR_OF_A_KIND]: 0.97,
  [CATEGORY.STRAIGHT_FLUSH]: 0.99,
}

function oldCountOuts(hole, community) {
  const cards = [...hole, ...community]
  if (community.length === 0) return 0
  const ranks = new Set(cards.map((c) => c.rank))
  let outs = 0
  const suitCounts = {}
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1
  if (Object.values(suitCounts).some((n) => n === 4)) outs += 9
  const highs = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  for (const high of highs) {
    const need = high === 5 ? [14, 2, 3, 4, 5] : [high - 4, high - 3, high - 2, high - 1, high]
    const have = need.filter((r) => ranks.has(r)).length
    if (have === 4) {
      const missing = need.filter((r) => !ranks.has(r))
      outs += missing.length * 4
    }
  }
  return Math.min(outs, 18)
}

function oldEstimateEquity(hole, community) {
  const cards = [...hole, ...community]
  if (community.length === 0) return oldPreflopStrength(hole[0], hole[1])
  const ev = evaluate(cards)
  const base = OLD_CATEGORY_BASE[ev.category] ?? 0.05
  const tieAdj = ((ev.tiebreak[0] ?? 0) / 14) * 0.03
  const outs = oldCountOuts(hole, community)
  const cardsToCome = 5 - community.length
  const drawEq = outs * (cardsToCome >= 2 ? 0.04 : 0.02)
  return Math.min(0.98, base + tieAdj + drawEq)
}

const oldClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function oldRaiseTo(ctx, desiredTotal) {
  const { legal } = ctx
  return { type: 'raise', amount: Math.round(oldClamp(desiredTotal, legal.raiseMin, legal.raiseMax)) }
}

function oldDecide(ctx) {
  const { community } = ctx
  return community.length === 0 ? oldDecidePreflop(ctx) : oldDecidePostflop(ctx)
}

function oldDecidePreflop(ctx) {
  const { hole, toCall, currentBet, potSize, legal, position, bigBlind, rng } = ctx
  const strength = oldPreflopStrength(hole[0], hole[1])
  const posBonus = position * 0.12
  if (toCall === 0) {
    if (strength > 0.55 + posBonus && legal.canRaise) {
      return oldRaiseTo(ctx, currentBet + Math.round(bigBlind * (2.5 + rng() * 0.5)))
    }
    if (strength > 0.42 + posBonus && rng() < 0.12 && legal.canRaise) {
      return oldRaiseTo(ctx, currentBet + Math.round(bigBlind * 2.5))
    }
    return { type: 'check' }
  }
  const required = 0.4 - posBonus
  if (strength > required + 0.25 && legal.canRaise) {
    return oldRaiseTo(ctx, currentBet + toCall + Math.round(Math.max(bigBlind * 2, toCall * 2)))
  }
  if (strength > required) {
    return { type: 'call' }
  }
  if (position > 0.6 && rng() < 0.06 && legal.canRaise) {
    return oldRaiseTo(ctx, currentBet + toCall + Math.round(toCall * 1.5 + bigBlind))
  }
  return { type: 'fold' }
}

function oldDecidePostflop(ctx) {
  const { hole, community, toCall, currentBet, potSize, legal, position, rng } = ctx
  const equity = oldEstimateEquity(hole, community)
  const outs = oldCountOuts(hole, community)
  const potOdds = toCall > 0 ? toCall / (potSize + toCall) : 0
  const strong = equity > 0.62
  const medium = equity >= 0.4
  const weak = equity < 0.4
  if (toCall === 0) {
    if (strong && legal.canRaise) return oldRaiseTo(ctx, currentBet + Math.round(potSize * (0.6 + rng() * 0.15)))
    if (medium && outs >= 4 && rng() < 0.5 && legal.canRaise) return oldRaiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.16)))
    if (weak && position > 0.6 && rng() < 0.1 && legal.canRaise) return oldRaiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.25)))
    return { type: 'check' }
  }
  if (potOdds < equity) {
    if (strong && rng() < 0.4 && legal.canRaise) return oldRaiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
    return { type: 'call' }
  }
  if (outs >= 8 && rng() < 0.2 && legal.canRaise) return oldRaiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
  return { type: 'fold' }
}

// ---------------------------------------------------------------------------
// Heads-up harness (AI under test = seat A, baseline = seat B)
// ---------------------------------------------------------------------------

const emptyStats = () => ({
  profile: { hands: 0, vpip: 0, pfr: 0, facedBet: 0, foldedToBet: 0 },
  _handVpip: false,
  _handPfr: false,
  _preflopRaised: false,
  pre: { fold: 0, check: 0, call: 0, raise: 0 },
  post: { fold: 0, check: 0, call: 0, raise: 0 },
  showdowns: 0,
})

function buildCtx(engine, actorId, byId, aiRng) {
  const actor = engine.playerById(actorId)
  const legal = engine.getLegalActions(actorId)
  const players = engine.players
  const n = players.length
  const dist = (players.indexOf(actor) - engine.dealerIndex + n) % n
  const position = n <= 1 ? 1 : ((dist - 1 + n) % n) / (n - 1)
  return {
    hole: actor.hole,
    community: engine.community,
    toCall: legal.toCall,
    currentBet: engine.streetBet,
    potSize: engine.potForDisplay(),
    legal,
    position,
    bigBlind: engine.bigBlind,
    smallBlind: engine.smallBlind,
    stack: actor.chips,
    opponents: players
      .filter((q) => q.id !== actorId)
      .map((q) => {
        const o = byId[q.id]
        return {
          name: q.name,
          stack: q.chips,
          bet: q.bet,
          folded: q.folded,
          profile: o.profile,
          preflopRaised: !!o._preflopRaised,
        }
      }),
    rng: aiRng,
  }
}

function actVariant(engine, actorId, decider, byId, aiRng) {
  const phase = engine.phase
  const legal = engine.getLegalActions(actorId)
  const s = byId[actorId]
  const ctx = buildCtx(engine, actorId, byId, aiRng)
  const action = actorId === 'A' ? decider(ctx) : baselineDecide(ctx)

  // Observe profile (mirror room.js observeProfile)
  if (phase === 'preflop') {
    if (!s._handVpip && (action.type === 'call' || action.type === 'raise')) {
      s._handVpip = true
      s.profile.vpip++
    }
    if (!s._handPfr && action.type === 'raise') {
      s._handPfr = true
      s.profile.pfr++
    }
    if (action.type === 'raise') s._preflopRaised = true
  }
  if (legal && legal.toCall > 0) {
    s.profile.facedBet++
    if (action.type === 'fold') s.profile.foldedToBet++
  }

  const bucket = engine.community.length === 0 ? s.pre : s.post
  bucket[action.type]++

  const res = engine.act(actorId, action)
  if (!res.ok) {
    const lg = engine.getLegalActions(actorId)
    engine.act(actorId, lg.check ? { type: 'check' } : { type: 'fold' })
  }
}

function playVariant(decider, deckRng, aiRng, hands) {
  const ai = emptyStats()
  const base = emptyStats()
  const byId = { A: ai, B: base }
  let net = 0
  let wins = 0
  let ties = 0

  for (let h = 0; h < hands; h++) {
    const players = [
      { id: 'A', seat: 0, name: 'AI', isBot: true, chips: START },
      { id: 'B', seat: 1, name: 'BASE', isBot: true, chips: START },
    ]
    const engine = new PokerGame({ players, smallBlind: SB, bigBlind: BB, initialDealerIndex: h % 2, rng: deckRng })
    engine.startHand()
    ai.profile.hands++
    base.profile.hands++
    ai._handVpip = ai._handPfr = ai._preflopRaised = false
    base._handVpip = base._handPfr = base._preflopRaised = false

    let guard = 0
    while (engine.phase !== 'handEnd' && guard++ < 2000) {
      const actor = engine.currentActor
      if (!actor) break
      actVariant(engine, actor.id, decider, byId, aiRng)
    }

    if (engine.activePlayers.length === 2) ai.showdowns++

    const aNet = engine.playerById('A').chips - START
    net += aNet
    if (aNet > 0) wins++
    else if (aNet === 0) ties++
  }
  return { net, wins, ties, ai }
}

// ---------------------------------------------------------------------------
// Run: paired seeds — new and old see the SAME deals so the difference is
// mostly card-luck-free.
// ---------------------------------------------------------------------------

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const std = (a) => {
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length)
}

const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  .slice(0, SEEDS)
  .map((seed) => {
    const newRun = playVariant(newDecide, mulberry32(seed), mulberry32(seed * 7919 + 1), HANDS)
    const oldRun = playVariant(oldDecide, mulberry32(seed), mulberry32(seed * 7919 + 2), HANDS)
    return { new: newRun, old: oldRun, diff: newRun.net - oldRun.net }
  })

const newNets = results.map((r) => r.new.net)
const oldNets = results.map((r) => r.old.net)
const diffs = results.map((r) => r.diff)
const totalHands = SEEDS * HANDS
const newWins = results.reduce((s, r) => s + r.new.wins, 0)
const oldWins = results.reduce((s, r) => s + r.old.wins, 0)

const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(0)
const bb100 = (net) => ((net / totalHands) * 100) / BB

// Aggregate the new AI's action distribution across seeds
const agg = emptyStats()
for (const r of results) {
  for (const k of ['fold', 'check', 'call', 'raise']) {
    agg.pre[k] += r.new.ai.pre[k]
    agg.post[k] += r.new.ai.post[k]
  }
  agg.showdowns += r.new.ai.showdowns
}
const sum = (o) => o.fold + o.check + o.call + o.raise || 1
const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%'

console.log(`\nHeads-up vs deterministic baseline (paired deals), ${HANDS} hands × ${SEEDS} seeds, ${START} @ ${SB}/${BB}\n`)
console.log(`NEW (range-aware)   net ${fmt(mean(newNets))} ± ${std(newNets).toFixed(0)}  win ${pct(newWins, totalHands)}  (${bb100(mean(newNets)).toFixed(1)} BB/100)`)
console.log(`OLD (category only) net ${fmt(mean(oldNets))} ± ${std(oldNets).toFixed(0)}  win ${pct(oldWins, totalHands)}  (${bb100(mean(oldNets)).toFixed(1)} BB/100)`)
console.log(`Improvement (NEW−OLD) ${fmt(mean(diffs))} ± ${std(diffs).toFixed(0)} chips (${(bb100(mean(diffs))).toFixed(1)} BB/100)`)
console.log('\nNEW per-street:')
console.log('  pre : ' + ['fold', 'check', 'call', 'raise'].map((k) => `${k} ${pct(agg.pre[k], sum(agg.pre))}`).join('  '))
console.log('  post: ' + ['fold', 'check', 'call', 'raise'].map((k) => `${k} ${pct(agg.post[k], sum(agg.post))}`).join('  '))
console.log(`  showdown rate: ${pct(agg.showdowns, totalHands)}\n`)
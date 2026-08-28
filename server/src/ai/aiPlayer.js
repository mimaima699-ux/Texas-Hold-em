// Medium-strategy AI decision making.
// Input context (provided by the room layer):
//   { hole, community, toCall, currentBet, potSize, legal, position, bigBlind, opponents, rng }
// Output: { type: 'fold'|'check'|'call'|'raise', amount? }
//
// Decisions are EV-driven: equity is computed against each opponent's hand
// range (built from their tracked VPIP/PFR and preflop aggression), weighed
// against the pot odds, and bluffs are gated on fold equity (their observed
// fold-to-bet rate) rather than a blind probability. Bet sizing still scales
// with board texture and stack-to-pot ratio.

import { equityVsRanges, countOuts } from './equity.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function decide(ctx) {
  const active = activeOpponents(ctx)
  const share = 1 / (active.length + 1) // an even split of the field
  const ranges = active.map(estimateRangePct)
  const equity = equityVsRanges(ctx.hole, ctx.community, ranges, { rng: ctx.rng })
  // Bluff against the most call-happy opponent (lowest fold rate), so we don't
  // bluff into someone who never folds.
  const foldEq = active.length ? Math.min(...active.map(opponentFoldEquity)) : 0.35
  // How loose the loosest remaining opponent is (0 = nit, 1 = plays any two):
  // we widen our aggression against loose players and tighten against nits.
  const looseness = ranges.length ? Math.max(...ranges) : 0.5
  const enriched = { ...ctx, equity, share, foldEq, looseness }
  return ctx.community.length === 0 ? decidePreflop(enriched) : decidePostflop(enriched)
}

// Non-folded opponents still contesting the pot
function activeOpponents(ctx) {
  if (Array.isArray(ctx.opponents)) return ctx.opponents.filter((o) => !o.folded)
  return []
}

// Map an opponent's tracked stats → the fraction of starting hands we think
// they hold right now (1.0 = any two). No data → a middle-of-the-road 30%.
export function estimateRangePct(opp) {
  const prof = opp?.profile
  const raised = !!opp?.preflopRaised
  if (!prof || prof.hands < 5) {
    // No track record yet: lean on this hand's preflop action alone. Assume
    // opponents are on the loose side (casual games) so we don't fold too much
    // before we've actually read them.
    return raised ? 0.3 : 0.5
  }
  const vpip = prof.vpip / prof.hands
  const pfr = prof.pfr / prof.hands
  // Raised preflop → their strongest hands, roughly their raise frequency.
  if (raised) return Math.max(0.05, Math.min(0.6, pfr))
  return Math.max(0.1, Math.min(0.8, vpip))
}

// How often we expect a bet to win the pot right away (fold-to-bet rate).
export function opponentFoldEquity(opp) {
  const prof = opp?.profile
  if (!prof || prof.facedBet < 3) return 0.35
  return Math.min(0.9, Math.max(0.05, prof.foldedToBet / prof.facedBet))
}

// Build a legal raise (target total bet), clamped into [raiseMin, raiseMax]
function raiseTo(ctx, desiredTotal) {
  const { legal } = ctx
  return { type: 'raise', amount: Math.round(clamp(desiredTotal, legal.raiseMin, legal.raiseMax)) }
}

// Break-even check for a pure bluff: betting `amount` into `pot` is +EV only if
// the opponent folds more often than amount / (pot + amount).
function bluffProfitable(amount, pot, foldEq) {
  if (pot <= 0 || amount <= 0) return false
  return foldEq > amount / (pot + amount)
}

function decidePreflop(ctx) {
  const { toCall, currentBet, potSize, legal, position, bigBlind, rng, equity, share, foldEq, looseness } = ctx
  // Edge over an even split of the field, nudged by position (later = looser)
  const edge = equity - share + position * 0.12

  if (toCall === 0) {
    // Free to see the flop — open/raise with a clear edge, else check along.
    // Charge loose callers more with a bigger open.
    if (edge > 0.12 && legal.canRaise) {
      return raiseTo(ctx, currentBet + Math.round(bigBlind * (2.5 + looseness * 0.5 + rng() * 0.5)))
    }
    if (edge > 0.02 && rng() < 0.12 && legal.canRaise) {
      return raiseTo(ctx, currentBet + Math.round(bigBlind * 2.5))
    }
    return { type: 'check' }
  }

  // Facing a bet — call when equity beats the price, 3-bet with a big edge.
  // Loose opponents raise wide, so we can 3-bet wider too; nits demand a
  // premium before we re-raise.
  const price = toCall / (potSize + toCall)
  const threeBetEdge = 0.26 - looseness * 0.14
  const callMargin = -0.04 - looseness * 0.03
  if (equity > price + callMargin) {
    if (edge > threeBetEdge && legal.canRaise) {
      return raiseTo(ctx, currentBet + toCall + Math.round(Math.max(bigBlind * 2, toCall * 2)))
    }
    return { type: 'call' }
  }
  // Below the price: only re-raise to bluff when it would actually work
  if (position > 0.6 && legal.canRaise) {
    const extra = toCall + Math.round(toCall * 1.5 + bigBlind)
    if (bluffProfitable(extra, potSize, foldEq)) {
      return raiseTo(ctx, currentBet + extra)
    }
  }
  return { type: 'fold' }
}

// How "draw-heavy" (wet) the board is, 0..1. Wet boards pay off to bet larger:
// they hold possible flush draws, straight draws, or multiple broadway cards
// that our made hands need to charge.
export function boardWetness(community) {
  if (community.length < 3) return 0.5
  const suits = {}
  for (const c of community) suits[c.suit] = (suits[c.suit] || 0) + 1
  const flushDraw = Math.max(...Object.values(suits)) >= 2

  const ranks = community.map((c) => c.rank).sort((a, b) => a - b)
  let straightDraw = false
  for (let i = 0; i + 2 < ranks.length; i++) {
    if (ranks[i + 2] - ranks[i] <= 4) straightDraw = true
  }
  const broadway = ranks.filter((r) => r >= 10).length >= 2

  return (flushDraw ? 0.5 : 0) + (straightDraw ? 0.3 : 0) + (broadway ? 0.2 : 0)
}

function decidePostflop(ctx) {
  const { hole, community, toCall, currentBet, potSize, legal, position, rng, equity, share, stack, foldEq } = ctx
  const outs = countOuts(hole, community)
  const price = toCall > 0 ? toCall / (potSize + toCall) : 0
  const wet = boardWetness(community)
  const spr = potSize > 0 ? stack / potSize : Number.POSITIVE_INFINITY

  const strong = equity > share + 0.25 // clearly ahead of the field
  const medium = equity > share + 0.10
  const weak = !medium

  if (toCall === 0) {
    // No bet to face — value bet, semi-bluff a draw, or check behind
    if (strong && legal.canRaise) {
      const size = 0.5 + wet * 0.3 // bigger on wet boards to deny cheap cards
      return raiseTo(ctx, currentBet + Math.round(potSize * (size + rng() * 0.1)))
    }
    if (medium && outs >= 4 && rng() < 0.5 && legal.canRaise) {
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.4 + wet * 0.2))) // semi-bluff
    }
    if (weak && position > 0.6 && legal.canRaise) {
      const bet = Math.round(potSize * (0.5 + wet * 0.2))
      if (bluffProfitable(bet, potSize, foldEq)) {
        return raiseTo(ctx, currentBet + bet) // pure bluff, only if it works
      }
    }
    return { type: 'check' }
  }

  // Facing a bet: call almost anything — fold only a clearly losing spot.
  if (equity > price - 0.06) {
    if (strong && spr < 2.5 && legal.canRaise) {
      return raiseTo(ctx, legal.raiseMax) // low stack-to-pot: get the money in
    }
    if (strong && rng() < 0.4 && legal.canRaise) {
      return raiseTo(ctx, currentBet + toCall + Math.round(potSize * (0.6 + wet * 0.2)))
    }
    return { type: 'call' }
  }

  // Below the price: still continue a halfway-decent draw — semi-bluff raise,
  // or a cheap call — instead of surrendering right away.
  if (outs >= 4) {
    const extra = toCall + Math.round(potSize * 0.6)
    if (legal.canRaise && (rng() < 0.25 || bluffProfitable(extra, potSize, foldEq))) {
      return raiseTo(ctx, currentBet + extra)
    }
    if (rng() < 0.7) return { type: 'call' }
  }
  return { type: 'fold' }
}
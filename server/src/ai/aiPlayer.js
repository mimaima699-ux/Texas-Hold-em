// Medium-strategy AI decision making.
// Input context (provided by the room layer):
//   { hole, community, toCall, currentBet, potSize, legal, position, bigBlind, rng }
// Output: { type: 'fold'|'check'|'call'|'raise', amount? }

import { preflopStrength, estimateEquity, countOuts } from './equity.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function decide(ctx) {
  const { community } = ctx
  return community.length === 0 ? decidePreflop(ctx) : decidePostflop(ctx)
}

// Build a legal raise (target total bet), clamped into [raiseMin, raiseMax]
function raiseTo(ctx, desiredTotal) {
  const { legal } = ctx
  return { type: 'raise', amount: Math.round(clamp(desiredTotal, legal.raiseMin, legal.raiseMax)) }
}

function decidePreflop(ctx) {
  const { hole, toCall, currentBet, potSize, legal, position, bigBlind, rng } = ctx
  const strength = preflopStrength(hole[0], hole[1])
  const posBonus = position * 0.12

  if (toCall === 0) {
    // No bet to call, checking is free
    if (strength > 0.55 + posBonus && legal.canRaise) {
      const total = currentBet + Math.round(bigBlind * (2.5 + rng() * 0.5))
      return raiseTo(ctx, total)
    }
    if (strength > 0.42 + posBonus && rng() < 0.12 && legal.canRaise) {
      return raiseTo(ctx, currentBet + Math.round(bigBlind * 2.5))
    }
    return { type: 'check' }
  }

  // Facing a bet
  const required = 0.4 - posBonus // hand strength threshold to call
  if (strength > required + 0.25 && legal.canRaise) {
    // Strong hand: 3-bet
    return raiseTo(ctx, currentBet + toCall + Math.round(Math.max(bigBlind * 2, toCall * 2)))
  }
  if (strength > required) {
    return { type: 'call' }
  }
  // Weak hand: occasionally bluff from late position
  if (position > 0.6 && rng() < 0.06 && legal.canRaise) {
    return raiseTo(ctx, currentBet + toCall + Math.round(toCall * 1.5 + bigBlind))
  }
  return { type: 'fold' }
}

function decidePostflop(ctx) {
  const { hole, community, toCall, currentBet, potSize, legal, position, rng } = ctx
  const equity = estimateEquity(hole, community)
  const outs = countOuts(hole, community)
  const potOdds = toCall > 0 ? toCall / (potSize + toCall) : 0

  const strong = equity > 0.62
  const medium = equity >= 0.4
  const weak = equity < 0.4

  if (toCall === 0) {
    if (strong && legal.canRaise) {
      // Value bet 60~75% of the pot
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.6 + rng() * 0.15)))
    }
    if (medium && outs >= 4 && rng() < 0.5 && legal.canRaise) {
      // Semi-bluff (medium made hand + draw)
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.16)))
    }
    if (weak && position > 0.6 && rng() < 0.1 && legal.canRaise) {
      // Pure bluff
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.25)))
    }
    return { type: 'check' }
  }

  if (potOdds < equity) {
    // Favorable odds, worth continuing
    if (strong && rng() < 0.4 && legal.canRaise) {
      return raiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
    }
    return { type: 'call' }
  }

  // Unfavorable odds
  if (outs >= 8 && rng() < 0.2 && legal.canRaise) {
    // Strong draw: occasionally raise as a semi-bluff
    return raiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
  }
  return { type: 'fold' }
}

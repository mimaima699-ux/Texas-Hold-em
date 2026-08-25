// 中等策略 AI 决策。
// 输入上下文（由房间层提供）：
//   { hole, community, toCall, currentBet, potSize, legal, position, bigBlind, rng }
// 输出：{ type: 'fold'|'check'|'call'|'raise', amount? }

import { preflopStrength, estimateEquity, countOuts } from './equity.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function decide(ctx) {
  const { community } = ctx
  return community.length === 0 ? decidePreflop(ctx) : decidePostflop(ctx)
}

// 构造一个合法的加注（目标总下注额），夹在 [raiseMin, raiseMax] 之间
function raiseTo(ctx, desiredTotal) {
  const { legal } = ctx
  return { type: 'raise', amount: Math.round(clamp(desiredTotal, legal.raiseMin, legal.raiseMax)) }
}

function decidePreflop(ctx) {
  const { hole, toCall, currentBet, potSize, legal, position, bigBlind, rng } = ctx
  const strength = preflopStrength(hole[0], hole[1])
  const posBonus = position * 0.12

  if (toCall === 0) {
    // 无人下注，可以过牌
    if (strength > 0.55 + posBonus && legal.canRaise) {
      const total = currentBet + Math.round(bigBlind * (2.5 + rng() * 0.5))
      return raiseTo(ctx, total)
    }
    if (strength > 0.42 + posBonus && rng() < 0.12 && legal.canRaise) {
      return raiseTo(ctx, currentBet + Math.round(bigBlind * 2.5))
    }
    return { type: 'check' }
  }

  // 需要跟注
  const required = 0.4 - posBonus // 跟注所需手牌强度阈值
  if (strength > required + 0.25 && legal.canRaise) {
    // 强牌 3-bet
    return raiseTo(ctx, currentBet + toCall + Math.round(Math.max(bigBlind * 2, toCall * 2)))
  }
  if (strength > required) {
    return { type: 'call' }
  }
  // 弱牌，位置好时偶尔诈唬
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
      // 价值下注 60~75% 底池
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.6 + rng() * 0.15)))
    }
    if (medium && outs >= 4 && rng() < 0.5 && legal.canRaise) {
      // 半诈唬（成牌中等 + 听牌）
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.16)))
    }
    if (weak && position > 0.6 && rng() < 0.1 && legal.canRaise) {
      // 纯诈唬
      return raiseTo(ctx, currentBet + Math.round(potSize * (0.5 + rng() * 0.25)))
    }
    return { type: 'check' }
  }

  if (potOdds < equity) {
    // 赔率合适，值得继续
    if (strong && rng() < 0.4 && legal.canRaise) {
      return raiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
    }
    return { type: 'call' }
  }

  // 赔率不合适
  if (outs >= 8 && rng() < 0.2 && legal.canRaise) {
    // 强听牌偶尔半诈唬加注
    return raiseTo(ctx, currentBet + toCall + Math.round(potSize * 0.6))
  }
  return { type: 'fold' }
}

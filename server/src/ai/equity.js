// AI 用到的牌力 / 胜率 / 听牌估算（近似，非精确蒙特卡洛）。

import { evaluate, CATEGORY } from '../game/handEvaluator.js'

// 起手牌强度（0~1），粗略版
export function preflopStrength(c1, c2) {
  const r1 = c1.rank
  const r2 = c2.rank
  const suited = c1.suit === c2.suit
  const high = Math.max(r1, r2)
  const low = Math.min(r1, r2)

  let s
  if (r1 === r2) {
    // 对子：22=0.6 → AA=0.98
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

// 已成型牌型的基准胜率（近似）
const CATEGORY_BASE = {
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

// 估算听牌 outs（同花听 + 顺子听）
export function countOuts(hole, community) {
  const cards = [...hole, ...community]
  if (community.length === 0) return 0

  const ranks = new Set(cards.map((c) => c.rank))
  let outs = 0

  // 同花听：某花色恰好 4 张 → 剩 9 张
  const suitCounts = {}
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1
  if (Object.values(suitCounts).some((n) => n === 4)) outs += 9

  // 顺子听：枚举所有可能顺子的高点，缺 1 张即为听牌
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

// 估算当前胜率（0~1）
export function estimateEquity(hole, community) {
  const cards = [...hole, ...community]
  if (community.length === 0) return preflopStrength(hole[0], hole[1])

  const ev = evaluate(cards)
  const base = CATEGORY_BASE[ev.category] ?? 0.05
  const tieAdj = ((ev.tiebreak[0] ?? 0) / 14) * 0.03
  const outs = countOuts(hole, community)
  const cardsToCome = 5 - community.length
  const drawEq = outs * (cardsToCome >= 2 ? 0.04 : 0.02)
  return Math.min(0.98, base + tieAdj + drawEq)
}

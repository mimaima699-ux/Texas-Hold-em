// 手牌评估器：给定 5~7 张牌，返回最优 5 张牌型。
// 返回值 { score, category, tiebreak, name }，score 为可比较整数，越大越强。

// 牌型类别（由低到高）
export const CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
}

export const CATEGORY_NAMES = {
  [CATEGORY.HIGH_CARD]: '高牌',
  [CATEGORY.ONE_PAIR]: '一对',
  [CATEGORY.TWO_PAIR]: '两对',
  [CATEGORY.THREE_OF_A_KIND]: '三条',
  [CATEGORY.STRAIGHT]: '顺子',
  [CATEGORY.FLUSH]: '同花',
  [CATEGORY.FULL_HOUSE]: '葫芦',
  [CATEGORY.FOUR_OF_A_KIND]: '四条',
  [CATEGORY.STRAIGHT_FLUSH]: '同花顺',
}

// 判断一组（去重后的）点数是否能组成顺子；返回顺子的最大点数，或 null。
// 特殊处理 A-2-3-4-5（wheel），此时顺子高点为 5。
function straightHigh(uniqueRanksDesc) {
  if (uniqueRanksDesc.length < 5) return null
  // 普通顺子：首尾相差 4
  if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) return uniqueRanksDesc[0]
  // wheel: A(14)-5-4-3-2
  if (
    uniqueRanksDesc[0] === 14 &&
    uniqueRanksDesc[1] === 5 &&
    uniqueRanksDesc[2] === 4 &&
    uniqueRanksDesc[3] === 3 &&
    uniqueRanksDesc[4] === 2
  ) {
    return 5
  }
  return null
}

// 评估恰好 5 张牌
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a)
  const suits = cards.map((c) => c.suit)
  const isFlush = suits.every((s) => s === suits[0])

  // 统计点数出现次数
  const counts = new Map()
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1)
  // 按（次数降序，点数降序）排列分组
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  const uniqueDesc = [...new Set(ranks)]
  const straight = straightHigh(uniqueDesc)

  let category
  let tiebreak

  if (isFlush && straight !== null) {
    category = CATEGORY.STRAIGHT_FLUSH
    tiebreak = [straight]
  } else if (groups[0][1] === 4) {
    category = CATEGORY.FOUR_OF_A_KIND
    tiebreak = [groups[0][0], groups[1][0]]
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = CATEGORY.FULL_HOUSE
    tiebreak = [groups[0][0], groups[1][0]]
  } else if (isFlush) {
    category = CATEGORY.FLUSH
    tiebreak = ranks.slice()
  } else if (straight !== null) {
    category = CATEGORY.STRAIGHT
    tiebreak = [straight]
  } else if (groups[0][1] === 3) {
    category = CATEGORY.THREE_OF_A_KIND
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]]
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = CATEGORY.TWO_PAIR
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]]
  } else if (groups[0][1] === 2) {
    category = CATEGORY.ONE_PAIR
    tiebreak = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]
  } else {
    category = CATEGORY.HIGH_CARD
    tiebreak = ranks.slice()
  }

  // 编码为可比较整数：category 占最高位，其后依次 5 个 kicker（基数 15 足够容纳 2..14）
  let score = category
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (tiebreak[i] ?? 0)
  }

  const name =
    category === CATEGORY.STRAIGHT_FLUSH && straight === 14
      ? '皇家同花顺'
      : CATEGORY_NAMES[category]

  return { score, category, tiebreak, name }
}

// 枚举 C(n, 5) 组合
function combinations(arr, k) {
  const result = []
  const n = arr.length
  if (n < k) return result
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    result.push(idx.map((i) => arr[i]))
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) break
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
  return result
}

// 评估 5~7 张牌，返回最优 5 张牌型
export function evaluate(cards) {
  if (cards.length === 5) return evaluate5(cards)
  const combos = combinations(cards, 5)
  let best = null
  for (const combo of combos) {
    const r = evaluate5(combo)
    if (!best || r.score > best.score) best = r
  }
  return best
}

// 比较两副牌（各自 5~7 张），返回负数/0/正数
export function compare(a, b) {
  return evaluate(a).score - evaluate(b).score
}

// Hand evaluator: given 5~7 cards, returns the best 5-card hand.
// Returns { score, category, tiebreak, name }; score is a comparable integer, higher is stronger.

// Hand categories (low to high)
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
  [CATEGORY.HIGH_CARD]: 'High Card',
  [CATEGORY.ONE_PAIR]: 'One Pair',
  [CATEGORY.TWO_PAIR]: 'Two Pair',
  [CATEGORY.THREE_OF_A_KIND]: 'Three of a Kind',
  [CATEGORY.STRAIGHT]: 'Straight',
  [CATEGORY.FLUSH]: 'Flush',
  [CATEGORY.FULL_HOUSE]: 'Full House',
  [CATEGORY.FOUR_OF_A_KIND]: 'Four of a Kind',
  [CATEGORY.STRAIGHT_FLUSH]: 'Straight Flush',
}

// Decide whether a set of (deduplicated) ranks forms a straight; returns the
// straight's high rank, or null. Handles the special A-2-3-4-5 wheel (high rank 5).
function straightHigh(uniqueRanksDesc) {
  if (uniqueRanksDesc.length < 5) return null
  // Regular straight: first and last differ by 4
  if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) return uniqueRanksDesc[0]
  // Wheel: A(14)-5-4-3-2
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

// Evaluate exactly 5 cards
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a)
  const suits = cards.map((c) => c.suit)
  const isFlush = suits.every((s) => s === suits[0])

  // Count rank occurrences
  const counts = new Map()
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1)
  // Sort groups by (count desc, rank desc)
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

  // Encode as a comparable integer: category takes the highest position,
  // followed by 5 kickers (base 15 is enough for ranks 2..14)
  let score = category
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (tiebreak[i] ?? 0)
  }

  const name =
    category === CATEGORY.STRAIGHT_FLUSH && straight === 14
      ? 'Royal Flush'
      : CATEGORY_NAMES[category]

  return { score, category, tiebreak, name }
}

// Enumerate C(n, 5) combinations
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

// Evaluate 5~7 cards and return the best 5-card hand
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

// Compare two hands (each 5~7 cards); returns negative/zero/positive
export function compare(a, b) {
  return evaluate(a).score - evaluate(b).score
}

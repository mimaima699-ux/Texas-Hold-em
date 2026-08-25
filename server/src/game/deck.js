// 牌与牌堆。牌用对象 { rank, suit } 表示：
// rank: 2..14（11=J 12=Q 13=K 14=A），suit: 'c'|'d'|'h'|'s'

export const SUITS = ['c', 'd', 'h', 's']
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const SUIT_LABEL = { c: '♣', d: '♦', h: '♥', s: '♠' }
const SUIT_COLOR = { c: 'black', d: 'red', h: 'red', s: 'black' }

export function createDeck() {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

// Fisher–Yates 洗牌；rng 可注入以便测试
export function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function cardLabel(card) {
  if (!card) return ''
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_LABEL[card.suit] ?? card.suit}`
}

export function cardColor(card) {
  return SUIT_COLOR[card.suit] ?? 'black'
}

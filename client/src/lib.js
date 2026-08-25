// Shared client utilities: card display, avatars, countdown, table layout.

export const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
export const SUIT_LABEL = { c: '♣', d: '♦', h: '♥', s: '♠' }

export function isRedSuit(suit) {
  return suit === 'd' || suit === 'h'
}

export function rankText(rank) {
  return String(RANK_LABEL[rank] ?? rank)
}

const AVATARS = ['🐺', '🦊', '🐻', '🐼', '🦁', '🐸', '🦉', '🐵', '🐯', '🐰', '🦝', '🐨', '🐗', '🦔']

export function avatarFor(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}

export const PHASE_NAMES = {
  waiting: 'Waiting',
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  handEnd: 'Results',
}

// Table layout: n seats evenly distributed around an ellipse, starting at the
// bottom and going clockwise. Returns each seat's {x, y} (percent) plus the
// bet-chip position toward the center {bx, by}.
export function tableLayout(n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n // y axis points down; subtracting goes clockwise
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    pts.push({
      x: 50 + 45 * cos,
      y: 50 + 43 * sin,
      bx: 50 + 24 * cos,
      by: 50 + 24 * sin,
      dx: 50 + 32 * cos, // dealer button position
      dy: 50 + 33 * sin,
    })
  }
  return pts
}

// Estimate server/local clock offset for countdowns
let clockSkew = 0
export function syncClock(serverTime) {
  if (typeof serverTime === 'number') clockSkew = serverTime - Date.now()
}
export function now() {
  return Date.now() + clockSkew
}

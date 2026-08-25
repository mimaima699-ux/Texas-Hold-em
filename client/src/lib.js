// 前端共享工具：牌面显示、头像、倒计时等。

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
  waiting: '等待中',
  preflop: '翻牌前',
  flop: '翻牌圈',
  turn: '转牌圈',
  river: '河牌圈',
  showdown: '摊牌',
  handEnd: '结算',
}

// 桌面布局：n 个座位从正下方开始顺时针均匀分布在椭圆上。
// 返回每人的 {x, y}（百分比）以及朝向中心的下注筹码位置 {bx, by}。
export function tableLayout(n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n // y 轴向下，减角为顺时针
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    pts.push({
      x: 50 + 45 * cos,
      y: 50 + 43 * sin,
      bx: 50 + 24 * cos,
      by: 50 + 24 * sin,
      dx: 50 + 32 * cos, // 庄家按钮位置
      dy: 50 + 33 * sin,
    })
  }
  return pts
}

// 估算服务器与本地时钟偏移，用于倒计时
let clockSkew = 0
export function syncClock(serverTime) {
  if (typeof serverTime === 'number') clockSkew = serverTime - Date.now()
}
export function now() {
  return Date.now() + clockSkew
}

// 底池与边池计算。
// 输入 entries：每名玩家本手投入与摊牌信息
//   { playerId, committed, folded, handScore }
// 输出：拆分的池子、以及每名玩家应赢得的筹码。

export function totalPot(entries) {
  return entries.reduce((sum, e) => sum + (e.committed || 0), 0)
}

// 按投入层级拆出主池 + 各边池，并把每层分给摊牌胜者（平局均分，余数给行动更早者）。
export function awardPots(entries) {
  const pots = []
  const awards = {}

  const contenders = entries.filter((e) => e.committed > 0)
  const levels = [...new Set(contenders.map((e) => e.committed))].sort((a, b) => a - b)

  let prev = 0
  for (const level of levels) {
    const eligible = contenders.filter((e) => e.committed >= level)
    const slice = (level - prev) * eligible.length
    prev = level
    if (slice <= 0) continue

    const nonFolded = eligible.filter((e) => !e.folded)
    let winners
    if (nonFolded.length === 1) {
      winners = [nonFolded[0].playerId]
    } else if (nonFolded.length === 0) {
      // 理论上不会发生（总有至少一人未弃牌拿池），兜底跳过
      pots.push({ amount: slice, winners: [] })
      continue
    } else {
      const best = Math.max(...nonFolded.map((e) => e.handScore ?? -1))
      winners = nonFolded
        .filter((e) => (e.handScore ?? -1) === best)
        .map((e) => e.playerId)
    }

    pots.push({ amount: slice, winners })

    const share = Math.floor(slice / winners.length)
    for (const w of winners) awards[w] = (awards[w] || 0) + share
    // 余数（1~2 筹码）给第一个胜者
    const remainder = slice - share * winners.length
    if (remainder > 0 && winners.length > 0) awards[winners[0]] += remainder
  }

  return { pots, awards }
}

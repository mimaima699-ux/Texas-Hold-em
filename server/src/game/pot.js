// Pot and side pot calculation.
// Input entries: each player's total investment this hand plus showdown info
//   { playerId, committed, folded, handScore }
// Output: the split pots, and the chips each player should be awarded.

export function totalPot(entries) {
  return entries.reduce((sum, e) => sum + (e.committed || 0), 0)
}

// Split into main pot + side pots by commitment level, award each level to its
// showdown winner (ties split evenly, remainder goes to the first winner).
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
      // Should not happen (someone unfolded always takes the pot); skip as fallback
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
    // Remainder (1~2 chips) goes to the first winner
    const remainder = slice - share * winners.length
    if (remainder > 0 && winners.length > 0) awards[winners[0]] += remainder
  }

  return { pots, awards }
}

import { describe, it, expect } from 'vitest'
import { awardPots, totalPot } from '../src/game/pot.js'

describe('pot / side pot', () => {
  it('简单摊牌：两人等额投入，胜者赢得全部', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 500 },
      { playerId: 'b', committed: 100, folded: false, handScore: 300 },
    ]
    const { pots, awards } = awardPots(entries)
    expect(totalPot(entries)).toBe(200)
    expect(awards.a).toBe(200)
    expect(awards.b).toBeUndefined()
  })

  it('全下边池：短码玩家只赢主池，剩余归深码胜者', () => {
    const entries = [
      { playerId: 'short', committed: 50, folded: false, handScore: 900 }, // 全下 50，牌最强
      { playerId: 'deep1', committed: 200, folded: false, handScore: 700 },
      { playerId: 'deep2', committed: 200, folded: false, handScore: 100 },
    ]
    const { pots, awards } = awardPots(entries)
    // 主池：50 * 3 = 150，short 赢
    // 边池：(200-50) * 2 = 300，deep1 赢
    expect(awards.short).toBe(150)
    expect(awards.deep1).toBe(300)
    expect(awards.deep2).toBeUndefined()
  })

  it('平局平分：两人同分均分底池', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 400 },
      { playerId: 'b', committed: 100, folded: false, handScore: 400 },
    ]
    const { awards } = awardPots(entries)
    expect(awards.a).toBe(100)
    expect(awards.b).toBe(100)
  })

  it('奇数底池平分：余数给第一位胜者', () => {
    const entries = [
      { playerId: 'a', committed: 5, folded: false, handScore: 400 },
      { playerId: 'b', committed: 5, folded: false, handScore: 400 },
    ]
    const { awards } = awardPots(entries)
    expect(awards.a + awards.b).toBe(10)
    expect(awards.a).toBe(5) // 余 0
    // 奇数场景：总池 11，无法等分
    const entries2 = [
      { playerId: 'a', committed: 3, folded: false, handScore: 400 },
      { playerId: 'b', committed: 4, folded: false, handScore: 400 },
      { playerId: 'c', committed: 4, folded: true, handScore: null },
    ]
    // 层级 3：3*3=9 池；层级 4：(4-3)*2=2 池，共 11
    const r2 = awardPots(entries2)
    expect(r2.awards.a + r2.awards.b).toBe(11)
  })

  it('弃牌者投入成为死钱，不参与分池', () => {
    const entries = [
      { playerId: 'a', committed: 100, folded: false, handScore: 100 },
      { playerId: 'b', committed: 100, folded: false, handScore: 200 },
      { playerId: 'c', committed: 60, folded: true, handScore: null },
    ]
    const { awards } = awardPots(entries)
    expect(awards.b).toBe(260) // 全部底池，含 c 的死钱
    expect(awards.a).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { PokerGame } from '../src/game/gameEngine.js'

function makePlayers(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    seat: i,
    name: `玩家${i}`,
    chips: 1000,
    isBot: false,
  }))
}

function play(game, type, amount) {
  const r = game.act(game.currentActor.id, { type, amount })
  return r
}

describe('PokerGame', () => {
  it('正确下盲注并确定行动顺序（3 人局）', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()

    expect(game.phase).toBe('preflop')
    // 庄家 seat0，小盲 seat1，大盲 seat2，枪口（先行动）seat0
    expect(game.players[1].bet).toBe(5)
    expect(game.players[2].bet).toBe(10)
    expect(game.streetBet).toBe(10)
    expect(game.currentActor.id).toBe('p0')

    const legal = game.getLegalActions('p0')
    expect(legal.toCall).toBe(10)
    expect(legal.canCall).toBe(true)
    expect(legal.canRaise).toBe(true)
  })

  it('全员弃牌时，最后一人直接赢得底池', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()
    play(game, 'fold') // p0 弃牌
    play(game, 'fold') // p1（小盲）弃牌
    expect(game.phase).toBe('handEnd')
    expect(game.lastResult.uncontested).toBe(true)
    expect(game.lastResult.winners[0].id).toBe('p2')
    expect(game.lastResult.awards.p2).toBe(15) // 5 + 10 盲注
  })

  it('全程过牌到摊牌，筹码守恒且底池正确分配', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()

    // 翻牌前：p0 跟注，p1 补盲，p2 过牌
    play(game, 'call')
    play(game, 'call')
    play(game, 'check')
    expect(game.phase).toBe('flop')

    // 翻牌后首个行动者是庄家左侧（p1）
    expect(game.currentActor.id).toBe('p1')

    // 翻牌/转牌/河牌全部过牌
    for (let i = 0; i < 3; i++) {
      play(game, 'check')
      play(game, 'check')
      play(game, 'check')
    }
    expect(game.phase).toBe('handEnd')

    const totalCommitted = game.players.reduce((s, p) => s + p.committed, 0)
    expect(totalCommitted).toBe(30)

    const totalAwarded = Object.values(game.lastResult.awards).reduce((s, v) => s + v, 0)
    expect(totalAwarded).toBe(30)

    // 总筹码守恒
    const totalChips = game.players.reduce((s, p) => s + p.chips, 0)
    expect(totalChips).toBe(3000)
  })

  it('加注后重新开启行动，最小加注校验生效', () => {
    const game = new PokerGame({ players: makePlayers(3), smallBlind: 5, bigBlind: 10 })
    game.startHand()
    // p0 加注到 30
    play(game, 'raise', 30)
    expect(game.players[0].bet).toBe(30)
    expect(game.streetBet).toBe(30)
    // 非法加注（低于最小加注）应被拒绝
    const r = game.act(game.currentActor.id, { type: 'raise', amount: 35 })
    expect(r.ok).toBe(false)
  })

  it('短码全下产生边池且正确分配', () => {
    const players = [
      { id: 'short', seat: 0, name: '短码', chips: 15, isBot: false },
      { id: 'deep1', seat: 1, name: '深码1', chips: 1000, isBot: false },
      { id: 'deep2', seat: 2, name: '深码2', chips: 1000, isBot: false },
    ]
    const game = new PokerGame({ players, smallBlind: 5, bigBlind: 10 })
    game.startHand()

    // 让短码全下、两个深码跟注，然后一路过牌到摊牌
    // 庄家 seat0(short)，SB seat1，BB seat2，先行动 seat0(short)
    play(game, 'raise', 15) // short 全下到 15
    // seat1 跟注到 15
    play(game, 'call')
    // seat2 跟注到 15（BB 已下 10，再补 5）
    play(game, 'call')
    expect(game.phase).toBe('flop')

    // 两个深码一路过牌
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    play(game, 'check')
    expect(game.phase).toBe('handEnd')

    // 主池 15*3=45，边池 0（三人等额），全部底池 45 只被一人拿走
    const totalAwarded = Object.values(game.lastResult.awards).reduce((s, v) => s + v, 0)
    expect(totalAwarded).toBe(45)
  })

  it('双方翻牌前即全下时自动发完公共牌摊牌（不卡死）', () => {
    const game = new PokerGame({
      players: [
        { id: 'a', seat: 0, name: '甲', chips: 1000, isBot: false },
        { id: 'b', seat: 1, name: '乙', chips: 1000, isBot: false },
      ],
      smallBlind: 5,
      bigBlind: 10,
    })
    game.startHand()
    // 单挑：庄家(甲)即小盲。甲全下，乙跟注全下 → 无人能行动，直接发完牌
    play(game, 'raise', 1000)
    play(game, 'call')
    expect(game.phase).toBe('handEnd')
    expect(game.community.length).toBe(5)
    // 筹码守恒
    expect(game.players.reduce((s, p) => s + p.chips, 0)).toBe(2000)
    expect(game.lastResult.reveal.length).toBe(2)
  })

  it('多人局其余人全下后不能加注，只能跟注或弃牌', () => {
    const players = [
      { id: 'p0', seat: 0, name: '甲', chips: 500, isBot: false },
      { id: 'p1', seat: 1, name: '乙', chips: 500, isBot: false },
      { id: 'p2', seat: 2, name: '丙', chips: 500, isBot: false },
    ]
    const game = new PokerGame({ players, smallBlind: 5, bigBlind: 10 })
    game.startHand()
    play(game, 'raise', 500) // p0 全下
    play(game, 'call') // p1 全下跟注
    // 只剩 p2，对手全部全下 → 不能加注
    const legal = game.getLegalActions('p2')
    expect(legal.canRaise).toBe(false)
    expect(legal.canCall).toBe(true)
    play(game, 'call') // p2 也全下跟注
    // 三人全下 → 自动发完公共牌摊牌
    expect(game.phase).toBe('handEnd')
    expect(game.community.length).toBe(5)
  })

  it('initialDealerIndex 指定首手庄家', () => {
    const game = new PokerGame({
      players: makePlayers(3),
      smallBlind: 5,
      bigBlind: 10,
      initialDealerIndex: 2,
    })
    game.startHand()
    expect(game.players[game.dealerIndex].id).toBe('p2')
    // 庄家 seat2 → 小盲 seat0，大盲 seat1，翻牌前先行动 seat2
    expect(game.players[0].bet).toBe(5)
    expect(game.players[1].bet).toBe(10)
    expect(game.currentActor.id).toBe('p2')
  })
})

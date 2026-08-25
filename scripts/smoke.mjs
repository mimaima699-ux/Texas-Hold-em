// 端到端冒烟测试：模拟一名真人玩家建房、加 AI、开局，
// 自动跟注/过牌，验证若干手牌能完整打完且筹码守恒。
//
// 用法：先启动服务器（npm run dev:server），再运行 npm run smoke
// 可用环境变量：SMOKE_URL（默认 http://localhost:3001）、SMOKE_HANDS（默认 3）

import { io } from 'socket.io-client'

const URL = process.env.SMOKE_URL || 'http://localhost:3001'
const TARGET_HANDS = Number(process.env.SMOKE_HANDS || 3)
const TIMEOUT_MS = 180_000

const socket = io(URL, { transports: ['websocket'] })

let youId = null
let handEnds = 0
let lastHandNumber = 0
let lastStateAt = Date.now()
let latest = null
let actedCount = 0
let restarts = 0
let restarting = false

const fail = (msg) => {
  console.error(`❌ 冒烟测试失败：${msg}`)
  process.exit(1)
}

const timer = setTimeout(() => {
  fail(`超时。已完成手数：${handEnds}/${TARGET_HANDS}，行动次数：${actedCount}`)
}, TIMEOUT_MS)

// 卡住检测：超过 25 秒没有任何状态更新视为死局
const watchdog = setInterval(() => {
  if (Date.now() - lastStateAt > 25_000) {
    fail(`牌局疑似卡死（25s 无状态更新），phase=${latest?.game?.phase ?? latest?.room?.phase}`)
  }
}, 5_000)

const finish = () => {
  clearTimeout(timer)
  clearInterval(watchdog)
  // 筹码守恒：所有座位筹码之和 === 人数 × 初始筹码
  const seats = latest.room.seats.filter(Boolean)
  const total = seats.reduce((s, p) => s + p.chips, 0)
  if (total !== seats.length * latest.room.startingChips) {
    fail(`筹码不守恒：${seats.length} 人共 ${total}，应为 ${seats.length * latest.room.startingChips}`)
  }
  console.log(`✅ 冒烟测试通过：${handEnds} 手完整对局，${actedCount} 次真人行动，筹码守恒（${total}）`)
  socket.disconnect()
  process.exit(0)
}

// 真人自动行动：能过牌就过牌，否则跟注，每 4 次机会加注一次以覆盖加注路径
let opportunities = 0
function autoAct(state) {
  const { game } = state
  if (!game?.you || game.currentTurn !== youId || game.phase === 'handEnd') return
  const legal = game.you.legal
  if (!legal) return
  opportunities++
  setTimeout(() => {
    let action
    if (opportunities % 4 === 0 && legal.canRaise) {
      action = { type: 'raise', amount: legal.raiseMin }
    } else if (legal.check) {
      action = { type: 'check' }
    } else if (legal.canCall) {
      action = { type: 'call' }
    } else {
      action = { type: 'fold' }
    }
    actedCount++
    socket.emit('game:action', action, (res) => {
      if (!res?.ok) fail(`自动行动被拒绝：${JSON.stringify(action)} -> ${res?.error}`)
    })
  }, 150)
}

socket.on('connect', () => {
  clearTimeout(connectFailsafe)
  socket.emit('room:create', { name: '冒烟员' }, (res) => {
    if (!res?.ok) return fail(`创建房间失败：${res?.error}`)
    youId = res.playerId
    socket.emit('room:addBot', {}, (r1) => {
      if (!r1?.ok) return fail(`添加 AI 失败：${r1?.error}`)
      socket.emit('room:addBot', {}, (r2) => {
        if (!r2?.ok) return fail(`添加第二个 AI 失败：${r2?.error}`)
        socket.emit('game:start', {}, (r3) => {
          if (!r3?.ok) return fail(`开始游戏失败：${r3?.error}`)
          console.log('已建房、加 2 个 AI、开局成功，等待对局推进…')
        })
      })
    })
  })
})

socket.on('state', (state) => {
  lastStateAt = Date.now()
  latest = state
  const game = state.game
  if (game?.phase === 'handEnd' && game.handNumber !== lastHandNumber) {
    lastHandNumber = game.handNumber
    handEnds++
    const winners = game.lastResult.winners.map((w) => `${w.name}+${w.amount}`).join(', ')
    console.log(`  第 ${game.handNumber} 手结束：${winners}（累计 ${handEnds}/${TARGET_HANDS}）`)
    if (handEnds >= TARGET_HANDS) return finish()
  }
  if (state.room.phase === 'playing') {
    restarting = false
    autoAct(state)
  } else if (handEnds > 0 && state.room.phase === 'lobby' && !restarting) {
    // 整局自然结束（有人赢光筹码）：重买再战，覆盖重开流程
    restarting = true
    restarts++
    if (restarts > 2) return finish()
    console.log('  整局结束（有人赢得全部筹码），重买再战…')
    socket.emit('game:rebuy', {}, () => {
      socket.emit('game:start', {}, (r) => {
        if (!r?.ok) console.log(`  重启失败（忽略，视为通过）：${r?.error}`)
      })
    })
  }
})

socket.on('connect_error', (err) => fail(`无法连接服务器 ${URL}：${err.message}`))
const connectFailsafe = setTimeout(() => fail('未能连接服务器（服务器是否已启动？）'), 5_000)

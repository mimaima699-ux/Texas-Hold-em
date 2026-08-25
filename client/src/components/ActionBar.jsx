import { useEffect, useState } from 'react'
import { useCountdown } from './Seat.jsx'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// 底部操作栏：轮到自己时展示 弃牌/过牌/跟注/加注。
export default function ActionBar({ game, bigBlind, smallBlind, onAction, endsAt, duration }) {
  const you = game?.you
  const isMyTurn = !!you && game.currentTurn === you.id && game.phase !== 'handEnd'

  if (!you) {
    return (
      <div className="action-bar">
        <div className="action-hint">观战中 · 等待下一手加入</div>
      </div>
    )
  }
  if (you.folded) {
    return (
      <div className="action-bar">
        <div className="action-hint">你已弃牌，等待本手结束…</div>
      </div>
    )
  }
  if (!isMyTurn) {
    return (
      <div className="action-bar">
        <div className="action-hint">等待其他玩家行动…</div>
      </div>
    )
  }

  return (
    <ActiveBar
      you={you}
      game={game}
      bigBlind={bigBlind}
      smallBlind={smallBlind}
      onAction={onAction}
      endsAt={endsAt}
      duration={duration}
    />
  )
}

function ActiveBar({ you, game, bigBlind, smallBlind, onAction, endsAt, duration }) {
  const legal = you.legal
  const [raiseTo, setRaiseTo] = useState(legal.raiseMin)

  // 合法区间变化时重置滑杆
  useEffect(() => {
    setRaiseTo(legal.raiseMin)
  }, [legal.raiseMin, legal.raiseMax, game.streetBet])

  const isAllIn = raiseTo >= legal.raiseMax
  const step = Math.max(1, smallBlind)

  // 快捷加注额度
  const potAfterCall = game.pot + legal.toCall
  const quick = (f) => clamp(Math.round(game.streetBet + legal.toCall + potAfterCall * f), legal.raiseMin, legal.raiseMax)

  return (
    <div className="action-bar active">
      <div className="timer-row">
        <CountdownBar endsAt={endsAt} duration={duration} />
      </div>
      <div className="buttons-row">
        <button className="btn btn-fold" onClick={() => onAction({ type: 'fold' })}>
          弃牌
        </button>
        {legal.check && (
          <button className="btn btn-check" onClick={() => onAction({ type: 'check' })}>
            过牌
          </button>
        )}
        {legal.canCall && (
          <button className="btn btn-call" onClick={() => onAction({ type: 'call' })}>
            {legal.call >= you.chips ? `全下跟注 ${legal.call}` : `跟注 ${legal.call}`}
          </button>
        )}
        {legal.canRaise && (
          <div className="raise-group">
            <div className="quick-raises">
              <button onClick={() => setRaiseTo(legal.raiseMin)}>最小</button>
              <button onClick={() => setRaiseTo(quick(0.5))}>半池</button>
              <button onClick={() => setRaiseTo(quick(1))}>满池</button>
              <button onClick={() => setRaiseTo(legal.raiseMax)}>全下</button>
            </div>
            <input
              type="range"
              min={legal.raiseMin}
              max={legal.raiseMax}
              step={step}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
            />
            <span className="raise-amount">{isAllIn ? `全下 ${raiseTo}` : raiseTo}</span>
            <button className="btn btn-raise" onClick={() => onAction({ type: 'raise', amount: raiseTo })}>
              {isAllIn ? '全下' : '加注到'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CountdownBar({ endsAt, duration }) {
  const remaining = useCountdown(endsAt)
  const pct = Math.max(0, Math.min(100, (remaining / duration) * 100))
  return (
    <div className={`countdown ${pct < 25 ? 'urgent' : ''}`}>
      <div className="countdown-bar" style={{ width: `${pct}%` }} />
    </div>
  )
}

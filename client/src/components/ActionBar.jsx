import { useEffect, useState } from 'react'
import { useCountdown } from './Seat.jsx'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Bottom action bar: shows Fold/Check/Call/Raise when it's your turn.
export default function ActionBar({ game, bigBlind, smallBlind, onAction, endsAt, duration }) {
  const you = game?.you
  const isMyTurn = !!you && game.currentTurn === you.id && game.phase !== 'handEnd'

  if (!you) {
    return (
      <div className="action-bar">
        <div className="action-hint">Spectating · joining next hand</div>
      </div>
    )
  }
  if (you.folded) {
    return (
      <div className="action-bar">
        <div className="action-hint">You folded — waiting for this hand to end…</div>
      </div>
    )
  }
  if (!isMyTurn) {
    return (
      <div className="action-bar">
        <div className="action-hint">Waiting for other players…</div>
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

  // Reset the slider when the legal range changes
  useEffect(() => {
    setRaiseTo(legal.raiseMin)
  }, [legal.raiseMin, legal.raiseMax, game.streetBet])

  const isAllIn = raiseTo >= legal.raiseMax
  const step = Math.max(1, smallBlind)

  // Quick raise sizes
  const potAfterCall = game.pot + legal.toCall
  const quick = (f) => clamp(Math.round(game.streetBet + legal.toCall + potAfterCall * f), legal.raiseMin, legal.raiseMax)

  return (
    <div className="action-bar active">
      <div className="timer-row">
        <CountdownBar endsAt={endsAt} duration={duration} />
      </div>
      <div className="buttons-row">
        <button className="btn btn-fold" onClick={() => onAction({ type: 'fold' })}>
          Fold
        </button>
        {legal.check && (
          <button className="btn btn-check" onClick={() => onAction({ type: 'check' })}>
            Check
          </button>
        )}
        {legal.canCall && (
          <button className="btn btn-call" onClick={() => onAction({ type: 'call' })}>
            {legal.call >= you.chips ? `Call all-in ${legal.call}` : `Call ${legal.call}`}
          </button>
        )}
        {legal.canRaise && (
          <div className="raise-group">
            <div className="quick-raises">
              <button onClick={() => setRaiseTo(legal.raiseMin)}>Min</button>
              <button onClick={() => setRaiseTo(quick(0.5))}>½ Pot</button>
              <button onClick={() => setRaiseTo(quick(1))}>Pot</button>
              <button onClick={() => setRaiseTo(legal.raiseMax)}>All-in</button>
            </div>
            <input
              type="range"
              min={legal.raiseMin}
              max={legal.raiseMax}
              step={step}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
            />
            <span className="raise-amount">{isAllIn ? `All-in ${raiseTo}` : raiseTo}</span>
            <button className="btn btn-raise" onClick={() => onAction({ type: 'raise', amount: raiseTo })}>
              {isAllIn ? 'All-in' : 'Raise to'}
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

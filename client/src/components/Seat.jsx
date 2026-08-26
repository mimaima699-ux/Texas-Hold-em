import { useEffect, useState } from 'react'
import Card from './Card.jsx'
import { avatarFor, now } from '../lib.js'

// Countdown (milliseconds), refreshed every 200ms
export function useCountdown(endsAt) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - now()))
  useEffect(() => {
    setRemaining(Math.max(0, endsAt - now()))
    const id = setInterval(() => setRemaining(Math.max(0, endsAt - now())), 200)
    return () => clearInterval(id)
  }, [endsAt])
  return remaining
}

// One seat at the table. p comes from game.players
// (hole of [null, null] means face-down cards).
export default function Seat({ p, isDealer, isActor, isWinner, endsAt, duration }) {
  const hole = p.hole.length ? p.hole : null

  return (
    <div
      className={[
        'seat',
        p.folded ? 'folded' : '',
        isActor ? 'acting' : '',
        isWinner ? 'winner' : '',
        p.allIn && !p.folded ? 'allin' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isActor && endsAt ? <SeatTimer endsAt={endsAt} duration={duration} /> : null}
      {typeof p.wins === 'number' && p.wins > 0 ? (
        <span className="wins-badge" title={`${p.wins} hand(s) won`}>
          🏆 {p.wins}
        </span>
      ) : null}
      <div className="seat-head">
        <span className="seat-avatar">{avatarFor(p.name)}</span>
        <span className="seat-name">
          {p.name}
          {p.isBot ? ' 🤖' : ''}
        </span>
      </div>
      <div className="seat-chips">💰 {p.chips.toLocaleString()}</div>
      <div className="seat-cards">
        {hole
          ? hole.map((c, i) => <Card key={i} card={c} size="sm" dim={p.folded} />)
          : Array.from({ length: 2 }, (_, i) => <Card key={i} card={null} size="sm" dim />)}
      </div>
      {p.allIn && !p.folded ? <span className="badge allin-badge">All-in</span> : null}
      {p.folded ? <span className="badge folded-badge">Folded</span> : null}
      {p.handName && !p.folded ? <span className="badge hand-badge">{p.handName}</span> : null}
      {isDealer ? <span className="dealer-btn" title="Dealer">D</span> : null}
    </div>
  )
}

function SeatTimer({ endsAt, duration }) {
  const remaining = useCountdown(endsAt)
  const pct = Math.max(0, Math.min(100, (remaining / duration) * 100))
  return (
    <div className={`seat-timer ${pct < 25 ? 'urgent' : ''}`}>
      <div className="seat-timer-bar" style={{ width: `${pct}%` }} />
      <span className="seat-timer-text">{Math.ceil(remaining / 1000)}s</span>
    </div>
  )
}

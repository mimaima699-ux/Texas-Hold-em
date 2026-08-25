import { avatarFor } from '../lib.js'

// Game lobby: shows the room code and seats; the host can add AI and start.
export default function RoomLobby({ state, onStart, onAddBot, onRebuy }) {
  const { room } = state
  const isHost = room.youId === room.hostId
  const seated = room.seats.filter(Boolean)
  const eligible = seated.filter((p) => p.chips > 0 && (p.isBot || p.connected))
  const canStart = eligible.length >= 2
  const me = seated.find((p) => p.id === room.youId)

  const shareLink = `${location.origin}${location.pathname}?r=${room.id}`

  return (
    <div className="screen lobby-screen">
      <div className="lobby-panel">
        <h1>🐺 Texas Hold'em · Room Battle</h1>

        <div className="room-share">
          <div className="room-code-big">{room.id}</div>
          <button
            className="btn btn-copy"
            onClick={() => {
              navigator.clipboard?.writeText(shareLink).catch(() => {})
            }}
          >
            Copy invite link
          </button>
          <p className="share-hint">
            Share the room code or link with friends (2~9 players, AI seats available)
          </p>
        </div>

        <div className="lobby-info">
          Starting stack {room.startingChips.toLocaleString()} · Blinds {room.smallBlind}/{room.bigBlind}
        </div>

        <div className="seat-grid">
          {room.seats.map((p, i) =>
            p ? (
              <div key={i} className={`lobby-seat ${p.id === room.youId ? 'me' : ''}`}>
                <span className="lobby-avatar">{avatarFor(p.name)}</span>
                <span className="lobby-name">
                  {p.name}
                  {p.isBot ? ' 🤖' : ''}
                </span>
                <span className="lobby-chips">💰 {p.chips.toLocaleString()}</span>
                {!p.connected && !p.isBot ? <span className="lobby-offline">Offline</span> : null}
                {p.id === room.hostId ? <span className="lobby-host">Host</span> : null}
                {p.id === room.youId && p.chips === 0 ? (
                  <button className="mini-btn" onClick={onRebuy}>
                    Rebuy
                  </button>
                ) : null}
              </div>
            ) : (
              <div key={i} className="lobby-seat empty">
                Empty seat {i + 1}
              </div>
            )
          )}
        </div>

        <div className="lobby-actions">
          {isHost ? (
            <>
              <button className="btn btn-ghost" onClick={onAddBot} disabled={seated.length >= room.maxPlayers}>
                Add AI ({seated.length}/{room.maxPlayers})
              </button>
              <button className="btn btn-primary" onClick={onStart} disabled={!canStart}>
                {canStart ? 'Start Game' : `Need ${2 - eligible.length} more player(s)`}
              </button>
            </>
          ) : (
            <p className="share-hint">Waiting for the host to start the game…</p>
          )}
        </div>

        {me && me.chips === 0 && !isHost ? (
          <button className="btn btn-ghost" onClick={onRebuy}>
            Rebuy {room.startingChips.toLocaleString()}
          </button>
        ) : null}
      </div>
    </div>
  )
}

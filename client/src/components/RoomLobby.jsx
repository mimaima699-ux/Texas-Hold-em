import { avatarFor } from '../lib.js'

// 游戏大厅：展示房间码、座位，房主可添加 AI 并开始游戏。
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
        <h1>🐺 德州扑克 · 房间对战</h1>

        <div className="room-share">
          <div className="room-code-big">{room.id}</div>
          <button
            className="btn btn-copy"
            onClick={() => {
              navigator.clipboard?.writeText(shareLink).catch(() => {})
            }}
          >
            复制邀请链接
          </button>
          <p className="share-hint">把房间号或链接发给朋友，加入后一起玩（支持 2~9 人，可加 AI）</p>
        </div>

        <div className="lobby-info">
          初始筹码 {room.startingChips.toLocaleString()} · 盲注 {room.smallBlind}/{room.bigBlind}
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
                {!p.connected && !p.isBot ? <span className="lobby-offline">离线</span> : null}
                {p.id === room.hostId ? <span className="lobby-host">房主</span> : null}
                {p.id === room.youId && p.chips === 0 ? (
                  <button className="mini-btn" onClick={onRebuy}>
                    重新买入
                  </button>
                ) : null}
              </div>
            ) : (
              <div key={i} className="lobby-seat empty">
                空位 {i + 1}
              </div>
            )
          )}
        </div>

        <div className="lobby-actions">
          {isHost ? (
            <>
              <button className="btn btn-ghost" onClick={onAddBot} disabled={seated.length >= room.maxPlayers}>
                添加 AI（{seated.length}/{room.maxPlayers}）
              </button>
              <button className="btn btn-primary" onClick={onStart} disabled={!canStart}>
                {canStart ? '开始游戏' : `至少 ${2 - eligible.length} 人才能开始`}
              </button>
            </>
          ) : (
            <p className="share-hint">等待房主开始游戏…</p>
          )}
        </div>

        {me && me.chips === 0 && !isHost ? (
          <button className="btn btn-ghost" onClick={onRebuy}>
            重新买入 {room.startingChips.toLocaleString()}
          </button>
        ) : null}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { avatarFor } from '../lib.js'
import ChatBox from './ChatBox.jsx'

// Canonical public URL — invite links always use the fixed domain,
// no matter which address (tunnel / localhost) the page was opened from
const PUBLIC_URL = 'https://texasholdem-mima.me'

// Clipboard with fallback: the async Clipboard API only works in secure,
// focused contexts on some browsers; the legacy execCommand path covers
// the rest. Returns false when both fail (the link is shown for manual copy).
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// Game lobby: shows the room code and seats; the host can add AI and start.
export default function RoomLobby({ state, onStart, onAddBot, onRebuy, onKick, onChat, onLeave, onSpectate }) {
  const { room } = state
  const isHost = room.youId === room.hostId
  const seated = room.seats.filter(Boolean)
  // Any two present players can start — starting a game resets every seat's
  // chips, so leftover stacks from the previous game don't matter
  const present = seated.filter((p) => p.isBot || p.connected)
  const canStart = present.length >= 2
  const me = seated.find((p) => p.id === room.youId)

  const shareLink = `${PUBLIC_URL}/?r=${room.id}`
  const [copyState, setCopyState] = useState('') // '' | 'ok' | 'fail'

  const copyLink = async () => {
    const ok = await copyText(shareLink)
    setCopyState(ok ? 'ok' : 'fail')
    setTimeout(() => setCopyState(''), 2500)
  }

  return (
    <div className="screen lobby-screen">
      <div className="lobby-panel">
        <h1>🐺 Texas Hold'em · Room Battle</h1>

        <div className="room-share">
          <div className="room-code-big">{room.id}</div>
          <button className="btn btn-copy" onClick={copyLink}>
            {copyState === 'ok' ? '✅ Copied!' : copyState === 'fail' ? '❌ Copy failed — select below' : 'Copy invite link'}
          </button>
          {/* Always-visible link: click/tap to select, then copy manually */}
          <input
            className="share-link"
            readOnly
            value={shareLink}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
          />
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
                <span className="lobby-avatar">{p.icon || avatarFor(p.name)}</span>
                <span className="lobby-name">
                  {p.name}
                  {p.isBot ? ' 🤖' : ''}
                </span>
                <span className="lobby-chips">💰 {p.chips.toLocaleString()}</span>
                {isHost && p.id !== room.youId ? (
                  <button className="mini-btn danger" title="Remove this player from the room" onClick={() => onKick(p.id)}>
                    ✕ Remove
                  </button>
                ) : null}
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
                {canStart ? 'Start Game' : `Need ${2 - present.length} more player(s)`}
              </button>
            </>
          ) : (
            <p className="share-hint">Waiting for the host to start the game…</p>
          )}
        </div>

        {me && me.chips === 0 && !isHost ? (
          me.remainingRebuys > 0 ? (
            <button className="btn btn-ghost" onClick={onRebuy}>
              Rebuy {room.startingChips.toLocaleString()} ({me.remainingRebuys} left)
            </button>
          ) : (
            <span className="bench-out" style={{ marginTop: 14 }}>Eliminated — no rebuys left</span>
          )
        ) : null}

        {!room.youSpectating ? (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-ghost leave-btn" onClick={onSpectate}>
              Spectate
            </button>
            <button className="btn btn-ghost leave-btn" onClick={onLeave}>
              Leave room
            </button>
          </div>
        ) : null}
      </div>

      <ChatBox chat={state.chat} onSend={onChat} defaultOpen />
    </div>
  )
}

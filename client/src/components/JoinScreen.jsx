import { useEffect, useState } from 'react'
import { AVATARS } from '../lib.js'

// Entry screen: enter a nickname, pick an avatar, then create or join a room.
export default function JoinScreen({ notice, onCreate, onJoin }) {
  const [name, setName] = useState(() => localStorage.getItem('poker:name') || '')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('r')?.toUpperCase() || '')
  const [rooms, setRooms] = useState([])
  const [chips, setChips] = useState('100')
  const [smallBlind, setSmallBlind] = useState('5')
  const [bigBlind, setBigBlind] = useState('10')
  const [rebuys, setRebuys] = useState('0')
  const [lang, setLang] = useState('zh')
  const [aiChat, setAiChat] = useState(true)
  const [icon, setIcon] = useState(() => localStorage.getItem('poker:icon') || '🐺')

  const pickIcon = (e) => {
    setIcon(e)
    localStorage.setItem('poker:icon', e)
  }

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((list) => alive && setRooms(list))
        .catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const saveName = (n) => {
    setName(n)
    localStorage.setItem('poker:name', n)
  }

  const submitCreate = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreate(name.trim(), {
      startingChips: Number(chips) || undefined,
      smallBlind: Number(smallBlind) || undefined,
      bigBlind: Number(bigBlind) || undefined,
      rebuys: Number(rebuys) || 0,
      lang,
      aiChat,
      icon,
    })
  }
  const submitJoin = (e) => {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    onJoin(name.trim(), code.trim().toUpperCase(), icon)
  }

  return (
    <div className="screen join-screen">
      <div className="join-panel">
        <h1>🐺 Texas Hold'em</h1>
        <p className="tagline">Room battles · medium-strategy AI · full side-pot rules</p>

        {notice ? <div className="notice">{notice}</div> : null}

        <form className="join-form" onSubmit={submitJoin}>
          <label>
            Nickname
            <input
              value={name}
              onChange={(e) => saveName(e.target.value)}
              placeholder="your name"
              maxLength={12}
              autoFocus
            />
          </label>
          <div className="avatar-picker">
            <div className="avatar-picker-title">Avatar</div>
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={'avatar-choice' + (a === icon ? ' selected' : '')}
                  onClick={() => pickIcon(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABCD"
              maxLength={4}
            />
          </label>
          <div className="settings-title">Room settings (for Create Room)</div>
          <div className="room-settings">
            <label>
              Starting chips
              <input type="number" min="10" step="10" value={chips} onChange={(e) => setChips(e.target.value)} />
            </label>
            <label>
              Small blind
              <input type="number" min="1" value={smallBlind} onChange={(e) => setSmallBlind(e.target.value)} />
            </label>
            <label>
              Big blind
              <input type="number" min="2" value={bigBlind} onChange={(e) => setBigBlind(e.target.value)} />
            </label>
            <label>
              Rebuys (0 = none)
              <input type="number" min="0" max="10" value={rebuys} onChange={(e) => setRebuys(e.target.value)} />
            </label>
            <label>
              Chat language
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={aiChat} onChange={(e) => setAiChat(e.target.checked)} />
              AI chat banter
            </label>
          </div>
          <div className="join-buttons">
            <button className="btn btn-primary" type="submit" disabled={!name.trim() || !code.trim()}>
              Join Room
            </button>
            <button className="btn btn-ghost" onClick={submitCreate} disabled={!name.trim()} type="button">
              Create Room
            </button>
          </div>
        </form>

        {rooms.length > 0 ? (
          <div className="room-list">
            <div className="room-list-title">Open rooms</div>
            {rooms.map((r) => (
              <button key={r.id} className="room-list-item" onClick={() => onJoin(name.trim() || 'Player', r.id, icon)}>
                <b>{r.id}</b>
                <span>
                  {r.players}/{r.max} players · {r.phase === 'playing' ? 'in game' : 'waiting'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

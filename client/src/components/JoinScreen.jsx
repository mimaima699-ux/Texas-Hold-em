import { useEffect, useState } from 'react'

// Entry screen: enter a nickname, then create or join a room.
export default function JoinScreen({ notice, onCreate, onJoin }) {
  const [name, setName] = useState(() => localStorage.getItem('poker:name') || '')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('r')?.toUpperCase() || '')
  const [rooms, setRooms] = useState([])

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
    onCreate(name.trim())
  }
  const submitJoin = (e) => {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    onJoin(name.trim(), code.trim().toUpperCase())
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
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABCD"
              maxLength={4}
            />
          </label>
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
              <button key={r.id} className="room-list-item" onClick={() => onJoin(name.trim() || 'Player', r.id)}>
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

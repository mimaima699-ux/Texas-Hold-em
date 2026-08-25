import { useEffect, useState } from 'react'

// 进入页：输入昵称，创建或加入房间。
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
        <h1>🐺 德州扑克</h1>
        <p className="tagline">房间对战 · 中等策略 AI · 边池规则完整</p>

        {notice ? <div className="notice">{notice}</div> : null}

        <form className="join-form" onSubmit={submitJoin}>
          <label>
            昵称
            <input
              value={name}
              onChange={(e) => saveName(e.target.value)}
              placeholder="你的名字"
              maxLength={12}
              autoFocus
            />
          </label>
          <label>
            房间号
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="如 ABCD"
              maxLength={4}
            />
          </label>
          <div className="join-buttons">
            <button className="btn btn-primary" type="submit" disabled={!name.trim() || !code.trim()}>
              加入房间
            </button>
            <button className="btn btn-ghost" onClick={submitCreate} disabled={!name.trim()} type="button">
              创建房间
            </button>
          </div>
        </form>

        {rooms.length > 0 ? (
          <div className="room-list">
            <div className="room-list-title">开放中的房间</div>
            {rooms.map((r) => (
              <button key={r.id} className="room-list-item" onClick={() => onJoin(name.trim() || '玩家', r.id)}>
                <b>{r.id}</b>
                <span>
                  {r.players}/{r.max} 人 · {r.phase === 'playing' ? '游戏中' : '等待中'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

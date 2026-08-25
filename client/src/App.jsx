import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import JoinScreen from './components/JoinScreen.jsx'
import RoomLobby from './components/RoomLobby.jsx'
import GameTable from './components/GameTable.jsx'
import { syncClock } from './lib.js'

const SESSION_KEY = 'poker:session'

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export const socket = io({ autoConnect: false })

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [notice, setNotice] = useState('')

  const sessionRef = useRef(session)
  sessionRef.current = session

  const clearSession = useCallback((msg) => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setState(null)
    if (msg) setNotice(msg)
  }, [])

  // Auto-dismiss the notice bar
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(id)
  }, [notice])

  // Socket lifecycle: connect / reconnect / state sync
  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true)
      const s = sessionRef.current
      if (s) {
        socket.emit('room:join', { roomId: s.roomId, playerId: s.playerId, name: s.name }, (res) => {
          if (!res?.ok) clearSession(res?.error || 'Room no longer exists')
        })
      }
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('state', (s) => {
      syncClock(s?.room?.serverTime)
      setState(s)
    })
    if (sessionRef.current) socket.connect()
    return () => {
      socket.off()
    }
  }, [clearSession])

  const establish = useCallback((res, name) => {
    if (!res?.ok) {
      setNotice(res?.error || 'Something went wrong')
      return
    }
    const s = { roomId: res.roomId, playerId: res.playerId, name }
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    setSession(s)
    setNotice('')
  }, [])

  const createRoom = useCallback(
    (name) => {
      socket.connect()
      socket.emit('room:create', { name }, (res) => establish(res, name))
    },
    [establish]
  )

  const joinRoom = useCallback(
    (name, roomId) => {
      socket.connect()
      socket.emit('room:join', { roomId, name }, (res) => establish({ ...res, roomId: res?.ok ? roomId : undefined }, name))
    },
    [establish]
  )

  const act = useCallback((action) => {
    socket.emit('game:action', action, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const startGame = useCallback(() => {
    socket.emit('game:start', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const addBot = useCallback(() => {
    socket.emit('room:addBot', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  const rebuy = useCallback(() => {
    socket.emit('game:rebuy', {}, (res) => {
      if (res && !res.ok) setNotice(res.error)
    })
  }, [])

  // ==== Rendering ====

  if (!session) {
    return <JoinScreen notice={notice} onCreate={createRoom} onJoin={joinRoom} />
  }

  if (!state) {
    return (
      <div className="screen center-screen">
        {notice ? <div className="notice">{notice}</div> : null}
        <div className="loading">{connected ? 'Entering room…' : 'Connecting to server…'}</div>
      </div>
    )
  }

  const inGame = state.room.phase === 'playing' && state.game

  return (
    <>
      {inGame ? (
        <GameTable state={state} onAction={act} onRebuy={rebuy} />
      ) : (
        <RoomLobby state={state} onStart={startGame} onAddBot={addBot} onRebuy={rebuy} />
      )}
      {notice ? <div className="toast">{notice}</div> : null}
      {!connected ? (
        <div className="overlay">
          <div className="overlay-box">⚠️ Connection lost, reconnecting…</div>
        </div>
      ) : null}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'

const QUICK_EMOJIS = ['👍', '😂', '😱', '😭', '🎉', '😈', '🤔', '🤝', '🍺', '🐺']

// Room chat: text messages + quick emoji bar. Collapsible to save table space.
export default function ChatBox({ chat = [], onSend, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [chat.length, open])

  const send = (v) => {
    const clean = String(v || '').trim()
    if (!clean) return
    onSend(clean)
    setText('')
  }

  const lastMsg = chat.length ? chat[chat.length - 1] : null

  return (
    <div className={`chat-box ${open ? 'open' : ''}`}>
      <button className="chat-toggle" onClick={() => setOpen(!open)}>
        💬 Chat
        {!open && lastMsg ? <span className="chat-last"> · {lastMsg.name}: {lastMsg.text.slice(0, 14)}</span> : ''}
      </button>
      {open ? (
        <div className="chat-body">
          <div className="chat-list" ref={listRef}>
            {chat.length === 0 ? <div className="chat-empty">Say hi 👋</div> : null}
            {chat.map((m) => (
              <div key={m.id} className="chat-msg">
                <b>{m.name}</b>: {m.text}
              </div>
            ))}
          </div>
          <div className="chat-emojis">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => send(e)} title="send">
                {e}
              </button>
            ))}
          </div>
          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={120}
              placeholder="Type a message…"
            />
            <button type="submit">Send</button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

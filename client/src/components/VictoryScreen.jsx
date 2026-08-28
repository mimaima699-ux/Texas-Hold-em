import { avatarFor } from '../lib.js'

// Settlement overlay shown when a whole game ends: congratulates the champion
// and lists the final standings. Dismissing it reveals the lobby underneath,
// where players can rebuy and the host can start the next game.
export default function VictoryScreen({ gameOver, youId, onDismiss }) {
  const { champion, standings, hands } = gameOver
  const iWon = champion.id === youId

  const rankLabel = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank)

  return (
    <div className="overlay victory-overlay">
      <div className="victory-panel">
        <div className="victory-trophy">🏆</div>
        <h1 className="victory-title">
          🎉 Congratulations to {champion.name}
          {champion.isBot ? ' 🤖' : ''} — Champion! 🎊
        </h1>
        {iWon ? <p className="victory-me">👑 You are the champion!</p> : null}
        <p className="victory-stats">
          {hands} hands played · final stack {champion.chips.toLocaleString()} · {champion.wins} hands
          won
        </p>

        {champion.isBot && gameOver.championSpeech ? (
          <p className="victory-speech">
            {champion.icon} {gameOver.championSpeech}
          </p>
        ) : null}

        <table className="victory-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Hands Won</th>
              <th>Final Chips</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((p) => (
              <tr key={p.id} className={`${p.id === champion.id ? 'champ' : ''} ${p.id === youId ? 'me' : ''}`}>
                <td>{rankLabel(p.rank)}</td>
                <td>
                  {p.icon || avatarFor(p.name)} {p.name}
                  {p.isBot ? ' 🤖' : ''}
                </td>
                <td>{p.wins}</td>
                <td>{p.chips.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="btn btn-primary victory-btn" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </div>
  )
}

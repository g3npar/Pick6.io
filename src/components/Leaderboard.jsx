import { useEffect, useState } from 'react'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Survives remounts (leaving and returning to the tab), so switching nav screens
// shows the last result instantly instead of a loading flash every time.
let cachedRows = null

export default function Leaderboard() {
  const [rows,    setRows]    = useState(cachedRows)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    fetch(`${API}/leaderboard`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { cachedRows = data; setRows(data) })
      .catch(() => setError(true))
  }, [])

  return (
    <div className="htp-page">
      <div className="htp-card">

        <div className="htp-hero">
          <h1 className="htp-title">Leaderboard</h1>
          <p className="htp-subtitle">Ranked by total score across every daily puzzle played.</p>
        </div>

        {error && <p className="board-empty">Couldn't load the leaderboard right now.</p>}
        {!error && !rows && (
          <div className="loading-wheel-wrap" style={{ padding: '24px 0' }}>
            <WheelSpinner size={40} />
          </div>
        )}
        {rows && rows.length === 0 && <p className="board-empty">No results yet, be the first to finish a daily puzzle.</p>}

        {rows && rows.length > 0 && (
          <ul className="board-list">
            {rows.map((r, i) => (
              <li key={i} className="board-row">
                <span className="board-rank">{i + 1}</span>
                <span className="board-name">{r.display_name}</span>
                <span className="board-meta">{r.puzzles_played} played · {r.avg_score} avg</span>
                <span className="board-score">{r.total_score}</span>
              </li>
            ))}
          </ul>
        )}

      </div>
    </div>
  )
}

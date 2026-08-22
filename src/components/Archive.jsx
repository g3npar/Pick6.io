import { useEffect, useState } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Survives remounts (leaving and returning to the tab), so switching nav screens
// shows the last result instantly instead of a loading flash every time.
let cachedRows = null

export default function Archive({ user, onPlayDate }) {
  const [rows,  setRows]  = useState(cachedRows)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${API}/puzzle/archive`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { cachedRows = data; setRows(data) })
      .catch(() => setError(true))
  }, [user])

  return (
    <div className="htp-page">
      <div className="htp-card">

        {!user && <p className="board-empty">Sign in to track which ones you've completed.</p>}
        {error && <p className="board-empty">Couldn't load the archive right now.</p>}
        {!error && !rows && (
          <div className="loading-wheel-wrap" style={{ padding: '24px 0' }}>
            <WheelSpinner size={40} />
          </div>
        )}
        {rows && rows.length === 0 && <p className="board-empty">No puzzles archived yet, check back after today's.</p>}

        {rows && rows.length > 0 && (
          <ul className="board-list">
            {rows.map(r => (
              <li key={r.date} className="board-row">
                <span className="board-name">{formatDate(r.date)}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {r.completed && <span className="board-meta board-meta--done">✓ Completed · {r.score}/6</span>}
                  <button className="board-reveal-btn" onClick={() => onPlayDate(r.date)}>
                    {r.completed ? 'View' : 'Play'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

      </div>
    </div>
  )
}

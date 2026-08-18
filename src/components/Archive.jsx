import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Dates arrive as plain "YYYY-MM-DD" strings; parse as a local calendar date
// (not UTC) so it can't drift a day off in any timezone.
const formatDate = d => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Archive({ user, onPlayDate }) {
  const [rows,  setRows]  = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${API}/puzzle/archive`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setRows)
      .catch(() => setError(true))
  }, [user])

  return (
    <div className="htp-page">
      <div className="htp-card">

        <div className="htp-hero">
          <span className="htp-icon">📅</span>
          <h1 className="htp-title">Archive</h1>
          <p className="htp-subtitle">Every daily puzzle released so far, catch up on any you missed.</p>
        </div>

        {!user && <p className="board-empty">Sign in to track which ones you've completed.</p>}
        {error && <p className="board-empty">Couldn't load the archive right now.</p>}
        {!error && !rows && <p className="board-empty">Loading…</p>}
        {rows && rows.length === 0 && <p className="board-empty">No puzzles archived yet, check back after today's.</p>}

        {rows && rows.length > 0 && (
          <ul className="board-list">
            {rows.map(r => (
              <li key={r.date} className="board-row">
                <span className="board-name">{formatDate(r.date)}</span>
                {r.completed ? (
                  <span className="board-meta board-meta--done">✓ Completed · {r.score}/6</span>
                ) : (
                  <button className="header-icon-btn" style={{ marginLeft: 'auto' }} onClick={() => onPlayDate(r.date)}>
                    Play
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const GAMES = {
  pick6:    { title: 'Pick 6',    path: '/puzzle/archive' },
  filmroom: { title: 'Film Room', path: '/filmroom/archive' },
  lineup:   { title: 'Logo Lineup', path: '/lineup/archive' },
}

// survives remounts to avoid loading flash, one per game
const cachedRows = {}

// opens on the game you last played, same switch as the leaderboard
export default function Archive({ user, defaultGame = 'pick6', onPlayDate }) {
  const [game,  setGame]  = useState(defaultGame)
  const [rows,  setRows]  = useState(cachedRows[game] ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setRows(cachedRows[game] ?? null); setError(false)
    fetch(`${API}${GAMES[game].path}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { cachedRows[game] = data; setRows(data) })
      .catch(() => setError(true))
  }, [user, game])

  return (
    <div className="htp-page">
      <div className="htp-card">

        <div className="mode-toggle" role="tablist">
          {Object.entries(GAMES).map(([id, g]) => (
            <button
              key={id}
              role="tab"
              aria-selected={game === id}
              className={`mode-btn${game === id ? ' mode-btn--active' : ''}`}
              onClick={() => setGame(id)}
            >
              {g.title}
            </button>
          ))}
        </div>

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
                  <button className="board-reveal-btn" onClick={() => onPlayDate(game, r.date)}>
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

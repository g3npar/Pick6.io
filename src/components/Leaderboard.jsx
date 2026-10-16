import { useEffect, useState } from 'react'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const GAMES = {
  pick6:    { title: 'Pick 6',    path: '/leaderboard',          empty: 'a daily puzzle' },
  filmroom: { title: 'Film Room', path: '/filmroom/leaderboard', empty: 'a Film Room' },
  lineup:   { title: 'Logo Lineup', path: '/lineup/leaderboard', empty: 'a Logo Lineup' },
}

// cached per game to avoid a loading flash
const cachedRows = {}

// opens on the last game played
export default function Leaderboard({ defaultGame = 'pick6' }) {
  const [game, setGame] = useState(defaultGame)
  const { path, empty } = GAMES[game]
  const [rows,    setRows]    = useState(cachedRows[game] ?? null)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    // reset when switching games
    setRows(cachedRows[game] ?? null); setError(false)
    fetch(`${API}${path}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { cachedRows[game] = data; setRows(data) })
      .catch(() => setError(true))
  }, [game, path])

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

        {error && <p className="board-empty">Couldn't load the leaderboard right now.</p>}
        {!error && !rows && (
          <div className="loading-wheel-wrap" style={{ padding: '24px 0' }}>
            <WheelSpinner size={40} />
          </div>
        )}
        {rows && rows.length === 0 && <p className="board-empty">No results yet, be the first to finish {empty}.</p>}

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

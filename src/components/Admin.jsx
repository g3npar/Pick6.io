import { useEffect, useState, useCallback } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

async function postJSON(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function Admin() {
  const [rows, setRows]     = useState(null)
  const [error, setError]   = useState(false)
  const [selected, setSelected] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [busy, setBusy]     = useState(false)
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [revealed, setRevealed] = useState(new Set())

  const revealDate = (e, date) => {
    e.stopPropagation()
    setRevealed(prev => new Set(prev).add(date))
  }

  const load = useCallback(() => {
    fetch(`${API}/admin/puzzles?days=14`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setRows)
      .catch(() => setError(true))
  }, [])

  useEffect(() => { load() }, [load])

  const selectDate = row => {
    setSelected(row.date)
    setCandidate(row.puzzle)
    setQuery(''); setResults([])
  }

  const shuffle = () => {
    setBusy(true)
    postJSON('/admin/preview', { date: selected, mode: 'shuffle' })
      .then(d => setCandidate(d.puzzle))
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  const searchPlayers = q => {
    setQuery(q)
    if (q.length < 2) { setResults([]); return }
    fetch(`${API}/players/search?${new URLSearchParams({ q })}`)
      .then(r => r.json())
      .then(setResults)
      .catch(() => {})
  }

  const pickPlayer = item => {
    setBusy(true)
    postJSON('/admin/preview', { date: selected, mode: 'player', name: item.name, draftYear: item.draft_year })
      .then(d => { setCandidate(d.puzzle); setQuery(item.name); setResults([]) })
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  const setPuzzle = () => {
    setBusy(true)
    postJSON('/admin/set', { date: selected, puzzle: candidate })
      .then(() => { load(); setSelected(null); setCandidate(null) })
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="htp-page">
      <div className="htp-card">

        {error && <p className="board-empty">Couldn't load the schedule.</p>}
        {!error && !rows && (
          <div className="loading-wheel-wrap" style={{ padding: '24px 0' }}>
            <WheelSpinner size={40} />
          </div>
        )}

        {rows && (
          <ul className="board-list">
            {rows.map(r => (
              <li
                key={r.date}
                className={`board-row admin-row${selected === r.date ? ' admin-row--active' : ''}`}
                onClick={() => selectDate(r)}
              >
                <span className="board-name">{formatDate(r.date)}</span>
                {!r.puzzle ? (
                  <span className="board-meta">No eligible players</span>
                ) : revealed.has(r.date) ? (
                  <span className="board-meta">{r.puzzle.playerName}</span>
                ) : (
                  <button className="board-reveal-btn" onClick={e => revealDate(e, r.date)}>Reveal</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {selected && candidate && (
          <div className="admin-detail">
            <h2 className="htp-section-title">{formatDate(selected)}</h2>
            <p className="admin-player-name">{candidate.playerName} · {candidate.position}</p>
            <ul className="admin-fact-list">
              {candidate.facts.map(f => (
                <li key={f.id} className={f.id === candidate.falseFactId ? 'admin-fact--lie' : ''}>
                  {f.id === candidate.falseFactId ? '✗' : '✓'} {f.text}
                </li>
              ))}
            </ul>

            <div className="admin-actions">
              <button className="header-icon-btn" disabled={busy} onClick={shuffle}>Shuffle</button>
              <button className="submit-btn submit-btn--green" disabled={busy} onClick={setPuzzle} style={{ flex: 1 }}>
                Set This Puzzle
              </button>
            </div>

            <div className="search-wrap admin-search">
              <input
                className="custom-player-input"
                placeholder="Or search a specific player…"
                value={query}
                onChange={e => searchPlayers(e.target.value)}
                autoComplete="off"
              />
              {results.length > 0 && (
                <ul className="player-dropdown">
                  {results.map(item => (
                    <li key={item.id} className="dropdown-item" onMouseDown={() => pickPlayer(item)}>
                      <span className="dropdown-player-name">{item.name}</span>
                      <span className="dropdown-player-meta">
                        {item.position}{item.draft_year ? ` · ${item.draft_year}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'
import AdminPlayTest from './AdminPlayTest'

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
  const [playing, setPlaying] = useState(false)
  const [alternatives, setAlternatives] = useState(null)
  const [swapFor, setSwapFor] = useState(null)

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
    setQuery(''); setResults([]); setPlaying(false); closeSwap()
  }

  const shuffle = () => {
    setBusy(true)
    postJSON('/admin/preview', { date: selected, mode: 'shuffle' })
      .then(d => { setCandidate(d.puzzle); setPlaying(false); closeSwap() })
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
      .then(d => { setCandidate(d.puzzle); setQuery(item.name); setResults([]); closeSwap() })
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

  const closeSwap = () => { setSwapFor(null); setAlternatives(null) }

  const openSwap = factId => {
    if (swapFor === factId) return closeSwap()
    setSwapFor(factId)
    setAlternatives(null)
    postJSON('/admin/preview/alternatives', { candidate })
      .then(d => setAlternatives(d.alternatives))
      .catch(e => { alert(e.message); closeSwap() })
  }

  const swapFact = (factId, replacementText) => {
    setBusy(true)
    postJSON('/admin/preview/swap', { candidate, factId, replacementText })
      .then(d => { setCandidate(d.puzzle); closeSwap() })
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  const selectLie = factId => {
    if (factId === candidate.falseFactId) return
    setBusy(true)
    postJSON('/admin/preview/lie', { candidate, factId })
      .then(d => setCandidate(d.puzzle))
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  // rendered full width, outside htp-page's narrow doc layout, since the
  // wheel needs its normal puzzle-game width, not a 680px capped column
  if (selected && candidate && playing) {
    return <AdminPlayTest puzzle={candidate} date={selected} onClose={() => setPlaying(false)} />
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
                ) : (
                  <span className="board-meta">{r.puzzle.playerName}</span>
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
                <li
                  key={f.id}
                  className={`admin-fact-pick${f.id === candidate.falseFactId ? ' admin-fact--lie' : ''}`}
                >
                  <div className="admin-fact-row" onClick={() => !busy && selectLie(f.id)}>
                    <span>{f.id === candidate.falseFactId ? '✗' : '✓'} {f.text}</span>
                    <button
                      className="admin-swap-btn"
                      disabled={busy}
                      onClick={e => { e.stopPropagation(); openSwap(f.id) }}
                    >
                      Swap
                    </button>
                  </div>
                  {swapFor === f.id && (
                    <ul className="admin-swap-menu">
                      {!alternatives && <li className="admin-swap-empty">Loading…</li>}
                      {alternatives?.length === 0 && <li className="admin-swap-empty">No other facts available</li>}
                      {alternatives?.map(alt => (
                        <li key={alt.text} onClick={() => !busy && swapFact(f.id, alt.text)}>{alt.text}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <div className="admin-actions">
              <button className="header-icon-btn" disabled={busy} onClick={shuffle}>Shuffle</button>
              <button className="header-icon-btn" disabled={busy} onClick={() => setPlaying(true)}>Play</button>
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

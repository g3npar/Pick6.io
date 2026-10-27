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

  // new players for the next 7 days, saved right away (today stays)
  const [shufflingWeek, setShufflingWeek] = useState(false)
  const shuffleWeek = () => {
    if (!window.confirm('Replace the Pick 6 puzzles for the next 7 days with new random players? Today stays the same.')) return
    setShufflingWeek(true)
    postJSON('/admin/shuffle-week', {})
      .then(() => { setSelected(null); setCandidate(null); load() })
      .catch(e => alert(e.message))
      .finally(() => setShufflingWeek(false))
  }

  const regenerateFacts = () => {
    setBusy(true)
    postJSON('/admin/preview/regenerate', { candidate })
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
    setBusy(true)
    postJSON('/admin/preview/lie', { candidate, factId })
      .then(d => setCandidate(d.puzzle))
      .catch(e => alert(e.message))
      .finally(() => setBusy(false))
  }

  // full width, the wheel doesn't fit the narrow page layout
  if (selected && candidate && playing) {
    return <AdminPlayTest puzzle={candidate} date={selected} onClose={() => setPlaying(false)} />
  }

  return (
    <div className="htp-page">
      <div className="htp-card">
        <div className="stats-head">
          <h2 className="htp-section-title">Upcoming Pick 6</h2>
          <button className="profile-btn" onClick={shuffleWeek} disabled={shufflingWeek || busy || !rows}>
            {shufflingWeek ? <><span className="fr-spinner" aria-hidden="true" />Shuffling…</> : 'Shuffle next 7 days'}
          </button>
        </div>

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
                      {!alternatives && <li className="admin-swap-empty"><span className="fr-spinner" aria-hidden="true" />Loading…</li>}
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
              <button className="header-icon-btn" disabled={busy} onClick={regenerateFacts}>New Facts</button>
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
      <TodayStats />
      <BugList />
    </div>
  )
}

const GAME_NAMES = { pick6: 'Pick 6', filmroom: 'Film Room', lineup: 'Logo Lineup', other: 'Other' }
const GAME_IDS = ['pick6', 'filmroom', 'lineup']

// today's players per game, the last week, and finishes per hour
function TodayStats() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(false)
  const load = () => {
    setStats(null); setError(false)
    fetch(`${API}/admin/stats`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setStats)
      .catch(() => setError(true))
  }
  useEffect(load, [])

  const byGame = stats && Object.fromEntries(stats.games.map(g => [g.game, g]))
  const days = stats && [...new Set(stats.week.map(w => w.date))]
  const weekCount = (date, game) => stats.week.find(w => w.date === date && w.game === game)?.players ?? 0
  const maxHour = stats && Math.max(1, ...stats.hours.map(h => h.finishes))
  const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`

  return (
    <div className="htp-card">
      <div className="legal-section">
        <div className="stats-head">
          <h2 className="htp-section-title">Today</h2>
          <button className="profile-btn" onClick={load} disabled={!stats && !error}>Refresh</button>
        </div>
        {error && <p className="board-empty">Couldn't load stats.</p>}
        {!stats && !error && <WheelSpinner size={32} />}
        {stats && (
          <>
            <table className="admin-stats">
              <thead><tr><th>Game</th><th>Players</th><th>Signed in</th><th>Avg</th></tr></thead>
              <tbody>
                {GAME_IDS.map(id => (
                  <tr key={id}>
                    <td>{GAME_NAMES[id]}</td>
                    <td>{byGame[id]?.players ?? 0}</td>
                    <td>{byGame[id]?.signed_in ?? 0}</td>
                    <td>{byGame[id] ? `${byGame[id].avg}/6` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="board-meta">
              {stats.accounts.total} accounts ({stats.accounts.today} new today) · {stats.bugReports} bug reports
            </p>

            <h3 className="admin-stats-sub">Finishes per hour (ET)</h3>
            {stats.hours.length === 0 ? <p className="board-empty">Nobody yet today.</p> : (
              <div className="admin-hours">
                {stats.hours.map(h => (
                  <div key={h.hour} className="admin-hour" title={`${h.finishes} finishes`}>
                    <span className="admin-hour-bar" style={{ height: `${(h.finishes / maxHour) * 100}%` }} />
                    <span className="admin-hour-n">{h.finishes}</span>
                    <span className="admin-hour-label">{hourLabel(h.hour)}</span>
                  </div>
                ))}
              </div>
            )}

            <h3 className="admin-stats-sub">Last 7 days</h3>
            <table className="admin-stats">
              <thead><tr><th>Day</th>{GAME_IDS.map(id => <th key={id}>{GAME_NAMES[id]}</th>)}</tr></thead>
              <tbody>
                {days.map(d => (
                  <tr key={d}><td>{formatDate(d)}</td>{GAME_IDS.map(id => <td key={id}>{weekCount(d, id)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

// reports from the "Report a bug" page, newest first
function BugList() {
  const [bugs, setBugs] = useState(null)
  useEffect(() => {
    fetch(`${API}/admin/bugs`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(setBugs)
      .catch(() => setBugs([]))
  }, [])

  return (
    <div className="htp-card">
      <div className="legal-section">
        <h2 className="htp-section-title">Bug reports</h2>
        {!bugs && <WheelSpinner size={32} />}
        {bugs && bugs.length === 0 && <p className="board-empty">No bug reports yet.</p>}
        {bugs && bugs.length > 0 && (
          <ul className="bug-list">
            {bugs.map(b => (
              <li key={b.id} className="bug-item">
                <span className="board-meta">
                  {new Date(b.created_at).toLocaleString()} · {GAME_NAMES[b.game] || b.game}
                  {(b.email || b.contact) && ` · ${b.email || b.contact}`}
                </span>
                <p className="bug-item-message">{b.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

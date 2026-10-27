import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const ANON_KEY = 'pick6_anon_id'

// puzzle days roll over in New York time
export const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

// random id so a signed out player's score counts once a day
export function anonId() {
  try {
    let id = localStorage.getItem(ANON_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(ANON_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

// "top X%" for a finished game: 'loading', then { top, players }, or null if it failed
export function usePercentile(game, date, score) {
  const [result, setResult] = useState(null)
  useEffect(() => {
    setResult(null)
    if (!date || score === null || score === undefined) return
    setResult('loading')
    let cancelled = false
    const q = new URLSearchParams({ game, date, score: String(score) })
    const id = anonId()
    if (id) q.set('anonId', id)
    fetch(`${API}/percentile?${q}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setResult(d) })
      .catch(() => { if (!cancelled) setResult(null) })
    return () => { cancelled = true }
  }, [game, date, score])
  return result
}

// e.g. "Top 12% today", or "Top 12% of players that day" for an archive day
export function TopPercent({ result, today }) {
  if (!result) return null
  if (result === 'loading') {
    return <p className="top-percent top-percent--loading"><span className="fr-spinner" aria-hidden="true" />Seeing how everyone did…</p>
  }
  if (result.top === null) {
    return today ? <p className="top-percent">You're the first to finish today</p> : null
  }
  return (
    <p className="top-percent">
      <strong>Top {result.top}%</strong> {today ? 'today' : 'of players that day'}
      <span className="top-percent-count">out of {result.players} {result.players === 1 ? 'player' : 'players'}</span>
    </p>
  )
}

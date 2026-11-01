import { useEffect, useState } from 'react'
import { todayNY } from '../utils/percentile'
import InstallPrompt from './InstallPrompt'

const KEY = 'pick6_played_today'
// which game to suggest after each one
const ORDER = ['pick6', 'lineup', 'filmroom']
const GAMES = {
  pick6:    { name: 'Pick 6',      screen: 'daily',    pitch: 'Find the lie, name the player' },
  lineup:   { name: 'Logo Lineup', screen: 'lineup',   pitch: 'Name 6 zoomed in team logos' },
  filmroom: { name: 'Film Room',   screen: 'filmroom', pitch: 'Guess the NFL team and season' },
}

// games finished today in this browser
function readPlayed() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    return saved?.date === todayNY() ? saved.games : []
  } catch {
    return []
  }
}
function markPlayed(game) {
  const games = [...new Set([...readPlayed(), game])]
  try { localStorage.setItem(KEY, JSON.stringify({ date: todayNY(), games })) } catch {}
  return games
}

// time until the next puzzles (midnight ET)
function untilMidnightET() {
  const ny = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const next = new Date(ny)
  next.setHours(24, 0, 0, 0)
  return next - ny
}

function Countdown() {
  const [ms, setMs] = useState(untilMidnightET)
  useEffect(() => {
    const t = setInterval(() => setMs(untilMidnightET()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = n => String(n).padStart(2, '0')
  return (
    <p className="next-puzzle">
      Next puzzles in <strong>{Math.floor(s / 3600)}:{pad(Math.floor(s / 60) % 60)}:{pad(s % 60)}</strong>
    </p>
  )
}

// on today's results screen: points you to a game you haven't finished yet
export default function UpNext({ current, onPlay }) {
  const [played, setPlayed] = useState(readPlayed)
  useEffect(() => { setPlayed(markPlayed(current)) }, [current])

  const start = ORDER.indexOf(current)
  const next = [1, 2].map(i => ORDER[(start + i) % ORDER.length]).find(g => !played.includes(g))
  if (!onPlay) return null
  if (!next) {
    return (
      <>
        <p className="up-next-done">That's all 3 for today.</p>
        <Countdown />
        <InstallPrompt />
      </>
    )
  }

  const g = GAMES[next]
  return (
    <>
      <Countdown />
      <button className="up-next" onClick={() => onPlay(g.screen)}>
        <span className="up-next-label">Up next</span>
        <span className="up-next-name">{g.name} →</span>
        <span className="up-next-pitch">{g.pitch}</span>
      </button>
      <InstallPrompt />
    </>
  )
}

import { useEffect, useState } from 'react'
import { todayNY } from '../utils/percentile'

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

// on today's results screen: points you to a game you haven't finished yet
export default function UpNext({ current, onPlay }) {
  const [played, setPlayed] = useState(readPlayed)
  useEffect(() => { setPlayed(markPlayed(current)) }, [current])

  const start = ORDER.indexOf(current)
  const next = [1, 2].map(i => ORDER[(start + i) % ORDER.length]).find(g => !played.includes(g))
  if (!onPlay) return null
  if (!next) return <p className="up-next-done">That's all 3 for today. New puzzles at midnight ET.</p>

  const g = GAMES[next]
  return (
    <button className="up-next" onClick={() => onPlay(g.screen)}>
      <span className="up-next-label">Up next</span>
      <span className="up-next-name">{g.name} →</span>
      <span className="up-next-pitch">{g.pitch}</span>
    </button>
  )
}

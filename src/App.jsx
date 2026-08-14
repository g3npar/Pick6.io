import { useState, useEffect } from 'react'
import Header from './components/Header'
import GameBoard from './components/GameBoard'
import HowToPlay from './components/HowToPlay'
import ComingSoon from './components/ComingSoon'
import { parseFact } from './utils/factDisplay'
import { teamLogo } from './utils/teamLogo'
import { collegeLogo } from './utils/collegeLogo'

const API          = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const PUZZLE_COUNT = 3

function preloadLogos(puzzles) {
  const urls = new Set()
  for (const puzzle of puzzles) {
    for (const fact of puzzle.facts) {
      const d = parseFact(fact.text)
      if (d.isTeams) {
        d.value.split(', ').forEach(team => { const u = teamLogo(team); if (u) urls.add(u) })
      } else if (d.isCollege) {
        const u = collegeLogo(d.value); if (u) urls.add(u)
      }
    }
  }
  urls.forEach(url => { const img = new Image(); img.src = url })
}

// Normalize curly/smart apostrophes to straight apostrophe for comparison
const normName = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9 .\-]/g, '')

function App() {
  const [screen,       setScreen]       = useState('daily')
  const [puzzles,      setPuzzles]      = useState(null)
  const [generating,   setGenerating]   = useState(false)
  const [puzzleStates, setPuzzleStates] = useState({})

  useEffect(() => {
    fetch(`${API}/puzzle/today/current`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => { const arr = [p]; setPuzzles(arr); preloadLogos(arr) })
      .catch(err => console.error('Failed to load puzzle:', err))
  }, [])

  const handleGenerate = () => {
    setGenerating(true)
    fetch(`${API}/puzzle/today/current?fresh=${Date.now()}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => { setPuzzles([p]); setPuzzleStates({}); preloadLogos([p]) })
      .catch(() => {})
      .finally(() => setGenerating(false))
  }

  if (!puzzles) {
    return (
      <div className="app">
        <Header screen={screen} onNav={setScreen} />
        <main className="main-content" style={{ display: 'flex', justifyContent: 'center', marginTop: '6rem' }}>
          {screen === 'daily'       && <p style={{ opacity: 0.5 }}>Loading puzzles…</p>}
          {screen === 'how-to-play' && <HowToPlay />}
          {screen === 'archive'     && <ComingSoon title="Archive" />}
          {screen === 'leaderboard' && <ComingSoon title="Leaderboard" />}
        </main>
      </div>
    )
  }

  const puzzle         = puzzles[0]
  const curState       = puzzleStates[0] || {}
  const selectedLieId  = curState.lieId         ?? null
  const selectedPlayer = curState.player        ?? ''
  const lieFound       = curState.lieFound      ?? false
  const lieAttempts    = curState.lieAttempts   ?? 0
  const confirmedTrueIds = curState.confirmedTrueIds ?? []
  const submitted      = curState.submitted     ?? false   // player name submitted = game over
  const liePhaseComplete = lieFound || lieAttempts >= 3

  const updateCurrent = updates =>
    setPuzzleStates(prev => ({ ...prev, 0: { ...(prev[0] || {}), ...updates } }))

  // Lie guess: evaluate immediately
  const handleGuessLie = () => {
    if (!selectedLieId || liePhaseComplete) return
    const correct = selectedLieId === puzzle.falseFactId
    if (correct) {
      updateCurrent({ lieFound: true })
    } else {
      const newAttempts = lieAttempts + 1
      // Reveal one unconfirmed true fact (not the actual lie, not already confirmed, not the bad guess)
      const candidates = puzzle.facts.filter(
        f => f.id !== puzzle.falseFactId && !confirmedTrueIds.includes(f.id) && f.id !== selectedLieId
      )
      const toReveal = candidates[lieAttempts % Math.max(1, candidates.length)]
      updateCurrent({
        lieAttempts: newAttempts,
        confirmedTrueIds: toReveal ? [...confirmedTrueIds, toReveal.id] : confirmedTrueIds,
        lieId: null,
      })
    }
  }

  // Player name submit (only available after lie phase)
  const handleSubmit = () => {
    if (!selectedPlayer || !liePhaseComplete) return
    updateCurrent({ submitted: true })
  }

  const handleGiveUp = () => {
    updateCurrent({ lieAttempts: 3, submitted: true })
  }

  const playerCorrect = submitted && normName(selectedPlayer) === normName(puzzle.playerName)
  const lieScore   = submitted ? (lieFound ? Math.max(1, 3 - lieAttempts) : 0) : 0
  const playerScore = submitted && playerCorrect ? 2 : 0
  const currentScore = lieScore + playerScore

  const completedIndices = submitted ? [0] : []
  const puzzleResults = {}

  const handlePlayerPuzzle = (name) => {
    setGenerating(true)
    fetch(`${API}/puzzle/player?${new URLSearchParams({ name })}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => {
          try { const d = JSON.parse(t); throw new Error(d.error || `Server error ${r.status}`) }
          catch { throw new Error(`Player not found or server error (${r.status})`) }
        })
        return r.json()
      })
      .then(p => { setPuzzles([p]); setPuzzleStates({}); preloadLogos([p]) })
      .catch(err => alert(`Could not build puzzle: ${err.message}`))
      .finally(() => setGenerating(false))
  }

  return (
    <div className="app">
      <Header screen={screen} onNav={setScreen} />
      <main className="main-content">
        {screen === 'how-to-play' && <HowToPlay />}
        {screen === 'archive'     && <ComingSoon title="Archive" />}
        {screen === 'leaderboard' && <ComingSoon title="Leaderboard" />}
        {screen === 'daily'       && (
        <GameBoard
          puzzle={puzzle}
          totalPuzzles={1}
          selectedLieId={selectedLieId}
          selectedPlayer={selectedPlayer}
          lieFound={lieFound}
          lieAttempts={lieAttempts}
          confirmedTrueIds={confirmedTrueIds}
          liePhaseComplete={liePhaseComplete}
          submitted={submitted}
          onSelectLie={id => !liePhaseComplete && updateCurrent({ lieId: id })}
          onSelectPlayer={name => !submitted && updateCurrent({ player: name })}
          onGuessLie={handleGuessLie}
          onSubmit={handleSubmit}
          onGiveUp={handleGiveUp}
          onGenerate={handleGenerate}
          onPlayerPuzzle={handlePlayerPuzzle}
          generating={generating}
          currentScore={currentScore}
        />
        )}
      </main>
    </div>
  )
}

export default App


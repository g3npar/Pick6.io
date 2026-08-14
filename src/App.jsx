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

function App() {
  const [screen,       setScreen]       = useState('daily')
  const [mode,         setMode]         = useState('classic') // 'classic' | 'current'
  const [puzzles,      setPuzzles]      = useState(null)
  const [generating,   setGenerating]   = useState(false)
  const [puzzleIndex,  setPuzzleIndex]  = useState(0)
  const [puzzleStates, setPuzzleStates] = useState({})

  // Load puzzles whenever mode changes or on mount
  useEffect(() => {
    if (screen !== 'daily') return
    setPuzzles(null)
    setPuzzleStates({})
    setPuzzleIndex(0)
    const url = mode === 'current' ? `${API}/puzzle/today/current` : `${API}/puzzle/today`
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => {
        const arr = Array.isArray(p) ? p : [p]
        setPuzzles(arr); preloadLogos(arr)
      })
      .catch(err => console.error('Failed to load puzzles:', err))
  }, [mode, screen])

  const handleGenerate = () => {
    if (mode === 'current') return  // no random gen for current mode
    setGenerating(true)
    fetch(`${API}/puzzle/generate`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => { setPuzzles(p); setPuzzleStates({}); setPuzzleIndex(0); preloadLogos(p) })
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

  const puzzle       = puzzles[puzzleIndex]
  const curState     = puzzleStates[puzzleIndex] || {}
  const selectedLieId  = curState.lieId  ?? null
  const selectedPlayer = curState.player ?? ''
  const submitted      = curState.submitted ?? false

  const updateCurrent = updates =>
    setPuzzleStates(prev => ({ ...prev, [puzzleIndex]: { ...(prev[puzzleIndex] || {}), ...updates } }))

  const handleSubmit = () => {
    if (!selectedLieId || !selectedPlayer) return
    const next = { ...puzzleStates, [puzzleIndex]: { ...(puzzleStates[puzzleIndex] || {}), submitted: true } }
    setPuzzleStates(next)
  }

  const handleGiveUp = () => {
    const next = { ...puzzleStates, [puzzleIndex]: { ...(puzzleStates[puzzleIndex] || {}), submitted: true } }
    setPuzzleStates(next)
  }

  const completedIndices = Object.entries(puzzleStates)
    .filter(([, s]) => s.submitted)
    .map(([idx]) => Number(idx))

  const finalResults = Array.from({ length: PUZZLE_COUNT }, (_, i) => {
    const s = puzzleStates[i]
    if (!s?.submitted) return null
    return {
      playerCorrect: (s.player ?? '').trim().toLowerCase() === puzzles[i].playerName.toLowerCase(),
      lieCorrect:    s.lieId === puzzles[i].falseFactId,
    }
  })

  const puzzleResults = {}
  finalResults.forEach((r, i) => {
    if (!r) return
    const pts = (r.playerCorrect ? 1 : 0) + (r.lieCorrect ? 1 : 0)
    puzzleResults[i] = pts === 2 ? 'perfect' : pts === 1 ? 'partial' : 'wrong'
  })

  const currentScore = finalResults.reduce((sum, r) => sum + (r ? (r.playerCorrect ? 4 : 0) + (r.playerCorrect && r.lieCorrect ? 6 : 0) : 0), 0)

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
      .then(p => { setPuzzles([p]); setPuzzleStates({}); setPuzzleIndex(0); preloadLogos([p]) })
      .catch(err => alert(`Could not build puzzle: ${err.message}`))
      .finally(() => setGenerating(false))
  }

  const navigate = newIdx => setPuzzleIndex(((newIdx % puzzles.length) + puzzles.length) % puzzles.length)

  return (
    <div className="app">
      <Header screen={screen} onNav={setScreen} />
      <main className="main-content">
        {screen === 'how-to-play' && <HowToPlay />}
        {screen === 'archive'     && <ComingSoon title="Archive" />}
        {screen === 'leaderboard' && <ComingSoon title="Leaderboard" />}
        {screen === 'daily'       && (
          <>
            {/* Mode toggle */}
            <div className="mode-toggle">
              <button
                className={`mode-btn${mode === 'classic' ? ' mode-btn--active' : ''}`}
                onClick={() => setMode('classic')}
              >3 Eras</button>
              <button
                className={`mode-btn${mode === 'current' ? ' mode-btn--active' : ''}`}
                onClick={() => setMode('current')}
              >Experimental</button>
            </div>
        <GameBoard
          puzzle={puzzle}
          puzzleNumber={puzzleIndex + 1}
          puzzleIndex={puzzleIndex}
          totalPuzzles={puzzles.length}
          completedIndices={completedIndices}
          puzzleResults={puzzleResults}
          selectedLieId={selectedLieId}
          selectedPlayer={selectedPlayer}
          submitted={submitted}
          onSelectLie={id => !submitted && updateCurrent({ lieId: id })}
          onSelectPlayer={name => !submitted && updateCurrent({ player: name })}
          onSubmit={handleSubmit}
          onGiveUp={handleGiveUp}
          onNext={() => navigate(puzzleIndex + 1)}
          onPrev={() => navigate(puzzleIndex - 1)}
          onGoTo={setPuzzleIndex}
          onGenerate={mode === 'classic' ? handleGenerate : null}
          onPlayerPuzzle={mode === 'classic' ? handlePlayerPuzzle : null}
          generating={generating}
          currentScore={currentScore}
        />
          </>
        )}
      </main>
    </div>
  )
}

export default App


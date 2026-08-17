import { useState, useEffect } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import GameBoard from './components/GameBoard'
import HowToPlay from './components/HowToPlay'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsOfService from './components/TermsOfService'
import Leaderboard from './components/Leaderboard'
import Archive from './components/Archive'
import Admin from './components/Admin'
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
  const [user,         setUser]         = useState(null)
  // Date of the real released daily puzzle currently loaded, only these save. Null means practice mode.
  const [playingDate, setPlayingDate]   = useState(null)
  const [resultSaved, setResultSaved]   = useState(false)

  useEffect(() => {
    fetch(`${API}/puzzle/today/current`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => { const arr = [p]; setPuzzles(arr); setPlayingDate(p.date); preloadLogos(arr) })
      .catch(err => console.error('Failed to load puzzle:', err))

    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ user }) => setUser(user))
      .catch(() => {})
  }, [])

  const handleSignedIn = u => setUser(u)
  const handleSignOut = () => {
    fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => setUser(null))
  }

  const handleGenerate = () => {
    setGenerating(true)
    fetch(`${API}/puzzle/today/current?fresh=${Date.now()}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => { setPuzzles([p]); setPuzzleStates({}); setPlayingDate(null); setResultSaved(false); preloadLogos([p]) })
      .catch(() => {})
      .finally(() => setGenerating(false))
  }

  // Loads a past date from the Archive so it can actually be played.
  const handlePlayArchiveDate = date => {
    setGenerating(true)
    fetch(`${API}/puzzle/date/${date}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => {
          try { const d = JSON.parse(t); throw new Error(d.error || `Server error ${r.status}`) }
          catch { throw new Error(`Could not load ${date} (${r.status})`) }
        })
        return r.json()
      })
      .then(p => { setPuzzles([p]); setPuzzleStates({}); setPlayingDate(p.date); setResultSaved(false); preloadLogos([p]); setScreen('daily') })
      .catch(err => alert(`Could not load puzzle: ${err.message}`))
      .finally(() => setGenerating(false))
  }

  if (!puzzles) {
    return (
      <div className="app">
        <Header screen={screen} onNav={setScreen} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} />
        <main className="main-content" style={{ display: 'flex', justifyContent: 'center', marginTop: '6rem' }}>
          {screen === 'daily'       && <p style={{ opacity: 0.5 }}>Loading puzzles…</p>}
          {screen === 'how-to-play' && <HowToPlay />}
          {screen === 'archive'     && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
          {screen === 'leaderboard' && <Leaderboard />}
          {screen === 'privacy'     && <PrivacyPolicy />}
          {screen === 'terms'       && <TermsOfService />}
          {screen === 'admin'       && <Admin />}
        </main>
        <Footer onNav={setScreen} />
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
      // Reveal the wedge the player actually guessed as true (they were wrong to call it a lie)
      updateCurrent({
        lieAttempts: newAttempts,
        confirmedTrueIds: confirmedTrueIds.includes(selectedLieId)
          ? confirmedTrueIds
          : [...confirmedTrueIds, selectedLieId],
        lieId: null,
      })
    }
  }

  // Player name submit (only available after lie phase)
  const handleSubmit = () => {
    if (!selectedPlayer || !liePhaseComplete) return
    updateCurrent({ submitted: true })
    saveResult({ finalLieId: selectedLieId, finalAttempts: lieAttempts, finalPlayerGuess: selectedPlayer })
  }

  const handleGiveUp = () => {
    updateCurrent({ lieAttempts: 3, submitted: true })
    saveResult({ finalLieId: selectedLieId, finalAttempts: 3, finalPlayerGuess: selectedPlayer })
  }

  const playerCorrect = submitted && normName(selectedPlayer) === normName(puzzle.playerName)
  const lieScore   = submitted ? (lieFound ? Math.max(1, 3 - lieAttempts) : 0) : 0
  const playerScore = submitted && playerCorrect ? 3 : 0
  const currentScore = lieScore + playerScore

  const completedIndices = submitted ? [0] : []
  const puzzleResults = {}

  // Only fires once for a real released daily puzzle, practice replays never touch the leaderboard.
  const saveResult = ({ finalLieId, finalAttempts, finalPlayerGuess }) => {
    if (!user || !playingDate || resultSaved) return
    setResultSaved(true)
    fetch(`${API}/puzzle/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        puzzleDate: playingDate,
        selectedLieId: finalLieId,
        lieAttempts: finalAttempts,
        playerGuess: finalPlayerGuess,
      }),
    }).catch(() => {})
  }

  const handlePlayerPuzzle = ({ name, draftYear }) => {
    setGenerating(true)
    const params = { name, ...(draftYear ? { draftYear } : {}) }
    fetch(`${API}/puzzle/player?${new URLSearchParams(params)}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => {
          try { const d = JSON.parse(t); throw new Error(d.error || `Server error ${r.status}`) }
          catch { throw new Error(`Player not found or server error (${r.status})`) }
        })
        return r.json()
      })
      .then(p => { setPuzzles([p]); setPuzzleStates({}); setPlayingDate(null); setResultSaved(false); preloadLogos([p]) })
      .catch(err => alert(`Could not build puzzle: ${err.message}`))
      .finally(() => setGenerating(false))
  }

  return (
    <div className="app">
      <Header screen={screen} onNav={setScreen} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} />
      <main className="main-content">
        {screen === 'how-to-play' && <HowToPlay />}
        {screen === 'archive'     && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
        {screen === 'leaderboard' && <Leaderboard />}
        {screen === 'privacy'     && <PrivacyPolicy />}
        {screen === 'terms'       && <TermsOfService />}
        {screen === 'admin'       && <Admin />}
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
      <Footer onNav={setScreen} />
    </div>
  )
}

export default App


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
import SignInPrompt from './components/SignInPrompt'
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
  const [screen, setScreen] = useState('daily')
  const [user,   setUser]   = useState(null)

  // Today's daily puzzle lives in its own slot, separate from whatever the user
  // opens from the Archive, so switching back to Daily can't show stale content.
  const [todayPuzzle,      setTodayPuzzle]      = useState(null)
  const [todayState,       setTodayState]       = useState({})
  const [todayResultSaved, setTodayResultSaved] = useState(false)

  const [archivePuzzle,      setArchivePuzzle]      = useState(null)
  const [archiveState,       setArchiveState]       = useState({})
  const [archiveResultSaved, setArchiveResultSaved] = useState(false)

  // True while showing a puzzle opened from the Archive tab, so the board replaces
  // the archive list in place instead of jumping the nav over to Daily.
  const [viewingArchivePuzzle, setViewingArchivePuzzle] = useState(false)

  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [pendingResult, setPendingResult] = useState(null)
  const [totalScore, setTotalScore] = useState(null)

  // Whichever puzzle is actually on screen right now, today's or an archived one.
  const viewingArchive     = screen === 'archive' && viewingArchivePuzzle
  const activePuzzle       = viewingArchive ? archivePuzzle : todayPuzzle
  const activeState        = viewingArchive ? archiveState : todayState
  const setActiveState     = viewingArchive ? setArchiveState : setTodayState
  const activeResultSaved  = viewingArchive ? archiveResultSaved : todayResultSaved
  const setActiveResultSaved = viewingArchive ? setArchiveResultSaved : setTodayResultSaved
  const activePlayingDate  = activePuzzle?.date ?? null

  // Any real navigation (nav link, logo, footer) leaves archive-viewing mode.
  const handleNav = s => { setScreen(s); setViewingArchivePuzzle(false) }

  // Rebuilds the finished-board state from a server-saved result, so a refresh doesn't lose it.
  // Trusts the server's stored playerCorrect rather than re-comparing text, since older saved
  // results predate the playerGuess column and would otherwise show as wrong on restore.
  const restoredState = result => result
    ? {
        player: result.playerGuess || '', playerCorrect: result.playerCorrect,
        lieFound: result.lieFound, lieAttempts: result.lieAttempts, submitted: true,
      }
    : {}

  useEffect(() => {
    fetch(`${API}/puzzle/today/current`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => {
        setTodayPuzzle(p)
        setTodayResultSaved(!!p.result); setTodayState(restoredState(p.result))
        preloadLogos([p])
      })
      .catch(err => console.error('Failed to load puzzle:', err))

    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ user }) => { setUser(user); if (user) fetchTotalScore() })
      .catch(() => {})
  }, [])

  const fetchTotalScore = () => {
    fetch(`${API}/user/total-score`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTotalScore(d.totalScore))
      .catch(() => {})
  }

  // Sends a finished result to the server, called directly or after a sign-in prompt.
  const postResult = ({ finalLieId, finalAttempts, finalPlayerGuess }) => {
    setActiveResultSaved(true)
    fetch(`${API}/puzzle/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        puzzleDate: activePlayingDate,
        selectedLieId: finalLieId,
        lieAttempts: finalAttempts,
        playerGuess: finalPlayerGuess,
      }),
    }).then(r => { if (r.ok) fetchTotalScore() }).catch(() => {})
  }

  // Saves a finished puzzle's result, prompting sign-in first if the player isn't logged in.
  const saveResult = payload => {
    if (!activePlayingDate || activeResultSaved) return
    if (!user) { setPendingResult(payload); setShowSignInPrompt(true); return }
    postResult(payload)
  }

  const handleSignedIn = u => {
    setUser(u)
    setShowSignInPrompt(false)
    fetchTotalScore()
    if (pendingResult) { postResult(pendingResult); setPendingResult(null) }
  }
  const handleSignOut = () => {
    fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => setUser(null))
  }
  const handleUserUpdated = u => setUser(u)

  // Loads a past date from the Archive so it can actually be played.
  const handlePlayArchiveDate = date => {
    fetch(`${API}/puzzle/date/${date}`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) return r.text().then(t => {
          try { const d = JSON.parse(t); throw new Error(d.error || `Server error ${r.status}`) }
          catch { throw new Error(`Could not load ${date} (${r.status})`) }
        })
        return r.json()
      })
      .then(p => {
        setArchivePuzzle(p)
        setArchiveResultSaved(!!p.result); setArchiveState(restoredState(p.result))
        preloadLogos([p]); setViewingArchivePuzzle(true)
      })
      .catch(err => alert(`Could not load puzzle: ${err.message}`))
  }

  if (!todayPuzzle) {
    return (
      <div className="app">
        <Header screen={screen} onNav={handleNav} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} onUserUpdated={handleUserUpdated} />
        <main className="main-content" style={{ display: 'flex', justifyContent: 'center', marginTop: '6rem' }}>
          {screen === 'daily'       && <p style={{ opacity: 0.5 }}>Loading puzzles…</p>}
          {screen === 'how-to-play' && <HowToPlay />}
          {screen === 'archive'     && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
          {screen === 'leaderboard' && <Leaderboard />}
          {screen === 'privacy'     && <PrivacyPolicy />}
          {screen === 'terms'       && <TermsOfService />}
          {screen === 'admin'       && <Admin />}
        </main>
        <Footer onNav={handleNav} />
      </div>
    )
  }

  const showBoard = (screen === 'daily' && todayPuzzle) || (viewingArchive && archivePuzzle)
  const puzzle    = activePuzzle

  const curState       = activeState
  const selectedLieId  = curState.lieId         ?? null
  const selectedPlayer = curState.player        ?? ''
  const lieFound       = curState.lieFound      ?? false
  const lieAttempts    = curState.lieAttempts   ?? 0
  const confirmedTrueIds = curState.confirmedTrueIds ?? []
  const submitted      = curState.submitted     ?? false   // player name submitted = game over
  const playerCorrect  = submitted && (curState.playerCorrect ?? false)
  const liePhaseComplete = lieFound || lieAttempts >= 3

  const updateCurrent = updates => setActiveState(prev => ({ ...prev, ...updates }))

  // Lie guess: evaluate immediately
  const handleGuessLie = () => {
    if (!selectedLieId || liePhaseComplete || !puzzle) return
    const correct = selectedLieId === puzzle.falseFactId
    if (correct) {
      updateCurrent({ lieFound: true })
    } else {
      const newAttempts = lieAttempts + 1
      // Reveal the fact the player actually guessed as true (they were wrong to call it a lie)
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
    if (!selectedPlayer || !liePhaseComplete || !puzzle) return
    updateCurrent({ submitted: true, playerCorrect: normName(selectedPlayer) === normName(puzzle.playerName) })
    saveResult({ finalLieId: selectedLieId, finalAttempts: lieAttempts, finalPlayerGuess: selectedPlayer })
  }

  const handleGiveUp = () => {
    if (!puzzle) return
    updateCurrent({ lieAttempts: 3, submitted: true, playerCorrect: normName(selectedPlayer) === normName(puzzle.playerName) })
    saveResult({ finalLieId: selectedLieId, finalAttempts: 3, finalPlayerGuess: selectedPlayer })
  }

  const lieScore   = submitted ? (lieFound ? Math.max(1, 3 - lieAttempts) : 0) : 0
  const playerScore = submitted && playerCorrect ? 3 : 0
  const currentScore = lieScore + playerScore

  const completedIndices = submitted ? [0] : []
  const puzzleResults = {}

  return (
    <div className="app">
      <Header screen={screen} onNav={handleNav} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} onUserUpdated={handleUserUpdated} />
      <main className="main-content">
        {screen === 'how-to-play' && <HowToPlay />}
        {screen === 'archive' && !viewingArchivePuzzle && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
        {screen === 'leaderboard' && <Leaderboard />}
        {screen === 'privacy'     && <PrivacyPolicy />}
        {screen === 'terms'       && <TermsOfService />}
        {screen === 'admin'       && <Admin />}
        {showBoard && puzzle && (
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
          playerCorrect={playerCorrect}
          onSelectLie={id => !liePhaseComplete && updateCurrent({ lieId: id })}
          onSelectPlayer={name => !submitted && updateCurrent({ player: name })}
          onGuessLie={handleGuessLie}
          onSubmit={handleSubmit}
          onGiveUp={handleGiveUp}
          currentScore={currentScore}
          totalScore={totalScore}
        />
        )}
      </main>
      <Footer onNav={handleNav} />
      {showSignInPrompt && (
        <SignInPrompt onSignedIn={handleSignedIn} onDismiss={() => setShowSignInPrompt(false)} />
      )}
    </div>
  )
}

export default App

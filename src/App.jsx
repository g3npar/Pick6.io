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
import WheelSpinner from './components/WheelSpinner'
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

  // Rebuilds the board state from what the server knows for this date: a finished result
  // takes priority, otherwise any in-progress lie-guessing state restores where a refresh
  // (or a fresh sign-in) left off, so nothing already done is ever lost.
  const restoredState = (result, progress) => {
    if (result) {
      return {
        player: result.playerGuess || '', playerCorrect: result.playerCorrect,
        lieFound: result.lieFound, lieAttempts: result.lieAttempts, submitted: true,
      }
    }
    if (progress) {
      return {
        lieFound: progress.lieFound, lieAttempts: progress.lieAttempts,
        confirmedTrueIds: progress.wrongIds || [],
      }
    }
    return {}
  }

  // (Re)loads today's puzzle exactly as the current session (signed in or not) sees it —
  // called on mount, and again after sign-in/sign-out so the board updates instantly.
  const loadTodayPuzzle = () => {
    fetch(`${API}/puzzle/today/current`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => {
        setTodayPuzzle(p)
        setTodayResultSaved(!!p.result); setTodayState(restoredState(p.result, p.progress))
        preloadLogos([p])
      })
      .catch(err => console.error('Failed to load puzzle:', err))
  }

  useEffect(() => {
    loadTodayPuzzle()

    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ user }) => setUser(user))
      .catch(() => {})
  }, [])

  // Sends a finished result to the server. Works whether signed in or not — the server always
  // returns an accurate, self-verified verdict; it just doesn't persist (`saved: false`) until
  // the player is actually signed in, at which point the sign-in prompt re-fires this call.
  const postResult = ({ finalLieId, finalAttempts, finalPlayerGuess }) => {
    if (!activePlayingDate) return
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
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (data.saved) setActiveResultSaved(true)
        setActiveState(prev => ({
          ...prev, submitted: true,
          playerCorrect: data.playerCorrect, lieFound: data.lieFound, lieAttempts: data.lieAttempts,
        }))
        const setPuzzleFn = viewingArchive ? setArchivePuzzle : setTodayPuzzle
        setPuzzleFn(prev => prev && ({
          ...prev, playerName: data.playerName, falseFactId: data.falseFactId,
          trueText: data.trueText, falseExplanation: data.falseExplanation,
          headshotUrl: data.headshotUrl,
        }))
        if (!data.saved) { setPendingResult({ finalLieId, finalAttempts, finalPlayerGuess }); setShowSignInPrompt(true) }
      })
      .catch(() => {})
  }

  // Saves a finished puzzle's result. Always fires immediately for instant feedback/reveal;
  // postResult itself prompts sign-in if that's what's needed to actually persist it.
  const saveResult = payload => {
    if (!activePlayingDate || activeResultSaved) return
    postResult(payload)
  }

  const handleSignedIn = u => {
    setUser(u)
    setShowSignInPrompt(false)
    if (pendingResult) {
      postResult(pendingResult)
      setPendingResult(null)
    } else {
      // Not mid-submission — this account may already have progress or a finished
      // result for today (or the archive date on screen), so refresh to show it now.
      loadTodayPuzzle()
      if (viewingArchivePuzzle && archivePuzzle?.date) handlePlayArchiveDate(archivePuzzle.date)
    }
  }
  const handleSignOut = () => {
    fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        setUser(null)
        // Revert to a clean logged-out view instead of still showing this account's board.
        setTodayResultSaved(false); setTodayState({})
        setArchiveResultSaved(false); setArchiveState({})
        loadTodayPuzzle()
        if (viewingArchivePuzzle && archivePuzzle?.date) handlePlayArchiveDate(archivePuzzle.date)
      })
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
        setArchiveResultSaved(!!p.result); setArchiveState(restoredState(p.result, p.progress))
        preloadLogos([p]); setViewingArchivePuzzle(true)
      })
      .catch(err => alert(`Could not load puzzle: ${err.message}`))
  }

  if (!todayPuzzle) {
    return (
      <div className="app">
        <Header screen={screen} onNav={handleNav} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} onUserUpdated={handleUserUpdated} />
        <main className="main-content" style={{ display: 'flex', justifyContent: 'center', marginTop: '6rem' }}>
          {screen === 'daily'       && (
            <div className="loading-wheel-wrap">
              <WheelSpinner />
              <span className="loading-label">Loading puzzle…</span>
            </div>
          )}
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
  const liePhaseComplete = lieFound || lieAttempts >= 3 || submitted

  const updateCurrent = updates => setActiveState(prev => ({ ...prev, ...updates }))

  const revealInPuzzle = fields => {
    const setPuzzleFn = viewingArchive ? setArchivePuzzle : setTodayPuzzle
    setPuzzleFn(prev => prev && ({ ...prev, ...fields }))
  }

  // Lie guess: server-verified, since the client is never told the answer up front
  const handleGuessLie = async () => {
    if (!selectedLieId || liePhaseComplete || !puzzle || !activePlayingDate) return
    const factId = selectedLieId
    let data
    try {
      const r = await fetch(`${API}/puzzle/guess-lie`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ puzzleDate: activePlayingDate, factId }),
      })
      data = r.ok ? await r.json() : null
    } catch { data = null }
    if (!data) return

    // Signed-in play is tracked server-side end to end; anonymous play isn't persisted
    // anywhere, so its attempt count is only ever kept locally for display
    const tracked = data.lieAttempts !== null && data.lieAttempts !== undefined
    const newAttempts = tracked ? data.lieAttempts : (data.correct ? lieAttempts : lieAttempts + 1)
    const newWrongIds = tracked
      ? data.wrongIds
      : (data.correct || confirmedTrueIds.includes(factId) ? confirmedTrueIds : [...confirmedTrueIds, factId])

    updateCurrent({
      lieFound: data.lieFound, lieAttempts: newAttempts, confirmedTrueIds: newWrongIds,
      lieId: data.correct ? factId : null,
    })
    if (data.liePhaseComplete && data.falseFactId !== undefined) {
      revealInPuzzle({ falseFactId: data.falseFactId, trueText: data.trueText, falseExplanation: data.falseExplanation })
    }
  }

  // Player name submit (only available after lie phase)
  const handleSubmit = () => {
    if (!selectedPlayer || !liePhaseComplete || !puzzle) return
    saveResult({ finalLieId: selectedLieId, finalAttempts: lieAttempts, finalPlayerGuess: selectedPlayer })
  }

  const handleGiveUp = () => {
    if (!puzzle) return
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

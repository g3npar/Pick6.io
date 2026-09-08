import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import GameBoard from './components/GameBoard'
import HowToPlay from './components/HowToPlay'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsOfService from './components/TermsOfService'
import Leaderboard from './components/Leaderboard'
import Archive from './components/Archive'
import Admin from './components/Admin'
import Profile from './components/Profile'
import SignInPrompt from './components/SignInPrompt'
import WheelSpinner from './components/WheelSpinner'
import { parseFact } from './utils/factDisplay'
import { teamLogo } from './utils/teamLogo'
import { collegeLogo } from './utils/collegeLogo'

const API          = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const PUZZLE_COUNT = 3

// sign in prompt shown once only
const SIGNIN_PROMPT_SEEN_KEY = 'pick6_signin_prompt_seen'
const hasSeenSignInPrompt = () => {
  try { return localStorage.getItem(SIGNIN_PROMPT_SEEN_KEY) === '1' } catch { return false }
}
const markSignInPromptSeen = () => {
  try { localStorage.setItem(SIGNIN_PROMPT_SEEN_KEY, '1') } catch {}
}

// persists nav and in-progress guess across reloads
const SESSION_UI_KEY = 'pick6_session_ui'
const readSessionUI = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_UI_KEY)) || {} } catch { return {} }
}
const writeSessionUI = data => {
  try { sessionStorage.setItem(SESSION_UI_KEY, JSON.stringify(data)) } catch {}
}
const clearSessionUI = () => {
  try { sessionStorage.removeItem(SESSION_UI_KEY) } catch {}
}

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
  const [screen, setScreen] = useState(() => readSessionUI().screen || 'daily')
  const [user,   setUser]   = useState(null)

  // daily puzzle kept separate from archive
  const [todayPuzzle,      setTodayPuzzle]      = useState(null)
  const [todayState,       setTodayState]       = useState({})
  const [todayResultSaved, setTodayResultSaved] = useState(false)

  const [archivePuzzle,      setArchivePuzzle]      = useState(null)
  const [archiveState,       setArchiveState]       = useState({})
  const [archiveResultSaved, setArchiveResultSaved] = useState(false)

  // true when viewing an archive puzzle
  const [viewingArchivePuzzle, setViewingArchivePuzzle] = useState(() => !!readSessionUI().viewingArchivePuzzle)

  // frozen cache snapshot avoids write race
  const initialCachedUI = useRef(readSessionUI())

  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [pendingResult, setPendingResult] = useState(null)

  // puzzle currently on screen
  const viewingArchive     = screen === 'archive' && viewingArchivePuzzle
  const activePuzzle       = viewingArchive ? archivePuzzle : todayPuzzle
  const activeState        = viewingArchive ? archiveState : todayState
  const setActiveState     = viewingArchive ? setArchiveState : setTodayState
  const activeResultSaved  = viewingArchive ? archiveResultSaved : todayResultSaved
  const setActiveResultSaved = viewingArchive ? setArchiveResultSaved : setTodayResultSaved
  const activePlayingDate  = activePuzzle?.date ?? null

  // loading gate keyed by date
  const [logosReadyForDate, setLogosReadyForDate] = useState(null)
  const logosReady = activePuzzle != null && logosReadyForDate === activePuzzle.date
  useEffect(() => {
    if (!activePuzzle) return
    const myDate = activePuzzle.date
    const urls = new Set()
    for (const fact of activePuzzle.facts) {
      const d = parseFact(fact.text)
      if (d.isTeams) d.value.split(', ').forEach(team => { const u = teamLogo(team); if (u) urls.add(u) })
      else if (d.isCollege) { const u = collegeLogo(d.value); if (u) urls.add(u) }
    }
    let cancelled = false
    const finish = () => { if (!cancelled) setLogosReadyForDate(myDate) }
    if (urls.size === 0) { finish(); return }
    let remaining = urls.size
    const settle = () => { remaining -= 1; if (!cancelled && remaining <= 0) finish() }
    urls.forEach(src => {
      const img = new Image()
      img.onload = settle; img.onerror = settle; img.src = src
    })
    // timeout fallback
    const timeout = setTimeout(finish, 4000)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [activePuzzle?.date])

  // nav leaves archive view
  const handleNav = s => { setScreen(s); setViewingArchivePuzzle(false) }

  // rebuild state from server
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

  // loads todays puzzle
  const loadTodayPuzzle = () => {
    fetch(`${API}/puzzle/today/current`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(p => {
        setTodayPuzzle(p)
        setTodayResultSaved(!!p.result)
        // merge cached guess only if same date
        const cachedUI = initialCachedUI.current
        const cachedToday = cachedUI.todayDate === p.date ? (cachedUI.todayState || {}) : {}
        setTodayState({ ...cachedToday, ...restoredState(p.result, p.progress) })
        preloadLogos([p])
      })
      .catch(err => console.error('Failed to load puzzle:', err))
  }

  useEffect(() => {
    loadTodayPuzzle()

    // restore archive puzzle after reload
    const cachedUI = initialCachedUI.current
    if (cachedUI.viewingArchivePuzzle && cachedUI.archiveDate) handlePlayArchiveDate(cachedUI.archiveDate)

    fetch(`${API}/auth/me`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ user }) => setUser(user))
      .catch(() => {})
  }, [])

  // syncs cache for reload
  useEffect(() => {
    writeSessionUI({
      screen,
      viewingArchivePuzzle,
      archiveDate: viewingArchivePuzzle ? (archivePuzzle?.date ?? null) : null,
      todayDate: todayPuzzle?.date ?? null,
      todayState,
      archiveState,
    })
  }, [screen, viewingArchivePuzzle, archivePuzzle?.date, todayPuzzle?.date, todayState, archiveState])

  // sends result to server
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
        if (!data.saved) {
          setPendingResult({ finalLieId, finalAttempts, finalPlayerGuess })
          if (!hasSeenSignInPrompt()) { setShowSignInPrompt(true); markSignInPromptSeen() }
        }
      })
      .catch(() => {})
  }

  // saves finished result
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
      // refresh to show existing progress
      loadTodayPuzzle()
      if (viewingArchivePuzzle && archivePuzzle?.date) handlePlayArchiveDate(archivePuzzle.date)
    }
  }
  const handleSignOut = () => {
    fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        // drop the cached board so the puzzles must be solved again
        clearSessionUI()
        window.location.reload()
      })
  }
  const handleUserUpdated = u => setUser(u)

  const handleAccountDeleted = () => {
    clearSessionUI()
    window.location.reload()
  }

  // loads archive puzzle to play
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
        setArchiveResultSaved(!!p.result)
        // merge cache for same archive date only
        const cachedUI = initialCachedUI.current
        const cachedState = cachedUI.archiveDate === date ? (cachedUI.archiveState || {}) : {}
        setArchiveState({ ...cachedState, ...restoredState(p.result, p.progress) })
        preloadLogos([p]); setViewingArchivePuzzle(true)
      })
      .catch(err => alert(`Could not load puzzle: ${err.message}`))
  }

  // nothing shows until fully loaded
  const dailyPending   = screen === 'daily' && (!todayPuzzle || !logosReady)
  const archivePending = viewingArchive && (!archivePuzzle || !logosReady)
  if (!todayPuzzle || dailyPending || archivePending) {
    return (
      <div className="app">
        <Header screen={screen} onNav={handleNav} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} />
        <main className="main-content" style={{ display: 'flex', justifyContent: 'center', marginTop: '6rem' }}>
          {(dailyPending || archivePending) && (
            <div className="loading-wheel-wrap">
              <WheelSpinner />
              <span className="loading-label">Loading puzzle…</span>
            </div>
          )}
          {screen === 'how-to-play' && <HowToPlay />}
          {screen === 'archive' && !viewingArchivePuzzle && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
          {screen === 'leaderboard' && <Leaderboard />}
          {screen === 'privacy'     && <PrivacyPolicy />}
          {screen === 'terms'       && <TermsOfService />}
          {screen === 'admin'       && <Admin />}
          {screen === 'profile'     && <Profile user={user} onUserUpdated={handleUserUpdated} onDeleted={handleAccountDeleted} />}
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
  const selectedHeadshot = curState.headshot    ?? null
  const lieFound       = curState.lieFound      ?? false
  const lieAttempts    = curState.lieAttempts   ?? 0
  const confirmedTrueIds = curState.confirmedTrueIds ?? []
  const submitted      = curState.submitted     ?? false   // game over
  const playerCorrect  = submitted && (curState.playerCorrect ?? false)
  const gaveUp         = curState.gaveUp        ?? false
  const liePhaseComplete = lieFound || lieAttempts >= 3 || submitted

  const updateCurrent = updates => setActiveState(prev => ({ ...prev, ...updates }))

  const revealInPuzzle = fields => {
    const setPuzzleFn = viewingArchive ? setArchivePuzzle : setTodayPuzzle
    setPuzzleFn(prev => prev && ({ ...prev, ...fields }))
  }

  // server verified lie guess
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

    // anonymous attempts tracked locally only
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

  // player guess submit
  const handleSubmit = () => {
    if (!selectedPlayer || !liePhaseComplete || !puzzle) return
    saveResult({ finalLieId: selectedLieId, finalAttempts: lieAttempts, finalPlayerGuess: selectedPlayer })
  }

  const handleGiveUp = () => {
    if (!puzzle) return
    // give up forfeits unconfirmed lie guess only
    updateCurrent({ gaveUp: true, player: '' })
    saveResult({
      finalLieId: lieFound ? selectedLieId : null,
      finalAttempts: lieFound ? lieAttempts : 3,
      finalPlayerGuess: '',
    })
  }

  const lieScore   = submitted ? (lieFound ? Math.max(1, 3 - lieAttempts) : 0) : 0
  const playerScore = submitted && playerCorrect ? 3 : 0
  const currentScore = lieScore + playerScore

  const completedIndices = submitted ? [0] : []
  const puzzleResults = {}

  return (
    <div className="app">
      <Header screen={screen} onNav={handleNav} user={user} onSignedIn={handleSignedIn} onSignOut={handleSignOut} />
      <main className="main-content">
        {screen === 'how-to-play' && <HowToPlay />}
        {screen === 'archive' && !viewingArchivePuzzle && <Archive user={user} onPlayDate={handlePlayArchiveDate} />}
        {screen === 'leaderboard' && <Leaderboard />}
        {screen === 'privacy'     && <PrivacyPolicy />}
        {screen === 'terms'       && <TermsOfService />}
        {screen === 'admin'       && <Admin />}
        {screen === 'profile'     && <Profile user={user} onUserUpdated={handleUserUpdated} onDeleted={handleAccountDeleted} />}
        {showBoard && puzzle && (
        <GameBoard
          puzzle={puzzle}
          totalPuzzles={1}
          selectedLieId={selectedLieId}
          selectedPlayer={selectedPlayer}
          selectedHeadshot={selectedHeadshot}
          lieFound={lieFound}
          lieAttempts={lieAttempts}
          confirmedTrueIds={confirmedTrueIds}
          liePhaseComplete={liePhaseComplete}
          submitted={submitted}
          playerCorrect={playerCorrect}
          gaveUp={gaveUp}
          onSelectLie={id => !liePhaseComplete && updateCurrent({ lieId: id })}
          onSelectPlayer={(name, headshot) => !submitted && updateCurrent({ player: name, headshot: headshot ?? null })}
          onBackfillHeadshot={headshot => updateCurrent({ headshot })}
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

import { useState, useEffect, useRef } from 'react'
import { shareText, tries, copyText } from '../utils/share'
import { usePercentile, TopPercent, todayNY, anonId } from '../utils/percentile'
import { teamLogo } from '../utils/teamLogo'
import { formatDate } from '../utils/formatDate'
import { DIVISIONS, franchiseName, nickname } from '../utils/franchises'
import WheelSpinner from './WheelSpinner'
import RulesButton from './HowToPlay'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const MAX_ATTEMPTS = 3

// signed out games are kept in the browser, one per day
const STORE_KEY = 'pick6_filmroom_days'
const readStore = date => { try { return JSON.parse(sessionStorage.getItem(STORE_KEY))?.[date] ?? null } catch { return null } }
const writeStore = (date, game) => {
  try {
    const all = JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...all, [date]: game }))
  } catch {}
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status })
  return data
}

// that season's logo
const eraLogo = file => `/logos/nfl/eras/${file}.webp`

const freshGame = clues => ({
  clues, attempts: 0, wrongTeams: [], teamFound: false, teamDone: false, answer: null, result: null,
})

// arrow keys move to the nearest cell in that direction, works for both grids
function moveInGrid(grid, key) {
  const cells = [...grid.querySelectorAll('button:not(:disabled)')]
  if (!cells.length) return
  const cur = cells.includes(document.activeElement) ? document.activeElement : null
  if (!cur) {
    (grid.querySelector('.fr-year-cell--on, .fr-team-cell--on:not(:disabled)') || cells[0]).focus()
    return
  }
  const [dx, dy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key]
  const from = cur.getBoundingClientRect()
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2
  let best = null, bestScore = Infinity
  for (const c of cells) {
    if (c === cur) continue
    const r = c.getBoundingClientRect()
    const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy
    const along = x * dx + y * dy
    if (along < 2) continue
    // prefer staying in the same row/column
    const score = along + Math.abs(x * dy - y * dx) * 3
    if (score < bestScore) { bestScore = score; best = c }
  }
  best?.focus()
}

const ARROWS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']

// every year in one grid, no scrolling
function YearPicker({ years, value, onChange, onSubmit }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const gridRef = useRef(null)
  const btnRef = useRef(null)
  const onKeyDown = e => {
    // Enter on the button guesses what's picked, arrows/Space reopen the grid
    if (e.key === 'Enter' && !open && value && e.target === btnRef.current) {
      e.preventDefault()
      onSubmit?.()
      return
    }
    if (!ARROWS.includes(e.key)) return
    e.preventDefault()
    if (!open) { setOpen(true); requestAnimationFrame(() => gridRef.current && moveInGrid(gridRef.current, e.key)); return }
    if (gridRef.current) moveInGrid(gridRef.current, e.key)
  }

  // 5-7 columns, whichever fills the last row best
  const cols = [7, 6, 5].reduce((best, c) => ((c - years.length % c) % c < (best - years.length % best) % best ? c : best))

  return (
    <div className="fr-year" ref={ref} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={btnRef}
        className={`fr-year-btn${value ? ' fr-year-btn--set' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {value || 'Which year?'}
        <span className="fr-year-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="fr-year-grid" role="listbox" ref={gridRef} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {years.map(y => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={String(y) === String(value)}
              className={`fr-year-cell${String(y) === String(value) ? ' fr-year-cell--on' : ''}`}
              onClick={() => { onChange(String(y)); setOpen(false); btnRef.current?.focus() }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// all 32 teams by division
function TeamPicker({ value, missed, onChange, onSubmit }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const gridRef = useRef(null)
  const btnRef = useRef(null)
  const onKeyDown = e => {
    // Enter on the button guesses what's picked, arrows/Space reopen the grid
    if (e.key === 'Enter' && !open && value && e.target === btnRef.current) {
      e.preventDefault()
      onSubmit?.()
      return
    }
    if (!ARROWS.includes(e.key)) return
    e.preventDefault()
    if (!open) { setOpen(true); requestAnimationFrame(() => gridRef.current && moveInGrid(gridRef.current, e.key)); return }
    if (gridRef.current) moveInGrid(gridRef.current, e.key)
  }

  return (
    <div className="fr-team" ref={ref} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={btnRef}
        className={`fr-year-btn${value ? ' fr-year-btn--set' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="fr-team-picked">
          {value && <img src={teamLogo(franchiseName(value))} alt="" />}
          {value ? franchiseName(value) : 'Search team...'}
        </span>
        <span className="fr-year-caret" aria-hidden="true">▾</span>
      </button>
      {/* always rendered so the logos only load once */}
      <div className="fr-team-grid" hidden={!open} ref={gridRef}>
        {['AFC', 'NFC'].map(conf => (
          <div key={conf} className="fr-conf">
            <span className="fr-conf-label">{conf}</span>
            {DIVISIONS.filter(d => d.conf === conf).map(d => (
              <div key={d.name} className="fr-div">
                <span className="fr-div-label">{d.name[0]}</span>
                {d.teams.map(key => {
                  const out = missed.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`fr-team-cell${key === value ? ' fr-team-cell--on' : ''}${out ? ' fr-team-cell--out' : ''}`}
                      disabled={out}
                      title={out ? `${franchiseName(key)} (already guessed)` : franchiseName(key)}
                      aria-label={franchiseName(key)}
                      onClick={() => { onChange(key); setOpen(false); btnRef.current?.focus() }}
                    >
                      <img src={teamLogo(franchiseName(key))} alt="" width="28" height="28" />
                      <span className={`fr-team-cell-name${nickname(key).length >= 10 ? ' fr-team-cell-name--long' : ''}`}>{nickname(key)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ClueRow({ clue }) {
  return (
    <li className={`fr-row${clue.hidden ? ' fr-row--hidden' : ''}`}>
      <span className="fr-code">00:{String(clue.id).padStart(2, '0')}</span>
      <div className="fr-main">
        <span className="fr-label">{clue.label}</span>
        {clue.hidden ? (
          <span className="fr-value-line">
            <span className="fr-value">?</span>
            <span className="fr-sub">{clue.hint || 'flips on a miss'}</span>
          </span>
        ) : (
          <span className="fr-value-line">
            <span className="fr-value">{clue.value}</span>
            {clue.sublabel && <span className="fr-sub">{clue.sublabel}</span>}
          </span>
        )}
      </div>
    </li>
  )
}

// no date = today, a date = an archive day
export default function FilmRoomBoard({ date = null, signedIn = false }) {
  const [meta, setMeta]         = useState(null)   // { date, number, firstYear, lastYear, signedIn }
  const [game, setGame]         = useState(null)
  const [error, setError]       = useState(null)
  const [busy, setBusy]         = useState(false)
  const [submitting, setSubmitting] = useState(false)   // guess in flight
  const [slow, setSlow]             = useState(false)   // ...and it's slow
  const slowTimer = useRef(null)
  // spinner only on slow connections
  const startSubmit = () => {
    setBusy(true); setSubmitting(true)
    slowTimer.current = setTimeout(() => setSlow(true), 500)
  }
  const endSubmit = () => {
    clearTimeout(slowTimer.current)
    setBusy(false); setSubmitting(false); setSlow(false)
  }
  const [team, setTeam]         = useState(null)   // selected franchise key
  const [year, setYear]         = useState('')
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [shareState, setShareState] = useState('idle')
  const percentile = usePercentile('filmroom', game?.result ? meta?.date : null, game?.result?.score)

  const load = (claimed = false) => {
    setError(null)
    fetch(`${API}/filmroom/${date ? `date/${date}` : 'today'}`, { credentials: 'include' })
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || r.status); return d }))
      .then(d => {
        setMeta({ date: d.date, number: d.number, firstYear: d.firstYear, lastYear: d.lastYear, signedIn: d.signedIn })
        if (d.result) {
          setGame({
            clues: d.clues, attempts: d.result.attempts, wrongTeams: d.result.wrongTeams || [], teamFound: d.result.teamFound,
            teamDone: true, answer: d.answer, result: d.result,
          })
        } else if (d.progress) {
          setGame({
            clues: d.clues, attempts: d.progress.attempts, wrongTeams: d.progress.wrongTeams,
            teamFound: d.progress.teamFound, teamDone: d.progress.teamPhaseComplete, answer: d.answer || null, result: null,
          })
        } else {
          const kept = readStore(d.date)
          // just signed in: save the signed out game, then reload
          if (d.signedIn && !claimed && kept && (kept.result || kept.attempts > 0 || kept.teamFound)) {
            return post('/filmroom/claim', {
              puzzleDate: d.date,
              wrongTeams: kept.wrongTeams,
              team: kept.teamFound ? kept.answer?.franchise : null,
              finished: !!kept.result,
              yearGuess: kept.result?.yearGuess ?? null,
            }).catch(() => {}).then(() => load(true))
          }
          setGame(!d.signedIn && kept ? kept : freshGame(d.clues))
        }
      })
      .catch(err => setError(err.message))
  }

  useEffect(() => { setGame(null); setMeta(null); load() }, [date])
  // reload only when sign in status actually changes
  useEffect(() => {
    if (meta && meta.signedIn !== signedIn) { setGame(null); setMeta(null); load() }
  }, [signedIn])

  useEffect(() => {
    if (meta && game && !meta.signedIn) writeStore(meta.date, game)
  }, [meta, game])

  const puzzleRef = () => ({ puzzleDate: meta.date })

  // reverts confirm state if untouched
  useEffect(() => {
    if (!confirmingGiveUp) return
    const t = setTimeout(() => setConfirmingGiveUp(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingGiveUp])

  // a game left open past midnight still saves to its own day
  const handleError = e => alert(e.message)

  const guessTeam = async () => {
    if (busy || !team) return
    startSubmit()
    try {
      const d = await post('/filmroom/guess-team', { ...puzzleRef(), franchise: team, attempts: game.attempts })
      setGame(g => ({
        ...g, clues: d.clues, attempts: d.attempts, teamFound: d.teamFound, teamDone: d.teamPhaseComplete,
        answer: d.answer || null,
        // signed out: track wrong teams here
        wrongTeams: meta.signedIn ? d.wrongTeams : d.correct ? g.wrongTeams : [...new Set([...g.wrongTeams, team])],
      }))
      setTeam(null)
    } catch (e) {
      handleError(e)
    } finally {
      endSubmit()
    }
  }

  const finish = async giveUp => {
    if (busy) return
    startSubmit()
    try {
      const d = await post('/filmroom/result', giveUp
        ? { ...puzzleRef(), anonId: anonId(), giveUp: true }
        : { ...puzzleRef(), anonId: anonId(), yearGuess: Number(year), teamFound: game.teamFound, attempts: game.attempts })
      setGame(g => ({
        ...g, clues: d.clues, teamDone: true, teamFound: d.teamFound, attempts: d.attempts, answer: d.answer,
        wrongTeams: d.wrongTeams || g.wrongTeams,
        result: { teamFound: d.teamFound, attempts: d.attempts, yearGuess: d.yearGuess,
                  teamScore: d.teamScore, yearScore: d.yearScore, score: d.score, saved: d.saved },
      }))
    } catch (e) {
      handleError(e)
    } finally {
      endSubmit()
    }
  }

  const handleGiveUpClick = () => {
    if (confirmingGiveUp) { setConfirmingGiveUp(false); finish(true) }
    else setConfirmingGiveUp(true)
  }

  const handleShare = async () => {
    const r = game.result
    const text = shareText(`Film Room #${meta.number}`, [
      [tries(r.teamFound, r.attempts), 'Team', r.teamScore, 3],
      [r.yearScore === 3 ? '🟩' : r.yearScore > 0 ? '🟨' : '🟥', 'Year', r.yearScore, 3],
    ], r.score, percentile?.top)
    setShareState(await copyText(text) ? 'copied' : 'failed')
    setTimeout(() => setShareState('idle'), 1800)
  }

  if (error) {
    return (
      <div className="loading-wheel-wrap" style={{ marginTop: '6rem' }}>
        <span className="loading-label">Couldn't load Film Room ({error})</span>
        <button className="header-icon-btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!meta || !game) {
    return (
      <div className="loading-wheel-wrap" style={{ marginTop: '6rem' }}>
        <WheelSpinner />
        <span className="loading-label">Loading Film Room…</span>
      </div>
    )
  }

  const { result, answer } = game
  const years = []
  for (let y = meta.firstYear; y <= meta.lastYear; y++) years.push(y)
  // a give up has no guess to show
  const yearWrong = result && result.yearScore !== 3
  const gotSomethingWrong = result && result.yearGuess != null && (!result.teamFound || yearWrong)
  // perfect games too, all checkmarks
  const showingGuess = result && result.yearGuess != null && !(gotSomethingWrong && showAnswer)
  // last team guessed
  const guessedTeam = result && (result.teamFound ? answer.franchise : game.wrongTeams[game.wrongTeams.length - 1])
  const guessLogo = result && (result.teamFound
    ? answer.logo && eraLogo(answer.logo)
    : guessedTeam && teamLogo(franchiseName(guessedTeam)))
  const yearMark = result && (result.yearScore === 3 ? '✓' : result.yearScore > 0 ? '≈' : '✗')
  const scoreTier = result?.score === 6 ? 'good' : result?.score === 0 ? 'bad' : 'mid'
  const top    = game.clues.slice(0, 3)
  const bottom = game.clues.slice(3)

  return (
    <div className="puzzle-game">
      <div className="circle-nav-row">

        <div className="circle-side circle-side--left">
          <span className="puzzle-date-big">{formatDate(meta.date)}</span>
          <span className="puzzle-number-row">
            <span className="puzzle-number-label">{`Film Room #${meta.number}`}</span>
            <RulesButton game="filmroom" />
          </span>
        </div>

        <div className="fr-sheet">
          <div className="fr-sheet-head">
            <span className="fr-hole" aria-hidden="true" />
            <span className="fr-sheet-title">FILM ROOM</span>
            <span className="fr-sheet-no">{`NO. ${meta.number}`}</span>
            <span className="fr-hole" aria-hidden="true" />
          </div>

          <ol className="fr-rows">
            {top.map(c => <ClueRow key={c.id} clue={c} />)}

            {/* where you guess */}
            <li className={`fr-call${result ? (result.score === 6 ? ' fr-call--good' : ' fr-call--bad') : ''}`}>
              <span className="fr-code fr-code--call">▶</span>

              {!game.teamDone ? (
                <div className="fr-call-body">
                  <div className="fr-call-top">
                    <span className="fr-call-label">THE TEAM</span>
                    <div className="fr-attempts" title={`${MAX_ATTEMPTS - game.attempts} attempts left`}>
                      <span className="attempt-label fr-attempts-label">ATTEMPTS</span>
                      <div className="attempt-dots">
                        {[0, 1, 2].map(i => (
                          <span key={i} className={`attempt-dot${i < game.attempts ? ' attempt-dot--wrong' : ''}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="fr-call-inputs">
                    <TeamPicker value={team} missed={game.wrongTeams} onChange={setTeam} onSubmit={guessTeam} />
                    <button className={`circle-guess-btn fr-btn${submitting ? ' fr-btn--busy' : ''}`} onClick={guessTeam} disabled={!team || busy} aria-busy={submitting}>
                      {slow ? <><span className="fr-spinner" aria-hidden="true" />Checking…</> : team ? 'GUESS TEAM →' : 'Pick a team'}
                    </button>
                  </div>
                </div>
              ) : !result ? (
                <div className="fr-call-body">
                  <div className="fr-call-top">
                    <span className="fr-call-label">THE YEAR</span>
                    <span className={`fr-team-chip ${game.teamFound ? 'fr-team-chip--found' : 'fr-team-chip--missed'}`}>
                      {answer && <img src={teamLogo(answer.name)} alt="" />}
                      {answer?.name}
                      <span className={`fr-mark fr-mark--${game.teamFound ? 'right' : 'wrong'}`}>{game.teamFound ? '✓' : '✗'}</span>
                    </span>
                  </div>
                  <div className="fr-call-inputs">
                    <YearPicker years={years} value={year} onChange={setYear} onSubmit={() => finish(false)} />
                    <button className={`circle-guess-btn fr-btn${submitting ? ' fr-btn--busy' : ''}`} onClick={() => finish(false)} disabled={!year || busy} aria-busy={submitting}>
                      {slow ? <><span className="fr-spinner" aria-hidden="true" />Checking…</> : year ? 'LOCK IN →' : 'Pick a year'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="fr-answer">
                  {showingGuess ? (
                    <>
                      {/* your guess, Show Correct Answer swaps in the answer */}
                      {/* that season's logo */}
                      {guessLogo
                        ? <img className="fr-answer-logo" src={guessLogo} alt="" />
                        : <span className="fr-answer-logo" />}
                      <div className="fr-answer-text">
                        {gotSomethingWrong && <span className="fr-answer-lead">You guessed</span>}
                        <span className="fr-answer-line">
                          <span className="fr-answer-year">{result.yearGuess}</span>
                          <span className={`fr-mark fr-mark--${yearWrong ? 'wrong' : 'right'}`}>{yearWrong ? '✗' : '✓'}</span>
                        </span>
                        <span className="fr-answer-line">
                          <span className="fr-answer-name">{result.teamFound ? answer.name : guessedTeam ? franchiseName(guessedTeam) : 'No team'}</span>
                          <span className={`fr-mark fr-mark--${result.teamFound ? 'right' : 'wrong'}`}>{result.teamFound ? '✓' : '✗'}</span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {answer.logo && <img className="fr-answer-logo" src={eraLogo(answer.logo)} alt="" />}
                      <div className="fr-answer-text">
                        {gotSomethingWrong && <span className="fr-answer-lead fr-answer-lead--correct">Correct answer</span>}
                        <span className="fr-answer-year">{answer.season}</span>
                        <span className="fr-answer-name">{answer.name}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>

            {bottom.map(c => <ClueRow key={c.id} clue={c} />)}
          </ol>
        </div>

        <div className="circle-side circle-side--right">
          {!result && (
            <button
              className={`give-up-btn${confirmingGiveUp ? ' give-up-btn--confirm' : ''}`}
              onClick={handleGiveUpClick}
            >
              {confirmingGiveUp ? 'Are you sure?' : 'Give Up'}
            </button>
          )}
          {result && (
            <div className="result-table">
              <div className="result-table-row">
                <span className="result-table-label">
                  <span className={`result-table-check ${result.teamFound ? 'result-table-check--correct' : 'result-table-check--wrong'}`}>
                    {result.teamFound ? '✓' : '✗'}
                  </span>
                  Team
                  {result.teamFound && <span className="result-table-attempts">used {result.attempts + 1}/{MAX_ATTEMPTS} attempts</span>}
                </span>
                <span className="result-table-value">+{result.teamScore}</span>
              </div>
              <div className="result-table-row">
                <span className="result-table-label">
                  <span className={`result-table-check ${result.yearScore > 0 ? 'result-table-check--correct' : 'result-table-check--wrong'}`}>
                    {yearMark}
                  </span>
                  Year
                  {result.yearGuess && <span className="result-table-attempts">guessed {result.yearGuess}</span>}
                </span>
                <span className="result-table-value">+{result.yearScore}</span>
              </div>
              <div className="result-table-divider" />
              <div className={`result-table-row result-table-total result-table-total--${scoreTier}`}>
                <span className="result-table-label">Total</span>
                <span className="result-table-value">{result.score}/6</span>
              </div>
              <TopPercent result={percentile} today={meta.date === todayNY()} />
              {/* 0/6 is a Pick 6 */}
              {scoreTier === 'bad' && (
                <>
                  <p className="result-table-pick6">You scored a Pick 6.</p>
                  <p className="result-table-pick6">Better luck next time.</p>
                </>
              )}
              {gotSomethingWrong && (
                <button className="result-table-reveal-btn" onClick={() => setShowAnswer(v => !v)}>
                  {showAnswer ? 'Hide Correct Answer' : 'Show Correct Answer'}
                </button>
              )}
              {!meta.signedIn && <p className="fr-signin-hint">Sign in to save your Film Room results.</p>}
              <div className="share-row">
                <button className="share-btn" onClick={handleShare}>Share Result</button>
                {shareState === 'copied' && <span className="share-toast">Copied!</span>}
                {shareState === 'failed' && <span className="share-toast share-toast--failed">Couldn't copy — pick6.io</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

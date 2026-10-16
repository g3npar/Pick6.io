import { useState, useEffect, useRef } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'
import RulesButton from './HowToPlay'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const MAX_ATTEMPTS = 3

// signed out games live in the browser, one per day so the archive doesn't wipe today's
const STORE_KEY = 'pick6_lineup_days'
const readStore = date => { try { return JSON.parse(sessionStorage.getItem(STORE_KEY))?.[date] ?? null } catch { return null } }
const writeStore = (date, slots) => {
  try {
    const all = JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...all, [date]: slots }))
  } catch {}
}
// only what the server needs back, not the images. the team you got goes along so
// the game can move to your account if you sign in later (the server checks it)
const slimSlots = slots => slots.map(({ attempts, wrong, solved, answer }) => ({ attempts, wrong, solved, ...(solved ? { team: answer?.team } : {}) }))

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

// the server sends the file with its extension (svg for current logos, webp for old ones)
const fullLogo = logo => `/logos/leagues/${logo}`
// the tabs only say "OLD", so the search box says which league to type
const searchHint = l => l.league === 'ncaa' ? 'Type a college team…' : `Type ${l.old ? 'an old' : 'an'} ${l.label} team…`

// type a few letters, pick from that league's teams
function TeamSearch({ teams, missed, onPick, disabled, hint }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)   // highlighted match, moved with the arrow keys
  const ref = useRef(null)
  const term = q.trim().toLowerCase()
  const matches = term ? teams.filter(t => t.name.toLowerCase().includes(term)).slice(0, 6) : []

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = t => { setQ(''); setOpen(false); setActive(-1); onPick(t.id) }
  const first = matches.find(t => !missed.includes(t.id))

  // up and down skip teams you already missed on this logo
  const move = step => {
    const ok = matches.map((t, i) => (missed.includes(t.id) ? -1 : i)).filter(i => i >= 0)
    if (!ok.length) return
    const at = ok.indexOf(active)
    setActive(at < 0 ? (step > 0 ? ok[0] : ok[ok.length - 1]) : ok[(at + step + ok.length) % ok.length])
    setOpen(true)
  }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1) }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1) }
    else if (e.key === 'Enter') {
      const t = matches[active] && !missed.includes(matches[active].id) ? matches[active] : first
      if (t) pick(t)
    }
  }

  return (
    <div className="ll-search" ref={ref}>
      <input
        className="ll-search-input"
        value={q}
        placeholder={hint}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search teams"
      />
      {open && matches.length > 0 && (
        <ul className="ll-search-list" role="listbox">
          {matches.map((t, i) => {
            const out = missed.includes(t.id)
            return (
              <li key={t.id}>
                <button
                  className={`ll-search-item${out ? ' ll-search-item--out' : ''}${i === active ? ' ll-search-item--active' : ''}`}
                  disabled={out}
                  onMouseEnter={() => !out && setActive(i)}
                  onClick={() => pick(t)}
                >
                  {t.name}{out && <span className="ll-search-miss">✗</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// no date means today's puzzle, a date is a day from the archive
// no date means today's puzzle, a date is a day from the archive. signedIn reloads
// the board when you sign in, so a game you played signed out moves to your account
export default function LineupBoard({ date = null, signedIn = false }) {
  const [data, setData]     = useState(null)   // the /lineup/day response
  const [error, setError]   = useState(null)
  const [current, setCurrent] = useState(0)
  const [busy, setBusy]     = useState(false)
  const [slow, setSlow]     = useState(false)
  const slowTimer = useRef(null)
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false)
  const [shareState, setShareState] = useState('idle')

  const firstOpen = slots => Math.max(0, slots.findIndex(s => !s.done))

  const load = () => {
    setError(null)
    // the server can't know a signed out player's progress, so send what the browser kept.
    // for today the date isn't known until the first answer, so that can take a second trip
    post('/lineup/day', { date, local: date ? readStore(date) : null })
      .then(d => {
        // signed in with nothing saved yet, the server takes the browser's game (after checking it)
        const nothingSaved = d.slots.every(st => !st.attempts && !st.solved)
        const kept = !date && (!d.signedIn || nothingSaved) && readStore(d.date)
        return kept ? post('/lineup/day', { date: d.date, local: kept }) : d
      })
      .then(d => { setData(d); setCurrent(firstOpen(d.slots)) })
      .catch(err => setError(err.message))
  }

  useEffect(() => { setData(null); load() }, [date])
  // the board loads before the site knows you're signed in, so only reload when that
  // actually differs from what the server said (you just signed in or out)
  useEffect(() => {
    if (data && data.signedIn !== signedIn) { setData(null); load() }
  }, [signedIn])

  useEffect(() => {
    if (data && !data.signedIn) writeStore(data.date, slimSlots(data.slots))
  }, [data])

  // "Are you sure?" belongs to the logo it was asked on
  useEffect(() => { setConfirmingGiveUp(false) }, [current])

  // reverts confirm state if untouched
  useEffect(() => {
    if (!confirmingGiveUp) return
    const t = setTimeout(() => setConfirmingGiveUp(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingGiveUp])

  const send = async body => {
    if (busy) return
    setBusy(true)
    // the spinner only shows on a slow connection
    slowTimer.current = setTimeout(() => setSlow(true), 500)
    try {
      const d = await post('/lineup/guess', { date: data.date, local: slimSlots(data.slots), ...body })
      setData(prev => ({ ...prev, slots: d.slots, score: d.score, completed: d.completed }))
      return d
    } catch (e) {
      alert(e.message)
    } finally {
      clearTimeout(slowTimer.current)
      setBusy(false); setSlow(false)
    }
  }

  const guess = team => send({ slot: current, team })

  const nextLogo = () => {
    const slots = data.slots
    const next = slots.findIndex((s, i) => i > current && !s.done)
    setCurrent(next >= 0 ? next : firstOpen(slots))
  }

  const handleGiveUpClick = () => {
    // only the logo you're looking at, the others stay playable
    if (confirmingGiveUp) { setConfirmingGiveUp(false); send({ giveUp: true, slot: current }) }
    else setConfirmingGiveUp(true)
  }

  const handleShare = async () => {
    const row = data.slots.map(s => s.solved ? '🟩' : '🟥').join('')
    const text = `Logo Lineup #${data.number}\n${row}\n${data.score}/6\n\nhttps://pick6.io`
    let copied = false
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        copied = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {}
    }
    setShareState(copied ? 'copied' : 'error')
    setTimeout(() => setShareState('idle'), 2000)
  }

  if (error) {
    return (
      <div className="loading-wheel-wrap" style={{ paddingTop: 60 }}>
        <span className="loading-label">Couldn't load Logo Lineup</span>
        <button className="header-icon-btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="loading-wheel-wrap" style={{ paddingTop: 60 }}>
        <WheelSpinner />
        <span className="loading-label">Loading Logo Lineup…</span>
      </div>
    )
  }

  const slot = data.slots[current]
  const league = data.leagues[current]
  const teams = data.teams[league.league]
  const scoreTier = data.score === 6 ? 'good' : data.score === 0 ? 'bad' : 'mid'
  const moreLeft = data.slots.some((s, i) => i !== current && !s.done)

  return (
    <div className="puzzle-game">
      <div className="circle-nav-row">

        <div className="circle-side circle-side--left">
          <span className="puzzle-date-big">{formatDate(data.date)}</span>
          <span className="puzzle-number-row">
            <span className="puzzle-number-label">Logo Lineup #{data.number}</span>
            <RulesButton game="lineup" />
          </span>
        </div>

        <div className="ll-board">
          {/* one tab per logo, you can play them in any order */}
          <ol className="ll-strip">
            {data.leagues.map((l, i) => {
              const s = data.slots[i]
              const state = s.done ? (s.solved ? ' ll-tab--right' : ' ll-tab--wrong') : ''
              return (
                <li key={i}>
                  <button className={`ll-tab${i === current ? ' ll-tab--on' : ''}${state}`} onClick={() => setCurrent(i)}>
                    <span className="ll-tab-label">{l.old ? 'OLD' : l.label.toUpperCase()}</span>
                    <span className="ll-tab-mark">{s.done ? (s.solved ? '✓' : '✗') : i + 1}</span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="ll-stage">
            <div className="ll-stage-top">
              <span className="fr-call-label">GUESS THE LOGO</span>
              {!slot.done && (
                <div className="fr-attempts" title={`${MAX_ATTEMPTS - slot.attempts} attempts left`}>
                  <span className="attempt-label fr-attempts-label">ATTEMPTS</span>
                  <div className="attempt-dots">
                    {[0, 1, 2].map(i => (
                      <span key={i} className={`attempt-dot${i < slot.attempts ? ' attempt-dot--wrong' : ''}`} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={`ll-card${slot.done ? ' ll-card--full' : ''}`}>
              {slot.done
                ? <img src={fullLogo(slot.answer.logo)} alt={slot.answer.name} />
                : <img src={slot.image} alt="Zoomed in logo" />}
            </div>

            {slot.done ? (
              <div className="ll-answer">
                <span className="ll-answer-name">
                  {slot.answer.name}
                  <span className={`fr-mark fr-mark--${slot.solved ? 'right' : 'wrong'}`}>{slot.solved ? '✓' : '✗'}</span>
                </span>
                {slot.answer.eraName && (
                  // the old name only when it was different, "Oakland Raiders · 1995-2019"
                  <span className="ll-answer-era">
                    {slot.answer.eraName !== slot.answer.name ? `${slot.answer.eraName} · ${slot.answer.years}` : `Logo from ${slot.answer.years}`}
                  </span>
                )}
                {moreLeft && <button className="circle-guess-btn fr-btn" onClick={nextLogo}>NEXT LOGO →</button>}
              </div>
            ) : (
              <div className="ll-guess">
                {/* give up sits next to the search box, it only ends this logo */}
                <div className="ll-guess-row">
                  <TeamSearch key={current} teams={teams} missed={slot.wrong} onPick={guess} disabled={busy} hint={searchHint(league)} />
                  <button
                    className={`give-up-btn ll-give-up${confirmingGiveUp ? ' give-up-btn--confirm' : ''}`}
                    onClick={handleGiveUpClick}
                    disabled={busy}
                  >
                    {confirmingGiveUp ? 'Sure?' : 'Give Up'}
                  </button>
                </div>
                {slow && <span className="ll-checking"><span className="fr-spinner" aria-hidden="true" />Checking…</span>}
              </div>
            )}
          </div>
        </div>

        <div className="circle-side circle-side--right">
          {data.completed && (
            <div className="result-table">
              {data.leagues.map((l, i) => {
                const s = data.slots[i]
                return (
                  <div key={i} className="result-table-row">
                    <span className="result-table-label">
                      <span className={`result-table-check ${s.solved ? 'result-table-check--correct' : 'result-table-check--wrong'}`}>
                        {s.solved ? '✓' : '✗'}
                      </span>
                      {l.old ? 'Old' : l.label}
                    </span>
                    <span className="result-table-value">+{s.solved ? 1 : 0}</span>
                  </div>
                )
              })}
              <div className="result-table-divider" />
              <div className={`result-table-row result-table-total result-table-total--${scoreTier}`}>
                <span className="result-table-label">Total</span>
                <span className="result-table-value">{data.score}/6</span>
              </div>
              {/* 0/6 in any game is a Pick 6, same message as Pick 6 */}
              {scoreTier === 'bad' && (
                <>
                  <p className="result-table-pick6">You scored a Pick 6.</p>
                  <p className="result-table-pick6">Better luck next time.</p>
                </>
              )}
              {!data.signedIn && <p className="fr-signin-hint">Sign in to save your Logo Lineup results.</p>}
              <div className="share-row">
                <button className="share-btn" onClick={handleShare}>
                  {shareState === 'copied' ? 'Copied!' : shareState === 'error' ? 'Copy failed' : 'Share Result'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

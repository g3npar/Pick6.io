import { useState, useEffect, useRef } from 'react'
import { shareText, tries, copyText, pts } from '../utils/share'
import { usePercentile, TopPercent, todayNY, anonId } from '../utils/percentile'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'
import RulesButton from './HowToPlay'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const MAX_ATTEMPTS = 3

// signed out games are kept in the browser, one per day
const STORE_KEY = 'pick6_lineup_days'
const readStore = date => { try { return JSON.parse(sessionStorage.getItem(STORE_KEY))?.[date] ?? null } catch { return null } }
const writeStore = (date, slots) => {
  try {
    const all = JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...all, [date]: slots }))
  } catch {}
}
// state for the server, with the team you got so it can be checked if you sign in later
const slimSlots = slots => slots.map(({ attempts, wrong, solved, answer }) => ({ attempts, wrong, solved, ...(solved ? { team: answer?.team } : {}) }))

async function post(path, body, retry = true) {
  // a network error (like the API restarting) gets one retry. resending a guess is safe,
  // a repeated miss is free and a right answer stays right
  let res
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    if (retry) {
      await new Promise(r => setTimeout(r, 1500))
      return post(path, body, false)
    }
    throw new Error("Couldn't reach the server, try again in a moment")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

// logo paths include the extension
const fullLogo = logo => `/logos/leagues/${logo}`
// 1 point a logo, minus 0.25 a miss
const pointsFor = s => (s.solved ? 1 - 0.25 * s.attempts : 0)

// the tab only says OLD, so the hint names the league
const searchHint = l => `${l.old ? 'Old ' : ''}${l.league === 'ncaa' ? (l.old ? 'college' : 'College') : l.label} team…`
// "GUESS THE NFL LOGO", "GUESS THE OLD COLLEGE LOGO"
const logoTitle = l => `GUESS THE ${l.old ? 'OLD ' : ''}${l.league === 'ncaa' ? 'COLLEGE' : l.label.toUpperCase()} LOGO`

// search within the logo's league
function TeamSearch({ teams, missed, onPick, disabled, hint }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)   // arrow key highlight
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = e => {
      if (disabled || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return
      const el = document.activeElement
      if (el === inputRef.current) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('.rules-card')) return
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [disabled])
  const term = q.trim().toLowerCase()
  const matches = term ? teams.filter(t => t.name.toLowerCase().includes(term)).slice(0, 6) : []
  // what ENTER sends: a picked team or a full typed name
  const chosen = teams.find(t => t.name.toLowerCase() === term && !missed.includes(t.id)) || null

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // picking fills it in, ENTER guesses it
  const choose = t => { setQ(t.name); setOpen(false); setActive(-1) }
  const submit = () => { if (!chosen || disabled) return; onPick(chosen.id); setQ(''); setActive(-1) }
  const first = matches.find(t => !missed.includes(t.id))

  // arrows skip teams already missed
  const move = step => {
    const ok = matches.map((t, i) => (missed.includes(t.id) ? -1 : i)).filter(i => i >= 0)
    if (!ok.length) return
    const at = ok.indexOf(active)
    setActive(at < 0 ? (step > 0 ? ok[0] : ok[ok.length - 1]) : ok[(at + step + ok.length) % ok.length])
    setOpen(true)
  }
  const listShowing = open && matches.length > 0
  const onKeyDown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1) }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1) }
    else if (e.key === 'Enter') {
      const hi = listShowing && matches[active] && !missed.includes(matches[active].id) ? matches[active] : null
      if (hi) choose(hi)                      // fill in the highlighted team
      else if (chosen) submit()               // guess it
      else if (listShowing && first) choose(first)
    }
  }

  return (
    <>
      <div className="ll-search" ref={ref}>
        <input
          ref={inputRef}
          className="ll-search-input"
          value={q}
          placeholder={hint}
          disabled={disabled}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search teams"
        />
        {listShowing && !chosen && (
          <ul className="ll-search-list" role="listbox">
            {matches.map((t, i) => {
              const out = missed.includes(t.id)
              return (
                <li key={t.id}>
                  <button
                    className={`ll-search-item${out ? ' ll-search-item--out' : ''}${i === active ? ' ll-search-item--active' : ''}`}
                    disabled={out}
                    onMouseEnter={() => !out && setActive(i)}
                    onClick={() => choose(t)}
                  >
                    {t.name}{out && <span className="ll-search-miss">✗</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <button className="circle-guess-btn fr-btn ll-enter" onClick={submit} disabled={!chosen || disabled}>
        ENTER →
      </button>
    </>
  )
}

// no date = today, a date = an archive day
export default function LineupBoard({ date = null, signedIn = false }) {
  const [data, setData]     = useState(null)
  const [error, setError]   = useState(null)
  const [current, setCurrent] = useState(0)
  const [busy, setBusy]     = useState(false)
  const [slow, setSlow]     = useState(false)
  const slowTimer = useRef(null)
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false)
  const [shareState, setShareState] = useState('idle')
  const percentile = usePercentile('lineup', data?.completed ? data.date : null, data?.score)

  const firstOpen = slots => Math.max(0, slots.findIndex(s => !s.done))

  const load = () => {
    setError(null)
    // send the browser's saved game (today's date is only known after the first response)
    post('/lineup/day', { date, local: date ? readStore(date) : null })
      .then(d => {
        // just signed in with nothing saved: send the browser's game
        const nothingSaved = d.slots.every(st => !st.attempts && !st.solved)
        const kept = !date && (!d.signedIn || nothingSaved) && readStore(d.date)
        return kept ? post('/lineup/day', { date: d.date, local: kept }) : d
      })
      .then(d => { setData(d); setCurrent(firstOpen(d.slots)) })
      .catch(err => setError(err.message))
  }

  useEffect(() => { setData(null); load() }, [date])
  // reload only when sign in status actually changes
  useEffect(() => {
    if (data && data.signedIn !== signedIn) { setData(null); load() }
  }, [signedIn])

  useEffect(() => {
    if (data && !data.signedIn) writeStore(data.date, slimSlots(data.slots))
  }, [data])

  // reset "Are you sure?" when switching logos
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
    // spinner only on slow connections
    slowTimer.current = setTimeout(() => setSlow(true), 500)
    try {
      const d = await post('/lineup/guess', { date: data.date, local: slimSlots(data.slots), anonId: anonId(), ...body })
      // only the guessed logo comes with a picture, keep the rest
      const same = (a, b) => a.attempts === b.attempts && a.done === b.done
      if (d.slots.some((s, i) => !s.image && !same(s, data.slots[i]))) {
        // changed somewhere else (another tab), reload to get the right pictures
        load()
        return d
      }
      setData(prev => ({
        ...prev, score: d.score, completed: d.completed,
        slots: d.slots.map((s, i) => (s.image ? s : { ...s, image: prev.slots[i].image })),
      }))
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

  useEffect(() => {
    if (!data || !data.slots[current]?.done || !data.slots.some((x, i) => i !== current && !x.done)) return
    const onKey = e => {
      if (e.key !== 'Enter' || e.repeat) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (el && el.tagName === 'BUTTON' && !el.classList.contains('ll-tab')) return
      if (document.querySelector('.rules-card')) return
      e.preventDefault()
      nextLogo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [data, current])

  const handleGiveUpClick = () => {
    // only the current logo
    if (confirmingGiveUp) { setConfirmingGiveUp(false); send({ giveUp: true, slot: current }) }
    else setConfirmingGiveUp(true)
  }

  const handleShare = async () => {
    // one line per logo
    const text = shareText(`Logo Lineup #${data.number}`, data.leagues.map((l, i) => {
      const s = data.slots[i]
      return [tries(s.solved, s.attempts), l.old ? 'Old' : l.label, pointsFor(s), 1]
    }), data.score)
    setShareState(await copyText(text) ? 'copied' : 'failed')
    setTimeout(() => setShareState('idle'), 1800)
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
          {/* one tab per logo, any order */}
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
              <span className="fr-call-label">{logoTitle(league)}</span>
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

            {/* all six images stay loaded so switching tabs is instant */}
            <div className="ll-card">
              {data.slots.map((s, i) => (
                <img
                  key={i}
                  src={s.done ? (s.image || fullLogo(s.answer.logo)) : s.image}
                  alt={i === current ? (s.done ? s.answer.name : 'Zoomed in logo') : ''}
                  aria-hidden={i !== current}
                  decoding="sync"
                  className={`${s.done ? 'll-card-full' : ''}${i !== current ? ' ll-card-off' : ''}`}
                />
              ))}
            </div>

            {slot.done ? (
              <div className="ll-answer">
                <span className="ll-answer-name">
                  {slot.answer.name}
                  <span className={`fr-mark fr-mark--${slot.solved ? 'right' : 'wrong'}`}>{slot.solved ? '✓' : '✗'}</span>
                </span>
                {slot.answer.eraName && (
                  // old name only if it changed
                  <span className="ll-answer-era">
                    {slot.answer.eraName !== slot.answer.name ? `${slot.answer.eraName} · ${slot.answer.years}` : `Logo from ${slot.answer.years}`}
                  </span>
                )}
                {moreLeft && <button className="circle-guess-btn fr-btn" onClick={nextLogo}>NEXT LOGO →</button>}
              </div>
            ) : (
              <div className="ll-guess">
                {/* give up only ends this logo */}
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

        <div className="circle-side circle-side--right ll-side">
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
                      {/* attempts used, or gave up */}
                      <span className="result-table-attempts">
                        {s.solved ? `used ${s.attempts + 1}/${MAX_ATTEMPTS} attempts` : s.wrong.length < MAX_ATTEMPTS ? 'gave up' : `used ${MAX_ATTEMPTS}/${MAX_ATTEMPTS} attempts`}
                      </span>
                    </span>
                    <span className="result-table-value">+{pts(pointsFor(s))}</span>
                  </div>
                )
              })}
              <div className="result-table-divider" />
              <div className={`result-table-row result-table-total result-table-total--${scoreTier}`}>
                <span className="result-table-label">Total</span>
                <span className="result-table-value">{pts(data.score)}/6</span>
              </div>
              <TopPercent result={percentile} today={data.date === todayNY()} />
              {/* 0/6 is a Pick 6 */}
              {scoreTier === 'bad' && (
                <>
                  <p className="result-table-pick6">You scored a Pick 6.</p>
                  <p className="result-table-pick6">Better luck next time.</p>
                </>
              )}
              {!data.signedIn && <p className="fr-signin-hint">Sign in to save your Logo Lineup results.</p>}
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

import { useState, useRef, useEffect, useCallback } from 'react'
import { parseFact } from '../utils/factDisplay'
import { teamLogo } from '../utils/teamLogo'
import { collegeLogo } from '../utils/collegeLogo'
import { formatDate } from '../utils/formatDate'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Aug 17, 2026 is the first date a daily puzzle was ever released, so it's puzzle #1.
const PUZZLE_EPOCH = new Date(2026, 7, 17)

function puzzleNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Math.round((date - PUZZLE_EPOCH) / 86400000) + 1
}

// SVG-based fact paths, 6 facts at 60 degrees each
const SVG_R  = 298
const SVG_CX = 300
const SVG_CY = 300
const N_FACTS = 6
const DEG = 360 / N_FACTS

function getFactPath(i) {
  const toRad = d => d * Math.PI / 180
  const start = -90 + i * DEG
  const end   = start + DEG
  const x1 = SVG_CX + SVG_R * Math.cos(toRad(start))
  const y1 = SVG_CY + SVG_R * Math.sin(toRad(start))
  const x2 = SVG_CX + SVG_R * Math.cos(toRad(end))
  const y2 = SVG_CY + SVG_R * Math.sin(toRad(end))
  return `M ${SVG_CX} ${SVG_CY} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${SVG_R} ${SVG_R} 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
}

function getFactCentroid(i) {
  const cx = 50, cy = 50
  const mid = (-90 + i * DEG + DEG / 2) * (Math.PI / 180)
  const r = 33
  return { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) }
}

const FACT_PATHS   = Array.from({ length: N_FACTS }, (_, i) => getFactPath(i))
const FACT_CENTERS = Array.from({ length: N_FACTS }, (_, i) => getFactCentroid(i))

// Renders a parsed fact's value as logo(s) or text, shared by the normal
// fact display and the crossed-out/corrected display shown for a lie.
// `compact` shrinks it for the struck-through "wrong" line in a correction.
function FactValue({ display, compact }) {
  if (display.isTeams) {
    const many = display.value.split(', ').length >= 3
    return (
      <div className={`fl-logos${compact || many ? ' fl-logos--sm' : ''}`}>
        {display.value.split(', ').map(team => {
          const src = teamLogo(team)
          return src
            ? <img key={team} src={src} alt={team} className="fl-logo" title={team} />
            : <span key={team} className="fl-text fl-value">{team}</span>
        })}
      </div>
    )
  }
  if (display.isCollege) {
    const src = collegeLogo(display.value)
    return (
      <div className={`fl-logos${compact ? ' fl-logos--sm' : ''}`}>
        {src
          ? <img src={src} alt={display.value} className="fl-logo fl-logo-college" title={display.value} />
          : <p className="fl-text fl-value">{display.value}</p>}
      </div>
    )
  }
  if (display.isJersey) {
    return <p className={`fl-text fl-value fl-jersey${compact ? ' fl-value--sm' : ''}`}>{display.value}</p>
  }
  return <p className={`fl-text fl-value${compact ? ' fl-value--sm' : ''}`}>{display.value}</p>
}


function GameBoard({
  puzzle, totalPuzzles,
  selectedLieId, selectedPlayer,
  lieFound, lieAttempts, confirmedTrueIds, liePhaseComplete,
  submitted, playerCorrect, gaveUp,
  onSelectLie, onSelectPlayer,
  onGuessLie, onSubmit, onGiveUp,
  currentScore,
}) {
  const [query,        setQuery]        = useState('')
  const [dropdownOpen, setDropdown]     = useState(false)
  const [results,      setResults]      = useState([])
  const [searching,    setSearching]    = useState(false)
  const [hoveredIdx,   setHoveredIdx]   = useState(null)
  const [tabIdx,       setTabIdx]       = useState(-1)
  const [shareState, setShareState] = useState('idle') // 'idle' | 'copied'
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false)
  const [selectedHeadshot, setSelectedHeadshot] = useState(null)
  const wrapRef       = useRef(null)
  const inputRef      = useRef(null)
  const debounceRef   = useRef(null)

  useEffect(() => {
    setQuery(''); setDropdown(false); setResults([]); setHoveredIdx(null); setTabIdx(-1)
    setConfirmingGiveUp(false); setSelectedHeadshot(null)
  }, [puzzle.id])

  // Reverts the "Are you sure?" confirmation on its own if left untouched.
  useEffect(() => {
    if (!confirmingGiveUp) return
    const t = setTimeout(() => setConfirmingGiveUp(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingGiveUp])

  useEffect(() => {
    const handler = e => {
      const tag = document.activeElement?.tagName
      const alreadyTyping = tag === 'INPUT' || tag === 'TEXTAREA'
      if (!submitted && !liePhaseComplete && !alreadyTyping && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // no-op: search box is hidden during lie phase
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [submitted, liePhaseComplete])

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const searchPlayers = useCallback((q) => {
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setDropdown(false); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`${API}/players/search?${new URLSearchParams({ q })}`)
        const data = await res.json()
        setResults(data)
        setDropdown(data.length > 0)
      } catch (e) {
        console.error('Search error', e)
      } finally {
        setSearching(false)
      }
    }, 250)
  }, [])

  const handleQueryChange = e => {
    const val = e.target.value
    setQuery(val); onSelectPlayer(val); setTabIdx(-1)
    if (!val) { setResults([]); setDropdown(false); return }
    searchPlayers(val)
  }

  const handleSelect = item => {
    setQuery(item.name); onSelectPlayer(item.name)
    setSelectedHeadshot(item.headshot_url || null)
    setDropdown(false); setResults([]); setTabIdx(-1)
  }

  const handleClear = () => {
    setQuery(''); onSelectPlayer('')
    setSelectedHeadshot(null)
    setDropdown(false); setResults([]); setTabIdx(-1)
  }

  const handleInputKeyDown = e => {
    if (e.key === 'Tab' && dropdownOpen && results.length > 0) {
      e.preventDefault()
      const next = (tabIdx + 1) % results.length
      setTabIdx(next)
      setQuery(results[next].name)
      onSelectPlayer(results[next].name)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = tabIdx >= 0 && results[tabIdx]
        ? results[tabIdx]
        : dropdownOpen && results.length > 0 ? results[0] : null
      if (target) handleSelect(target)
    }
  }

  // Requires a second click on the "Are you sure?" state before actually giving up.
  const handleGiveUpClick = () => {
    if (confirmingGiveUp) { setConfirmingGiveUp(false); onGiveUp() }
    else setConfirmingGiveUp(true)
  }

  const handleShare = async () => {
    const lieScore    = lieFound ? Math.max(1, 3 - lieAttempts) : 0
    const playerScore = playerCorrect ? 3 : 0
    const lieEmoji    = lieScore === 3 ? '🟩' : lieScore > 0 ? '🟨' : '🟥'
    const playerEmoji = playerScore === 3 ? '🟩' : '🟥'
    const num = puzzle.date ? ` #${puzzleNumber(puzzle.date)}` : ''
    const text = `Pick6${num}\n${lieEmoji} Lie: ${lieScore}/3\n${playerEmoji} Player: ${playerScore}/3\n${currentScore}/6\n\nhttps://pick6.io`

    let copied = false
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      // Clipboard API unavailable/denied — fall back to the legacy copy command.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { copied = document.execCommand('copy') } catch { copied = false }
      document.body.removeChild(ta)
    }
    setShareState(copied ? 'copied' : 'failed')
    setTimeout(() => setShareState('idle'), 1800)
  }

  const canGuessLie     = selectedLieId !== null && !liePhaseComplete
  const canSubmitPlayer = selectedPlayer.trim().length > 0 && liePhaseComplete && !submitted

  const scoreTier = currentScore === 6 ? 'good' : currentScore === 0 ? 'bad' : 'mid'

  return (
    <div className="puzzle-game">

      {/* ── Circle ───────────────────────────────────── */}
      <div className="circle-nav-row">

        <div className="circle-side circle-side--left">
          {puzzle.date && <span className="puzzle-date-big">{formatDate(puzzle.date)}</span>}
          {puzzle.date && <span className="puzzle-number-label">Puzzle #{puzzleNumber(puzzle.date)}</span>}
        </div>

        <div className="circle-game">

        {/* SVG facts */}
        <svg className="circle-svg" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
          {puzzle.facts.map((fact, i) => {
            const isSelected     = selectedLieId === fact.id
            const isFalse        = fact.id === puzzle.falseFactId
            const isConfirmedTrue = confirmedTrueIds.includes(fact.id)
            const isHov          = hoveredIdx === i

            let fill = '#161a2e'
            if (submitted) {
              fill = isFalse ? 'rgba(255,34,68,0.35)' : 'rgba(0,240,128,0.18)'
            } else if (isConfirmedTrue) {
              fill = 'rgba(0,240,128,0.18)'
            } else if (liePhaseComplete && isFalse) {
              fill = 'rgba(255,34,68,0.35)'
            } else if (isSelected) {
              fill = 'rgba(255,34,68,0.28)'
            } else if (isHov && !isConfirmedTrue && !liePhaseComplete) {
              fill = '#20263e'
            }

            const isInteractive = !liePhaseComplete && !isConfirmedTrue
            return (
              <path
                key={fact.id}
                d={FACT_PATHS[i]}
                fill={fill}
                stroke="#0d0d0d"
                strokeWidth="4"
                strokeLinejoin="round"
                style={{ cursor: isInteractive ? 'pointer' : 'default', transition: 'fill 0.18s' }}
                onClick={() => isInteractive && onSelectLie(isSelected ? null : fact.id)}
                onMouseEnter={() => isInteractive && setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            )
          })}
          <circle cx="300" cy="300" r="298" fill="none" stroke="#2e2e2e" strokeWidth="2"/>
        </svg>

        {/* Text labels at fact centroids (pointer-events: none) */}
        {puzzle.facts.map((fact, i) => {
          const { x, y } = FACT_CENTERS[i]
          const isSelected     = selectedLieId === fact.id
          const isHovered      = hoveredIdx === i
          const isFalse        = fact.id === puzzle.falseFactId
          const isConfirmedTrue = confirmedTrueIds.includes(fact.id)
          const display        = parseFact(fact.text)
          const isRevealedLie   = isFalse && (submitted || liePhaseComplete)
          const trueDisplay     = isRevealedLie && puzzle.trueText ? parseFact(puzzle.trueText) : null

          let cls = 'fact-label'
          if (submitted)            cls += isFalse ? ' fl-false' : ' fl-true'
          else if (isConfirmedTrue) cls += ' fl-true'
          else if (liePhaseComplete && isFalse) cls += ' fl-false'
          else if (isSelected)      cls += ' fl-selected'
          else if (isHovered)       cls += ' fl-hovered'

          return (
            <div
              key={fact.id}
              className={cls}
              style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` }}
            >
              <span className="fl-num">{display.label}</span>
              {trueDisplay ? (
                <div className="fl-correction">
                  <div className="fl-wrong-line">
                    <FactValue display={display} compact />
                    {display.sublabel && <span className="fl-sublabel fl-sublabel--sm">{display.sublabel}</span>}
                  </div>
                  <div className="fl-true-value">
                    <FactValue display={trueDisplay} />
                    {trueDisplay.sublabel && <span className="fl-sublabel fl-sublabel--true">{trueDisplay.sublabel}</span>}
                  </div>
                </div>
              ) : (
                <>
                  <FactValue display={display} />
                  {display.sublabel && <span className="fl-sublabel">{display.sublabel}</span>}
                </>
              )}
              {!submitted && !liePhaseComplete && (isSelected || isHovered) && (
                <span className="fl-tag">
                  {isSelected ? '\u2717 MARKED AS LIE' : 'MARK AS LIE?'}
                </span>
              )}
              {/* Show verdict during gameplay for confirmed/found facts */}
              {(submitted || isConfirmedTrue || (liePhaseComplete && isFalse)) && (
                <span className={`fl-verdict ${isFalse ? 'flv-false' : 'flv-true'}`}>
                  {isFalse ? '\u2717 LIE' : '\u2713 TRUE'}
                </span>
              )}
            </div>
          )
        })}

        {/* Center: player search (only after lie phase) or hint */}
        <div className={`circle-center${submitted ? (playerCorrect ? ' circle-center--correct' : ' circle-center--wrong') : ''}`}>

          {!liePhaseComplete ? (
            <div className="circle-lie-phase">
              <div className="circle-attempts">
                <span className="attempt-label">ATTEMPTS</span>
                <div className="attempt-dots">
                  {[0, 1, 2].map(i => (
                    <span key={i} className={`attempt-dot${i < lieAttempts ? ' attempt-dot--wrong' : ''}`} />
                  ))}
                </div>
              </div>
              <button className="circle-guess-btn" onClick={onGuessLie} disabled={!canGuessLie}>
                {canGuessLie ? 'GUESS LIE →' : 'Select a fact'}
              </button>
            </div>
          ) : !submitted ? (
            <div className="circle-lie-phase">
              <div className="search-wrap" ref={wrapRef}>
                <div className="search-input-container">
                  <span className="search-icon">⌕</span>
                  <input
                    ref={inputRef}
                    type="text"
                    className="player-search-input"
                    placeholder="Search player…"
                    value={query}
                    onChange={handleQueryChange}
                    onKeyDown={handleInputKeyDown}
                    onFocus={() => results.length > 0 && setDropdown(true)}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {query && (
                    <button className="clear-search-btn" onClick={handleClear} aria-label="Clear">✕</button>
                  )}
                </div>
                {dropdownOpen && (
                  <ul className="player-dropdown">
                    {searching && <li className="dropdown-item no-results">Searching…</li>}
                    {!searching && results.map((item, i) => (
                      <li key={item.id} className={`dropdown-item${i === tabIdx ? ' dropdown-item-active' : ''}`} onMouseDown={() => handleSelect(item)}>
                        <span className="dropdown-player-name">{item.name}</span>
                        <span className="dropdown-player-meta">
                          {item.position}{item.draft_year ? ` · ${item.draft_year}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="circle-guess-btn" onClick={onSubmit} disabled={!canSubmitPlayer}>
                {canSubmitPlayer ? 'LOCK IN →' : 'Pick a player'}
              </button>
            </div>
          ) : (() => {
            // A give-up has no real guess to show — fall back to the same
            // treatment if there's simply no guess photo on hand at all
            // (e.g. a freeform guess restored after a refresh), so the
            // circle never shows the bare football placeholder over a wrong.
            const isGiveUp = gaveUp || (!playerCorrect && !selectedPlayer.trim())
            const showCorrect = playerCorrect || isGiveUp
            const photoUrl = showCorrect ? puzzle.headshotUrl : selectedHeadshot
            return (
              <div className="player-reveal-photo">
                <div className="player-reveal-photo-inner">
                  <span className={`reveal-guess-label ${playerCorrect ? 'reveal-guess-label--correct' : 'reveal-guess-label--wrong'}`}>
                    <span className="reveal-guess-label-lead">{isGiveUp ? 'Correct Answer' : 'You guessed'}</span>
                    <span className="reveal-guess-label-name">{showCorrect ? puzzle.playerName : selectedPlayer}</span>
                  </span>
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={showCorrect ? puzzle.playerName : selectedPlayer}
                      className="reveal-headshot"
                    />
                  ) : (
                    <div className="reveal-headshot reveal-headshot--fallback">🏈</div>
                  )}
                </div>
                <span className={`reveal-badge ${playerCorrect ? 'reveal-badge--correct' : 'reveal-badge--wrong'}`}>
                  {playerCorrect ? '✓' : '✗'}
                </span>
              </div>
            )
          })()}
        </div>

        </div>{/* end circle-game */}

        <div className="circle-side circle-side--right">
          {!submitted && (
            <button
              className={`give-up-btn${confirmingGiveUp ? ' give-up-btn--confirm' : ''}`}
              onClick={handleGiveUpClick}
            >
              {confirmingGiveUp ? 'Are you sure?' : 'Give Up'}
            </button>
          )}
          {submitted && (
            <div className="result-table">
              <div className="result-table-row">
                <span className="result-table-label">
                  <span className={`result-table-check ${lieFound ? 'result-table-check--correct' : 'result-table-check--wrong'}`}>
                    {lieFound ? '✓' : '✗'}
                  </span>
                  Lie
                  <span className="result-table-attempts">used {lieFound ? lieAttempts + 1 : lieAttempts}/3 attempts</span>
                </span>
                <span className="result-table-value">{lieFound ? `+${Math.max(1, 3 - lieAttempts)}` : '+0'}</span>
              </div>
              <div className="result-table-row">
                <span className="result-table-label">
                  <span className={`result-table-check ${playerCorrect ? 'result-table-check--correct' : 'result-table-check--wrong'}`}>
                    {playerCorrect ? '✓' : '✗'}
                  </span>
                  Player
                </span>
                <span className="result-table-value">{playerCorrect ? '+3' : '+0'}</span>
              </div>
              <div className="result-table-divider" />
              <div className={`result-table-row result-table-total result-table-total--${scoreTier}`}>
                <span className="result-table-label">Total</span>
                <span className="result-table-value">{currentScore}/6</span>
              </div>
              {scoreTier === 'bad' && (
                <>
                  <p className="result-table-pick6">You scored a Pick 6.</p>
                  <p className="result-table-pick6">Better luck next time.</p>
                </>
              )}
              <div className="share-row">
                <button className="share-btn" onClick={handleShare}>Share Result</button>
                {shareState === 'copied' && <span className="share-toast">Link copied!</span>}
                {shareState === 'failed' && <span className="share-toast share-toast--failed">Couldn't copy — pick6.io</span>}
              </div>
            </div>
          )}
        </div>
      </div>{/* end circle-nav-row */}

    </div>
  )
}

export default GameBoard

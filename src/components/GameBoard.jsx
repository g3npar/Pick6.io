import { useState, useRef, useEffect, useCallback } from 'react'
import { parseFact } from '../utils/factDisplay'
import { teamLogo } from '../utils/teamLogo'
import { collegeLogo } from '../utils/collegeLogo'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// SVG-based wedge paths, 6 wedges at 60 degrees each
const SVG_R  = 298
const SVG_CX = 300
const SVG_CY = 300
const N_WEDGES = 6
const DEG = 360 / N_WEDGES

function getWedgePath(i) {
  const toRad = d => d * Math.PI / 180
  const start = -90 + i * DEG
  const end   = start + DEG
  const x1 = SVG_CX + SVG_R * Math.cos(toRad(start))
  const y1 = SVG_CY + SVG_R * Math.sin(toRad(start))
  const x2 = SVG_CX + SVG_R * Math.cos(toRad(end))
  const y2 = SVG_CY + SVG_R * Math.sin(toRad(end))
  return `M ${SVG_CX} ${SVG_CY} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${SVG_R} ${SVG_R} 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
}

function getWedgeCentroid(i) {
  const cx = 50, cy = 50
  const mid = (-90 + i * DEG + DEG / 2) * (Math.PI / 180)
  const r = 33
  return { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) }
}

const WEDGE_PATHS   = Array.from({ length: N_WEDGES }, (_, i) => getWedgePath(i))
const WEDGE_CENTERS = Array.from({ length: N_WEDGES }, (_, i) => getWedgeCentroid(i))

// Renders a parsed fact's value as logo(s) or text, shared by the normal
// wedge display and the crossed-out/corrected display shown for a lie.
// `compact` shrinks it for the struck-through "wrong" line in a correction.
function FactValue({ display, compact }) {
  if (display.isTeams) {
    const many = display.value.split(', ').length >= 3
    return (
      <div className={`wl-logos${compact || many ? ' wl-logos--sm' : ''}`}>
        {display.value.split(', ').map(team => {
          const src = teamLogo(team)
          return src
            ? <img key={team} src={src} alt={team} className="wl-logo" title={team} />
            : <span key={team} className="wl-text wl-value">{team}</span>
        })}
      </div>
    )
  }
  if (display.isCollege) {
    const src = collegeLogo(display.value)
    return (
      <div className={`wl-logos${compact ? ' wl-logos--sm' : ''}`}>
        {src
          ? <img src={src} alt={display.value} className="wl-logo wl-logo-college" title={display.value} />
          : <p className="wl-text wl-value">{display.value}</p>}
      </div>
    )
  }
  if (display.isJersey) {
    return <p className={`wl-text wl-value wl-jersey${compact ? ' wl-value--sm' : ''}`}>{display.value}</p>
  }
  return <p className={`wl-text wl-value${compact ? ' wl-value--sm' : ''}`}>{display.value}</p>
}


function GameBoard({
  puzzle, totalPuzzles,
  selectedLieId, selectedPlayer,
  lieFound, lieAttempts, confirmedTrueIds, liePhaseComplete,
  submitted, playerCorrect,
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
  const [displayScore, setDisplayScore] = useState(currentScore)
  const wrapRef       = useRef(null)
  const inputRef      = useRef(null)
  const debounceRef   = useRef(null)
  const scoreRef      = useRef(currentScore)

  useEffect(() => {
    const target = currentScore
    const start  = scoreRef.current
    if (target === start) return
    scoreRef.current = target
    const diff     = target - start
    const steps    = Math.abs(diff)
    const interval = Math.max(20, Math.floor(300 / steps))
    let current    = start
    const timer    = setInterval(() => {
      current += diff > 0 ? 1 : -1
      setDisplayScore(current)
      if (current === target) clearInterval(timer)
    }, interval)
    return () => clearInterval(timer)
  }, [currentScore])

  useEffect(() => {
    setQuery(''); setDropdown(false); setResults([]); setHoveredIdx(null); setTabIdx(-1)
  }, [puzzle.id])

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
    setDropdown(false); setResults([]); setTabIdx(-1)
  }

  const handleClear = () => {
    setQuery(''); onSelectPlayer('')
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

  const canGuessLie     = selectedLieId !== null && !liePhaseComplete
  const canSubmitPlayer = selectedPlayer.trim().length > 0 && liePhaseComplete && !submitted

  return (
    <div className="puzzle-game">

      <div className="puzzle-header">
        {!liePhaseComplete && (
          <div className="attempt-dots-wrap">
            <span className="attempt-label">ATTEMPTS</span>
            <div className="attempt-dots">
              {[0, 1, 2].map(i => (
                <span key={i} className={`attempt-dot${i < lieAttempts ? ' attempt-dot--wrong' : ''}`} />
              ))}
            </div>
          </div>
        )}
        {liePhaseComplete && !submitted && (
          <p className="phase-label">Now guess the player ↓</p>
        )}
        {submitted && !lieFound && !playerCorrect && (
          <p className="pick-six-banner">PICK SIX</p>
        )}
        {submitted && (
          <p className="puzzle-score"><span className="score-val">{displayScore}</span> / 6 PTS</p>
        )}
      </div>

      {!liePhaseComplete ? (
        <div className="submit-section">
          <button className="submit-btn" onClick={onGuessLie} disabled={!canGuessLie}>
            {canGuessLie ? 'GUESS LIE →' : 'Select a wedge'}
          </button>
          <button className="give-up-btn" onClick={onGiveUp}>Give Up</button>
        </div>
      ) : !submitted ? (
        <div className="submit-section">
          <button className="submit-btn" onClick={onSubmit} disabled={!canSubmitPlayer}>
            {canSubmitPlayer ? 'LOCK IN →' : 'Enter player name'}
          </button>
          <button className="give-up-btn" onClick={onGiveUp}>Give Up</button>
        </div>
      ) : (
        <div className="submit-result-row">
          <div className={`submit-result-chip ${lieFound ? 'src-correct' : 'src-wrong'}`}>
            <span className="src-icon">{lieFound ? '✓' : '✗'}</span>
            <span className="src-label">LIE</span>
            <span className="src-pts">{lieFound ? `+${Math.max(1, 3 - lieAttempts)}` : '+0'}</span>
          </div>
          <div className={`submit-result-chip ${playerCorrect ? 'src-correct' : 'src-wrong'}`}>
            <span className="src-icon">{playerCorrect ? '✓' : '✗'}</span>
            <span className="src-label">PLAYER</span>
            <span className="src-pts">{playerCorrect ? '+3' : '+0'}</span>
          </div>
        </div>
      )}

      {/* ── Circle ───────────────────────────────────── */}
      <div className="circle-nav-row">

        <div className="circle-game">

        {/* SVG wedges */}
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
                d={WEDGE_PATHS[i]}
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

        {/* Text labels at wedge centroids (pointer-events: none) */}
        {puzzle.facts.map((fact, i) => {
          const { x, y } = WEDGE_CENTERS[i]
          const isSelected     = selectedLieId === fact.id
          const isHovered      = hoveredIdx === i
          const isFalse        = fact.id === puzzle.falseFactId
          const isConfirmedTrue = confirmedTrueIds.includes(fact.id)
          const display        = parseFact(fact.text)
          const isRevealedLie   = isFalse && (submitted || liePhaseComplete)
          const trueDisplay     = isRevealedLie && puzzle.trueText ? parseFact(puzzle.trueText) : null

          let cls = 'wedge-label'
          if (submitted)            cls += isFalse ? ' wl-false' : ' wl-true'
          else if (isConfirmedTrue) cls += ' wl-true'
          else if (liePhaseComplete && isFalse) cls += ' wl-false'
          else if (isSelected)      cls += ' wl-selected'
          else if (isHovered)       cls += ' wl-hovered'

          return (
            <div
              key={fact.id}
              className={cls}
              style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` }}
            >
              <span className="wl-num">{display.label}</span>
              {trueDisplay ? (
                <div className="wl-correction">
                  <div className="wl-wrong-line">
                    <FactValue display={display} compact />
                    {display.sublabel && <span className="wl-sublabel wl-sublabel--sm">{display.sublabel}</span>}
                  </div>
                  <div className="wl-true-value">
                    <FactValue display={trueDisplay} />
                    {trueDisplay.sublabel && <span className="wl-sublabel wl-sublabel--true">{trueDisplay.sublabel}</span>}
                  </div>
                </div>
              ) : (
                <>
                  <FactValue display={display} />
                  {display.sublabel && <span className="wl-sublabel">{display.sublabel}</span>}
                </>
              )}
              {!submitted && !liePhaseComplete && (isSelected || isHovered) && (
                <span className="wl-tag">
                  {isSelected ? '\u2717 MARKED AS LIE' : 'MARK AS LIE?'}
                </span>
              )}
              {/* Show verdict during gameplay for confirmed/found facts */}
              {(submitted || isConfirmedTrue || (liePhaseComplete && isFalse)) && (
                <span className={`wl-verdict ${isFalse ? 'wlv-false' : 'wlv-true'}`}>
                  {isFalse ? '\u2717 LIE' : '\u2713 TRUE'}
                </span>
              )}
            </div>
          )
        })}

        {/* Center: player search (only after lie phase) or hint */}
        <div className="circle-center">

          {!liePhaseComplete ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '8px' }}>
              Pick the lie
            </p>
          ) : !submitted ? (
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
          ) : (
            <div className={`player-reveal ${playerCorrect ? 'reveal-correct' : 'reveal-wrong'}`}>
              <span className="reveal-verdict">{playerCorrect ? '✓' : '✗'}</span>
              <div className="reveal-info">
                <span className="reveal-name">{puzzle.playerName}</span>
                {!playerCorrect && selectedPlayer.trim() && (
                  <span className="reveal-guess">You: {selectedPlayer.trim()}</span>
                )}
              </div>
            </div>
          )}
        </div>

        </div>{/* end circle-game */}
      </div>{/* end circle-nav-row */}

    </div>
  )
}

export default GameBoard

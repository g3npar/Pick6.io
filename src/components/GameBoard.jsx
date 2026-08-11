import { useState, useRef, useEffect, useCallback } from 'react'
import { parseFact } from '../utils/factDisplay'
import { teamLogo } from '../utils/teamLogo'
import { collegeLogo } from '../utils/collegeLogo'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// SVG-based wedge paths — perfect arcs, no polygon approximation
const SVG_R  = 298  // outer radius in SVG units (viewBox 0 0 600 600)
const SVG_CX = 300
const SVG_CY = 300

function getWedgePath(i) {
  const toRad = d => d * Math.PI / 180
  const start = -90 + i * 72
  const end   = start + 72
  const x1 = SVG_CX + SVG_R * Math.cos(toRad(start))
  const y1 = SVG_CY + SVG_R * Math.sin(toRad(start))
  const x2 = SVG_CX + SVG_R * Math.cos(toRad(end))
  const y2 = SVG_CY + SVG_R * Math.sin(toRad(end))
  return `M ${SVG_CX} ${SVG_CY} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${SVG_R} ${SVG_R} 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
}

function getWedgeCentroid(i) {
  const cx = 50, cy = 50
  const mid = (-90 + i * 72 + 36) * (Math.PI / 180)
  const r = 33
  return { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) }
}

const WEDGE_PATHS   = [0, 1, 2, 3, 4].map(getWedgePath)
const WEDGE_CENTERS = [0, 1, 2, 3, 4].map(getWedgeCentroid)


function GameBoard({
  puzzle, puzzleNumber, puzzleIndex, totalPuzzles, completedIndices, puzzleResults,
  selectedLieId, selectedPlayer,
  submitted,
  onSelectLie, onSelectPlayer,
  onSubmit, onGiveUp, onNext, onPrev, onGoTo,
  onGenerate, onPlayerPuzzle, generating,
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
      if (e.key === 'ArrowLeft')  { onPrev(); return }
      if (e.key === 'ArrowRight') { onNext(); return }
      const tag = document.activeElement?.tagName
      const alreadyTyping = tag === 'INPUT' || tag === 'TEXTAREA'
      if (!submitted && !alreadyTyping && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onPrev, onNext, submitted])

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

  const playerCorrect = submitted && selectedPlayer.trim().toLowerCase() === puzzle.playerName.toLowerCase()
  const lieCorrect    = submitted && selectedLieId === puzzle.falseFactId
  const canSubmit     = selectedLieId !== null && selectedPlayer.trim().length > 0 && !submitted
  const score         = submitted ? (playerCorrect ? 1 : 0) + (lieCorrect ? 1 : 0) : null

  const handleShare = () => {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    navigator.clipboard?.writeText(
      `🏈 NFL Lie Detector — ${dateStr}\n${playerCorrect ? '✅' : '❌'} Player  ${lieCorrect ? '✅' : '❌'} Lie`
    ).catch(() => {})
  }

  return (
    <div className="puzzle-game">

      <div className="puzzle-header">
        <p className="puzzle-score"><span className="score-val">{displayScore}</span> / 30 PTS</p>
      </div>

      {!submitted ? (
        <div className="submit-section">
          <button className="submit-btn" onClick={onSubmit} disabled={!canSubmit}>
            {canSubmit ? 'LOCK IN →' : 'Mark the lie and guess the player'}
          </button>
          <button className="give-up-btn" onClick={onGiveUp}>
            Give Up
          </button>
        </div>
      ) : (
        <div className="submit-result-row">
          <div className={`submit-result-chip ${playerCorrect ? 'src-correct' : 'src-wrong'}`}>
            <span className="src-icon">{playerCorrect ? '✓' : '✗'}</span>
            <span className="src-label">PLAYER</span>
            <span className="src-pts">{playerCorrect ? '+4' : '+0'}</span>
          </div>
          <div className={`submit-result-chip ${lieCorrect ? 'src-correct' : 'src-wrong'}`}>
            <span className="src-icon">{lieCorrect ? '✓' : '✗'}</span>
            <span className="src-label">LIE SPOTTED</span>
            <span className="src-pts">{playerCorrect && lieCorrect ? '+6' : '+0'}</span>
          </div>
        </div>
      )}

      {/* ── Circle ───────────────────────────────────── */}
      <div className="circle-nav-row">
        <button className="circle-nav-btn" onClick={onPrev} aria-label="Previous puzzle">&#8592;</button>

        <div className="circle-game">

        {/* SVG wedges — proper arcs for perfectly even gaps */}
        <svg className="circle-svg" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
          {puzzle.facts.map((fact, i) => {
            const isSelected  = selectedLieId === fact.id
            const isFalse     = fact.id === puzzle.falseFactId
            const isWrongPick = submitted && isSelected && !isFalse
            const isHov       = hoveredIdx === i

            let fill = '#161a2e'
            if (submitted) {
              fill = isFalse ? 'rgba(255,34,68,0.35)' : 'rgba(0,240,128,0.18)'
              if (isWrongPick) fill = 'rgba(255,34,68,0.52)'
            } else if (isSelected) {
              fill = 'rgba(255,34,68,0.28)'
            } else if (isHov) {
              fill = '#20263e'
            }

            return (
              <path
                key={fact.id}
                d={WEDGE_PATHS[i]}
                fill={fill}
                stroke="#0d0d0d"
                strokeWidth="4"
                strokeLinejoin="round"
                style={{ cursor: submitted ? 'default' : 'pointer', transition: 'fill 0.18s' }}
                onClick={() => !submitted && onSelectLie(isSelected ? null : fact.id)}
                onMouseEnter={() => !submitted && setHoveredIdx(i)}
                onMouseLeave={() => !submitted && setHoveredIdx(null)}
              />
            )
          })}
          {/* Outer ring border */}
          <circle cx="300" cy="300" r="298" fill="none" stroke="#2e2e2e" strokeWidth="2"/>
        </svg>

        {/* Text labels at wedge centroids (pointer-events: none) */}
        {puzzle.facts.map((fact, i) => {
          const { x, y } = WEDGE_CENTERS[i]
          const isSelected = selectedLieId === fact.id
          const isHovered  = hoveredIdx === i
          const isFalse    = fact.id === puzzle.falseFactId
          const display    = parseFact(fact.text)

          let cls = 'wedge-label'
          if (submitted)       cls += isFalse ? ' wl-false' : ' wl-true'
          else if (isSelected) cls += ' wl-selected'
          else if (isHovered)  cls += ' wl-hovered'

          return (
            <div
              key={fact.id}
              className={cls}
              style={{ left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` }}
            >
              <span className="wl-num">{display.label}</span>
              {display.isTeams ? (
                <div className={`wl-logos${display.value.split(', ').length >= 3 ? ' wl-logos--sm' : ''}`}>
                  {display.value.split(', ').map(team => {
                    const src = teamLogo(team)
                    return src
                      ? <img key={team} src={src} alt={team} className="wl-logo" title={team} />
                      : <span key={team} className="wl-text wl-value">{team}</span>
                  })}
                </div>
              ) : display.isCollege ? (
                <div className="wl-logos">
                  {(() => {
                    const src = collegeLogo(display.value)
                    return src
                      ? <img src={src} alt={display.value} className="wl-logo wl-logo-college" title={display.value} />
                      : <p className="wl-text wl-value">{display.value}</p>
                  })()}
                </div>
              ) : (
                <p className="wl-text wl-value">{display.value}</p>
              )}
              {display.sublabel && <span className="wl-sublabel">{display.sublabel}</span>}
              {!submitted && (isSelected || isHovered) && (
                <span className="wl-tag">
                  {isSelected ? '\u2717 MARKED AS LIE' : 'MARK AS LIE?'}
                </span>
              )}
              {submitted && (
                <span className={`wl-verdict ${isFalse ? 'wlv-false' : 'wlv-true'}`}>
                  {isFalse ? '\u2717 LIE' : '\u2713 TRUE'}
                </span>
              )}
            </div>
          )
        })}

        {/* Center: helmet + search/reveal */}
        <div className="circle-center">

          {!submitted ? (
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

        <button className="circle-nav-btn" onClick={onNext} aria-label="Next puzzle">&#8594;</button>
      </div>{/* end circle-nav-row */}

      {/* ── Pagination dots ──────────────────────────── */}
      <div className="puzzle-dots">
        {(() => {
          const VISIBLE = 5
          let start = Math.max(0, Math.min(puzzleIndex - 2, totalPuzzles - VISIBLE))
          const end = Math.min(start + VISIBLE, totalPuzzles)
          return Array.from({ length: end - start }, (_, i) => start + i).map(idx => {
            const result = puzzleResults?.[idx]
            const icon = result === 'perfect' ? '✓' : result === 'partial' ? '–' : result === 'wrong' ? '✗' : null
            return (
              <button
                key={idx}
                className={`puzzle-dot ${idx === puzzleIndex ? 'dot-active' : ''} ${result ? `dot-${result}` : ''}`}
                onClick={() => onGoTo(idx)}
                aria-label={`Puzzle ${idx + 1}`}
              >
                {icon && <span className="dot-check">{icon}</span>}
              </button>
            )
          })
        })()}
      </div>

      {/* ── Generate button ───────────────────────────── */}
      {onGenerate && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
          <button
              className="submit-btn submit-btn--green"
            onClick={onGenerate}
            disabled={generating}
            style={{ opacity: generating ? 0.6 : 1, minWidth: '10rem' }}
          >
            {generating ? 'Generating…' : '🎲 New Puzzles'}
          </button>
        </div>
      )}

      {/* ── Custom player puzzle ──────────────────────── */}
      {onPlayerPuzzle && (
        <form
          className="custom-player-form"
          onSubmit={e => { e.preventDefault(); const v = e.target.pname.value.trim(); if (v) onPlayerPuzzle(v) }}
        >
          <input
            name="pname"
            className="custom-player-input"
            placeholder="Enter a player name…"
            autoComplete="off"
            spellCheck="false"
          />
          <button type="submit" className="custom-player-btn" disabled={generating}>
            {generating ? '…' : 'Go'}
          </button>
        </form>
      )}

    </div>
  )
}

export default GameBoard

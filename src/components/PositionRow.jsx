import { useState, useRef, useEffect, useCallback } from 'react'
import { yearRange } from '../data/mockData'
import { teamLogo } from '../utils/teamLogo'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function useCountUp(target, active) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!active || !target) return
    setDisplay(0)
    const duration = 800
    const steps = 40
    const interval = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const progress = 1 - Math.pow(1 - step / steps, 3)
      setDisplay(Math.round(progress * target * 10) / 10)
      if (step >= steps) {
        setDisplay(target)
        clearInterval(timer)
      }
    }, interval)
    return () => clearInterval(timer)
  }, [active, target])
  return display
}

function PositionRow({ position, selection, result, isLocked, onUpdate, onLock }) {
  const [query, setQuery]           = useState('')
  const [dropdownOpen, setDropdown] = useState(false)
  const [results, setResults]       = useState([])
  const [searching, setSearching]   = useState(false)
  const [playerSeasons, setPlayerSeasons] = useState([])
  const wrapRef    = useRef(null)
  const debounceRef = useRef(null)

  // Map position id to API position filter
  const positionFilter = {
    QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', DP: null
  }[position.id]

  // Debounced API search
  const searchPlayers = useCallback((q) => {
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setDropdown(false); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q })
        if (positionFilter)   params.set('position', positionFilter)
        if (position.yearMin) params.set('yearMin',  position.yearMin)
        if (position.yearMax) params.set('yearMax',  position.yearMax)
        const res = await fetch(`${API}/players/search?${params}`)
        const data = await res.json()
        setResults(data)
        setDropdown(data.length > 0)
      } catch (e) {
        console.error('Search error', e)
      } finally {
        setSearching(false)
      }
    }, 250)
  }, [positionFilter])

  // Filter year dropdown to constraint range
  const eligibleYears = yearRange.filter(y =>
    y >= (position.yearMin ?? 1970) && y <= (position.yearMax ?? 2026)
  )

  const handleQueryChange = e => {
    const val = e.target.value
    setQuery(val)
    if (!val) { onUpdate('player', null); setResults([]) }
    searchPlayers(val)
  }

  const handleSelect = async item => {
    setQuery(item.name)
    setDropdown(false)
    // Fetch this player's seasons to get per-year team
    try {
      const res = await fetch(`${API}/players/${item.id}/seasons`)
      const seasons = await res.json()
      setPlayerSeasons(seasons)
    } catch (e) {
      setPlayerSeasons([])
    }
    onUpdate('player', {
      id: item.id,
      name: item.name,
      position: item.position,
      team: item.teams?.filter(Boolean).join(', ') || '',
      primaryTeam: item.teams?.filter(Boolean)[0] || '',
      years: `${item.first_season}–${item.last_season}`,
    })
  }

  const handleClear = () => {
    setQuery('')
    setDropdown(false)
    setResults([])
    onUpdate('player', null)
  }

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const animatedPoints = useCountUp(result?.points, isLocked && !!result)

  // Derive team for the selected year from fetched seasons
  const ABB_TO_FULL = {
    'ARI':'Arizona Cardinals','ATL':'Atlanta Falcons','BAL':'Baltimore Ravens','BUF':'Buffalo Bills',
    'CAR':'Carolina Panthers','CHI':'Chicago Bears','CIN':'Cincinnati Bengals','CLE':'Cleveland Browns',
    'DAL':'Dallas Cowboys','DEN':'Denver Broncos','DET':'Detroit Lions','GB':'Green Bay Packers',
    'HOU':'Houston Texans','IND':'Indianapolis Colts','JAX':'Jacksonville Jaguars','KC':'Kansas City Chiefs',
    'LV':'Las Vegas Raiders','LAC':'Los Angeles Chargers','LA':'Los Angeles Rams','MIA':'Miami Dolphins',
    'MIN':'Minnesota Vikings','NE':'New England Patriots','NO':'New Orleans Saints','NYG':'New York Giants',
    'NYJ':'New York Jets','PHI':'Philadelphia Eagles','PIT':'Pittsburgh Steelers','SF':'San Francisco 49ers',
    'SEA':'Seattle Seahawks','TB':'Tampa Bay Buccaneers','TEN':'Tennessee Titans','WAS':'Washington Commanders',
  }
  const yearSeason    = playerSeasons.find(s => String(s.season_year) === String(selection.year))
  const portraitTeam  = yearSeason ? (ABB_TO_FULL[yearSeason.team] || yearSeason.team) : selection.player?.primaryTeam

  const isFilled = Boolean(selection.year && selection.player)
  const initials = selection.player?.name
    ? selection.player.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : null

  let rowExtra = ''
  if (isLocked) {
    rowExtra = ' row-locked'
  } else if (isFilled) {
    rowExtra = ' row-filled'
  }

  const searchPlaceholder = `Search ${position.fullName.toLowerCase()}…`

  return (
    <div
      className={`position-row${rowExtra}`}
      style={{ '--row-color': position.color }}
    >

      {/* ── LEFT: color bar + constraints ── */}
      <div className="row-left">
        <div className="row-color-bar" style={{ background: position.color }} />
        <div className="row-left-content">
          <div className="pos-header">
            <div className="position-meta">
              <span className="position-full-name">{position.fullName}</span>
            </div>
          </div>
          <div className="constraints-list">
            {position.constraints.map((c, i) => (
              <div key={i} className="constraint-tag">
                {c.teams?.length > 0 && (
                  <span className="constraint-logos">
                    {c.teams.map(t => {
                      const logo = teamLogo(t)
                      return logo
                        ? <span key={t} className={`constraint-logo-wrap${c.excluded ? ' constraint-logo-excluded' : ''}`}>
                            <img src={logo} className="constraint-team-logo" alt={t} title={t} />
                          </span>
                        : null
                    })}
                  </span>
                )}
                {!c.teams?.length && <span className="constraint-text">{c.text}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CENTER: inputs + lock button ── */}
      <div className="row-center">
        <div className="inputs-row">
          <div className="input-group">
            <label className="input-label">Season</label>
            <select
              className="year-select"
              value={selection.year}
              onChange={e => onUpdate('year', e.target.value)}
              disabled={isLocked}
            >
              <option value="">Year</option>
              {eligibleYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="input-group search-group" ref={wrapRef}>
            <label className="input-label">
              Player Name
            </label>
            <div className="search-input-container">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                className="player-search-input"
                placeholder={searchPlaceholder}
                value={query}
                onChange={handleQueryChange}
                onFocus={() => query.length > 0 && setDropdown(true)}
                disabled={isLocked}
                autoComplete="off"
              />
              {query && !isLocked && (
                <button className="clear-search-btn" onClick={handleClear} aria-label="Clear">✕</button>
              )}
            </div>

            {dropdownOpen && (
              <ul className="player-dropdown">
                {searching && <li className="dropdown-item no-results">Searching…</li>}
                {!searching && results.length > 0
                  ? results.map(item => (
                      <li
                        key={item.id}
                        className="dropdown-item"
                        onMouseDown={() => handleSelect(item)}
                      >
                        <div className="dropdown-item-left">
                          {teamLogo(item.teams?.[0]) && (
                            <img src={teamLogo(item.teams?.[0])} alt="" className="dropdown-team-logo" />
                          )}
                          <span className="dropdown-player-name">{item.name}</span>
                        </div>
                        <span className="dropdown-player-meta">
                          {item.position}
                          {' · '}{item.first_season}–{item.last_season}
                        </span>
                      </li>
                    ))
                  : !searching && <li className="dropdown-item no-results">No results for "{query}"</li>
                }
              </ul>
            )}
          </div>

          {/* Lock button inline next to search */}
          <div className="input-group lock-group">
            <label className="input-label">&nbsp;</label>
            {!isLocked ? (
              <button
                className="lock-btn"
                onClick={isFilled ? onLock : undefined}
                disabled={!isFilled}
              >
                {isFilled ? '🔒 Lock In' : '🔒'}
              </button>
            ) : (
              <div className="locked-status">🔒 Locked</div>
            )}
          </div>
        </div>
      </div>

      {/* ── PORTRAIT ── */}
      <div className="row-portrait">
        {selection.player ? (
          <div className="player-card">
            {teamLogo(portraitTeam) ? (
              <div
                className="player-avatar player-avatar--logo"
                style={{ background: `${position.color}18`, border: `2px solid ${position.color}66` }}
              >
                <img
                  src={teamLogo(portraitTeam)}
                  alt={portraitTeam}
                  className="player-avatar-logo-img"
                />
              </div>
            ) : (
              <div
                className="player-avatar"
                style={{ background: position.color }}
              >
                {initials}
              </div>
            )}
            <div className="player-card-info">
              <div className="player-card-name">{selection.player.name}</div>
              <div className="player-card-team">{portraitTeam || selection.player.team}</div>
              {selection.year && <div className="player-card-year">{selection.year}</div>}
            </div>
          </div>
        ) : (
          <div className="player-placeholder">
            <div className="placeholder-avatar">?</div>
            <span className="placeholder-text">No selection</span>
          </div>
        )}
      </div>

      {/* ── POINTS ── */}
      <div className="row-points">
        {isLocked && result ? (
          <div className="points-display correct">
            <div className="points-value">{animatedPoints.toFixed(1)}</div>
            <div className="points-label">FPTS</div>
          </div>
        ) : (
          <div className="points-locked">
            <span className="lock-symbol">🔒</span>
          </div>
        )}
      </div>

    </div>
  )
}

export default PositionRow

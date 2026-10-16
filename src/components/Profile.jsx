import { useState, useEffect, Fragment } from 'react'
import { formatDate } from '../utils/formatDate'
import WheelSpinner from './WheelSpinner'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const LINEUP_LOGOS = ['NFL', 'NBA', 'MLB', 'NHL', 'College', 'Old']

// red per miss then green, like the share text
const tries = (got, attempts) => got ? '🟥'.repeat(Math.max(0, attempts - 1)) + '🟩' : '🟥🟥🟥'

// a line per game that existed that day
function gameLines(day, starts) {
  const p = day.pick6, f = day.filmroom, l = day.lineup
  return [
    { game: 'Pick 6', score: p?.score, detail: p && [`Lie ${tries(p.lieFound, p.lieAttempts)}`, `Player ${p.playerCorrect ? '🟩' : '🟥'}`] },
    // year: 🟩 exact, 🟨 one off, 🟥 missed
    { game: 'Film Room', score: f?.score, detail: f && [`Team ${tries(f.teamFound, f.teamAttempts)}`, `Year ${f.yearScore === 3 ? '🟩' : f.yearScore === 1 ? '🟨' : '🟥'}`] },
    { game: 'Logo Lineup', score: l?.score, detail: l && l.logos.map((x, i) => `${LINEUP_LOGOS[i]} ${tries(x.solved, x.attempts)}`) },
  ].filter((line, i) => !starts || day.date >= starts[['pick6', 'filmroom', 'lineup'][i]])
}

const PAGE_DAYS = 14

// every day from end back to start, newest first
function calendar(start, end, played) {
  const byDate = new Map(played.map(d => [d.date, d]))
  const out = []
  for (let d = new Date(`${end}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() - 1)) {
    const date = d.toISOString().slice(0, 10)
    out.push(byDate.get(date) || { date })
    if (date <= start) break
  }
  return out
}

function PerDayStats() {
  const [days, setDays] = useState(null)       // days loaded so far
  const [oldest, setOldest] = useState(null)   // oldest day loaded
  const [more, setMore] = useState(false)      // more days to load
  const [starts, setStarts] = useState(null)   // each game's first day
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)

  // 14 days ending on `end` (today by default)
  const loadPage = end => {
    const q = new URLSearchParams({ days: PAGE_DAYS, ...(end ? { end } : {}) })
    return fetch(`${API}/auth/history?${q}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(page => {
        setDays(prev => [...(prev || []), ...calendar(page.start, page.end, page.days)])
        setOldest(page.start)
        setMore(page.more)
        setStarts(page.starts)
      })
  }

  useEffect(() => { loadPage(null).catch(() => setError(true)) }, [])

  const loadMore = () => {
    if (loadingMore || !oldest) return
    setLoadingMore(true)
    const prevDay = new Date(`${oldest}T00:00:00Z`)
    prevDay.setUTCDate(prevDay.getUTCDate() - 1)
    loadPage(prevDay.toISOString().slice(0, 10))
      .catch(() => alert("Couldn't load more days, try again"))
      .finally(() => setLoadingMore(false))
  }

  return (
    <div className="legal-section">
      <h2 className="htp-section-title stats-title">Per day stats</h2>
      {error && <p className="board-empty">Couldn't load your stats right now.</p>}
      {!error && !days && (
        <div className="loading-wheel-wrap" style={{ padding: '24px 0' }}>
          <WheelSpinner size={40} />
        </div>
      )}
      {days && (
        <ul className="stats-list">
          {days.map(day => (
            <li key={day.date} className="stats-day">
              <span className="stats-date">{formatDate(day.date)}</span>
              {gameLines(day, starts).map(line => (
                <div key={line.game} className={`stats-game${line.detail ? '' : ' stats-game--none'}`}>
                  <span className="stats-game-name">{line.game}</span>
                  <span className="stats-detail">
                    {/* keep each piece on one line */}
                    {line.detail
                      ? line.detail.map((d, i) => <Fragment key={i}>{i > 0 && ' · '}<span className="stats-item">{d}</span></Fragment>)
                      : 'not played'}
                  </span>
                  {/* green 6, gold in between, red 0 */}
                  <span className={`stats-score${line.detail ? ` stats-score--${line.score === 6 ? 'good' : line.score === 0 ? 'bad' : 'mid'}` : ''}`}>
                    {line.detail ? `${line.score}/6` : '–'}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {/* only if there are older days */}
      {days && more && (
        <button className="profile-btn stats-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <><span className="fr-spinner" aria-hidden="true" />Loading…</> : `Load ${PAGE_DAYS} more days`}
        </button>
      )}
    </div>
  )
}

const CONFIRM_WORD = 'DELETE'

export default function Profile({ user, onUserUpdated, onDeleted }) {
  const [name,    setName]    = useState(user?.displayName || '')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [error,   setError]   = useState('')

  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  if (!user) {
    return (
      <div className="htp-page">
        <div className="htp-card">
          <h2 className="htp-section-title">Profile</h2>
          <p>You need to be signed in to view your profile.</p>
        </div>
      </div>
    )
  }

  const trimmed = name.trim()
  const unchanged = trimmed === (user.displayName || '')
  const canSave = !saving && trimmed.length >= 2 && !unchanged

  const saveUsername = () => {
    if (!canSave) return
    setSaving(true); setError(''); setSavedAt(false)
    fetch(`${API}/auth/username`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: trimmed }),
    })
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Could not save username')
        onUserUpdated(data.user)
        setSavedAt(true)
      })
      .catch(err => setError(err.message))
      .finally(() => setSaving(false))
  }

  const deleteAccount = () => {
    if (confirmText !== CONFIRM_WORD || deleting) return
    setDeleting(true); setError('')
    fetch(`${API}/auth/account`, { method: 'DELETE', credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data.error || 'Could not delete account')
        onDeleted()
      })
      .catch(err => { setError(err.message); setDeleting(false) })
  }

  return (
    <div className="htp-page">
      <div className="htp-card">
        <div className="profile-row">
          <span className="profile-label">Signed in as</span>
          <span className="profile-value">{user.email}</span>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Username</h2>
          <p>This is the name shown on the leaderboard.</p>
          <div className="profile-edit-row">
            <input
              className="profile-input"
              value={name}
              maxLength={20}
              onChange={e => { setName(e.target.value); setSavedAt(false); setError('') }}
              onKeyDown={e => e.key === 'Enter' && saveUsername()}
              aria-label="Username"
            />
            <button className="profile-btn" disabled={!canSave} onClick={saveUsername}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="profile-hint">
            2 to 20 characters, letters numbers spaces hyphens and underscores
          </p>
          {savedAt && <p className="profile-ok">Username updated</p>}
        </div>

        <PerDayStats />

        <div className="legal-section">
          <h2 className="htp-section-title">Delete account</h2>
          <p>
            This permanently deletes your account along with every puzzle result and
            in-progress guess tied to it. Your scores disappear from the leaderboard.
            This cannot be undone.
          </p>

          {!confirming ? (
            <button className="profile-btn profile-btn--danger" onClick={() => setConfirming(true)}>
              Delete account
            </button>
          ) : (
            <div className="profile-danger-box">
              <p className="profile-hint">
                Type <strong>{CONFIRM_WORD}</strong> to confirm.
              </p>
              <div className="profile-edit-row">
                <input
                  className="profile-input"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  autoFocus
                  aria-label={`Type ${CONFIRM_WORD} to confirm`}
                />
                <button
                  className="profile-btn profile-btn--danger"
                  disabled={confirmText !== CONFIRM_WORD || deleting}
                  onClick={deleteAccount}
                >
                  {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
                <button
                  className="profile-btn"
                  disabled={deleting}
                  onClick={() => { setConfirming(false); setConfirmText('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="profile-error">{error}</p>}
      </div>
    </div>
  )
}

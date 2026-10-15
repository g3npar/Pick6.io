import { useState, useEffect, Fragment } from 'react'
import { formatDate } from '../utils/formatDate'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const LINEUP_LOGOS = ['NFL', 'NBA', 'MLB', 'NHL', 'College', 'Old']

// one line per game, points plus how the attempts went
// same squares as the share text: a red one per miss, then green for the one you got
const tries = (got, attempts) => got ? '🟥'.repeat(Math.max(0, attempts - 1)) + '🟩' : '🟥🟥🟥'

// every game gets a line each day, the ones you didn't finish say so
function gameLines(day) {
  const p = day.pick6, f = day.filmroom, l = day.lineup
  return [
    { game: 'Pick 6', score: p?.score, detail: p && [`Lie ${tries(p.lieFound, p.lieAttempts)}`, `Player ${p.playerCorrect ? '🟩' : '🟥'}`] },
    // year is 🟩 exact, 🟨 one off, 🟥 missed, like the Film Room share text
    { game: 'Film Room', score: f?.score, detail: f && [`Team ${tries(f.teamFound, f.teamAttempts)}`, `Year ${f.yearScore === 3 ? '🟩' : f.yearScore === 1 ? '🟨' : '🟥'}`] },
    { game: 'Logo Lineup', score: l?.score, detail: l && l.logos.map((x, i) => `${LINEUP_LOGOS[i]} ${tries(x.solved, x.attempts)}`) },
  ]
}

function PerDayStats() {
  const [days, setDays] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${API}/auth/history`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setDays)
      .catch(() => setError(true))
  }, [])

  return (
    <div className="legal-section">
      <h2 className="htp-section-title stats-title">Per day stats</h2>
      {error && <p className="board-empty">Couldn't load your stats right now.</p>}
      {!error && !days && <p className="profile-hint">Loading…</p>}
      {days && days.length === 0 && <p className="board-empty">Finish a puzzle and it'll show up here.</p>}
      {days && days.length > 0 && (
        <ul className="stats-list">
          {days.map(day => (
            <li key={day.date} className="stats-day">
              <span className="stats-date">{formatDate(day.date)}</span>
              {gameLines(day).map(line => (
                <div key={line.game} className={`stats-game${line.detail ? '' : ' stats-game--none'}`}>
                  <span className="stats-game-name">{line.game}</span>
                  <span className="stats-detail">
                    {/* each piece stays on one line, so a logo's squares never split across lines */}
                    {line.detail
                      ? line.detail.map((d, i) => <Fragment key={i}>{i > 0 && ' · '}<span className="stats-item">{d}</span></Fragment>)
                      : 'not played'}
                  </span>
                  <span className="stats-score">{line.detail ? `${line.score}/6` : '–'}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
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

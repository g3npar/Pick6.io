import { useState, useEffect } from 'react'
import { formatDate } from '../utils/formatDate'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const LINEUP_LOGOS = ['NFL', 'NBA', 'MLB', 'NHL', 'College', 'Old']

// one line per game, points plus how the attempts went
function gameLines(day) {
  const lines = []
  if (day.pick6) {
    const p = day.pick6
    lines.push({
      game: 'Pick 6', score: p.score,
      detail: [p.lieFound ? `lie on attempt ${p.lieAttempts}` : 'lie missed', p.playerCorrect ? 'player ✓' : 'player ✗'],
    })
  }
  if (day.filmroom) {
    const f = day.filmroom
    const year = f.yearScore === 3 ? 'exact year' : f.yearScore === 1 ? 'year 1 off' : f.gaveUp ? 'gave up' : 'year missed'
    lines.push({
      game: 'Film Room', score: f.score,
      detail: [f.teamFound ? `team on attempt ${f.teamAttempts}` : 'team missed', year],
    })
  }
  if (day.lineup) {
    lines.push({
      game: 'Logo Lineup', score: day.lineup.score,
      // attempt it was solved on, or ✗
      detail: day.lineup.logos.map((l, i) => `${LINEUP_LOGOS[i]} ${l.solved ? l.attempts : '✗'}`),
    })
  }
  return lines
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
      <h2 className="htp-section-title">Per day stats</h2>
      {error && <p className="board-empty">Couldn't load your stats right now.</p>}
      {!error && !days && <p className="profile-hint">Loading…</p>}
      {days && days.length === 0 && <p className="board-empty">Finish a puzzle and it'll show up here.</p>}
      {days && days.length > 0 && (
        <ul className="stats-list">
          {days.map(day => (
            <li key={day.date} className="stats-day">
              <span className="stats-date">{formatDate(day.date)}</span>
              {gameLines(day).map(line => (
                <div key={line.game} className="stats-game">
                  <span className="stats-game-name">{line.game}</span>
                  <span className="stats-detail">{line.detail.join(' · ')}</span>
                  <span className="stats-score">{line.score}/6</span>
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

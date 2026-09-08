import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
        <h2 className="htp-section-title">Profile</h2>

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

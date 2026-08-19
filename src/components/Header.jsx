import { useState, Fragment } from 'react'
import SignInButton from './SignInButton'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function Header({ screen, onNav, user, onSignedIn, onSignOut, onUserUpdated }) {
  const [editing, setEditing] = useState(false)
  const [name,    setName]    = useState('')
  const [saving,  setSaving]  = useState(false)

  const links = [
    { id: 'daily',       label: 'Daily' },
    { id: 'archive',     label: 'Archive' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'how-to-play', label: 'How to Play' },
    ...(user?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ]

  const startEditing = () => { setName(user.displayName); setEditing(true) }

  const saveUsername = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === user.displayName) { setEditing(false); return }
    setSaving(true)
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
        setEditing(false)
      })
      .catch(err => alert(err.message))
      .finally(() => setSaving(false))
  }

  return (
    <header className="header">
      <div className="header-inner">

        <div className="header-spacer" aria-hidden="true" />

        <div className="header-center">
          {/* Logo */}
          <button className="logo" onClick={() => onNav('daily')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <span className="logo-word">PICK</span>
            <img src="/pick-six-logo.svg" alt="Pick Six" className="logo-icon" />
            <span className="logo-suffix">.io</span>
          </button>

          {/* Nav */}
          <nav className="nav">
            {links.map((l, i) => (
              <Fragment key={l.id}>
                {i > 0 && <span className="nav-divider" aria-hidden="true" />}
                <button
                  className={`nav-link${screen === l.id ? ' active' : ''}`}
                  onClick={() => onNav(l.id)}
                >
                  {l.label}
                </button>
              </Fragment>
            ))}
          </nav>
        </div>

        {/* Account */}
        <div className="header-right">
          {user ? (
            <div className="user-chip">
              {editing ? (
                <>
                  <input
                    className="username-edit-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveUsername()}
                    autoFocus
                    maxLength={20}
                  />
                  <button className="header-icon-btn" disabled={saving} onClick={saveUsername}>Save</button>
                  <button className="header-icon-btn" onClick={() => setEditing(false)}>✕</button>
                </>
              ) : (
                <>
                  <span className="user-name">{user.displayName}</span>
                  <button className="header-icon-btn" onClick={startEditing} aria-label="Edit username">✎</button>
                  <button className="header-icon-btn" onClick={onSignOut}>Sign out</button>
                </>
              )}
            </div>
          ) : (
            <SignInButton onSignedIn={onSignedIn} />
          )}
        </div>

      </div>
    </header>
  )
}

export default Header

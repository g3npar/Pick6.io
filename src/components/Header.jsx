import { useState, useRef, useEffect, Fragment } from 'react'
import SignInButton from './SignInButton'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function Header({ screen, onNav, user, onSignedIn, onSignOut, onUserUpdated }) {
  const [editing, setEditing] = useState(false)
  const [name,    setName]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const logoWrapRef = useRef(null)

  const links = [
    { id: 'daily',       label: 'Daily' },
    { id: 'archive',     label: 'Archive' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'how-to-play', label: 'How to Play' },
    ...(user?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ]

  // On mobile the horizontal nav is hidden, so tapping the logo opens a
  // dropdown of the same links instead of jumping straight to Daily.
  const handleLogoClick = () => {
    if (window.matchMedia('(max-width: 600px)').matches) {
      setMobileNavOpen(open => !open)
    } else {
      onNav('daily')
    }
  }

  const handleMobileNav = id => { onNav(id); setMobileNavOpen(false) }

  useEffect(() => {
    const handler = e => {
      if (logoWrapRef.current && !logoWrapRef.current.contains(e.target)) setMobileNavOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

        {/* Logo, opens a dropdown of the nav links on mobile */}
        <div className="logo-wrap" ref={logoWrapRef}>
          <button className="logo" onClick={handleLogoClick} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <span className="logo-word">PICK</span>
            <img src="/pick-six-logo.svg" alt="Pick6.io" className="logo-icon" />
            <span className="logo-suffix">.io</span>
            <span className="logo-caret" aria-hidden="true">▾</span>
          </button>
          {mobileNavOpen && (
            <ul className="mobile-nav-dropdown">
              {links.map(l => (
                <li key={l.id}>
                  <button
                    className={`mobile-nav-item${screen === l.id ? ' active' : ''}`}
                    onClick={() => handleMobileNav(l.id)}
                  >
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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

import { useState, useRef, useEffect, Fragment } from 'react'
import SignInButton from './SignInButton'

function Header({ screen, onNav, user, onSignedIn, onSignOut }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const logoWrapRef = useRef(null)

  const links = [
    { id: 'daily',       label: 'Daily' },
    { id: 'archive',     label: 'Archive' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'how-to-play', label: 'How to Play' },
    ...(user?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ]

  // mobile logo opens nav dropdown
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
              <button
                className={`user-name-btn${screen === 'profile' ? ' user-name-btn--active' : ''}`}
                onClick={() => onNav('profile')}
                aria-label="Open profile"
              >
                {user.displayName}
              </button>
              <button className="header-icon-btn header-icon-btn--danger" onClick={onSignOut}>Sign out</button>
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

import SignInButton from './SignInButton'

function Header({ screen, onNav, user, onSignedIn, onSignOut }) {
  const links = [
    { id: 'daily',       label: 'Daily' },
    { id: 'archive',     label: 'Archive' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'how-to-play', label: 'How to Play' },
  ]
  return (
    <header className="header">
      <div className="header-inner">

        {/* Logo */}
        <button className="logo" onClick={() => onNav('daily')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="logo-icon">🏈</span>
          <span className="logo-text">
            PICK<span className="logo-accent"> SIX</span>
          </span>
        </button>

        {/* Nav */}
        <nav className="nav">
          {links.map(l => (
            <button
              key={l.id}
              className={`nav-link${screen === l.id ? ' active' : ''}`}
              onClick={() => onNav(l.id)}
            >
              {l.label}
            </button>
          ))}
        </nav>

        {/* Account */}
        <div className="header-right">
          {user ? (
            <div className="user-chip">
              {user.avatarUrl && <img src={user.avatarUrl} alt="" className="user-avatar" referrerPolicy="no-referrer" />}
              <span className="user-name">{user.displayName}</span>
              <button className="header-icon-btn" onClick={onSignOut}>Sign out</button>
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

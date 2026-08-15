function Header({ screen, onNav }) {
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

      </div>
    </header>
  )
}

export default Header

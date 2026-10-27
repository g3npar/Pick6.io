import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const GAMES = [
  ['pick6', 'Pick 6'],
  ['filmroom', 'Film Room'],
  ['lineup', 'Logo Lineup'],
  ['other', 'Something else'],
]

// opens on the last game played
export default function BugReport({ defaultGame = 'pick6', user }) {
  const [game, setGame] = useState(defaultGame)
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState('idle')   // idle | sending | sent
  const [error, setError] = useState(null)

  const send = async e => {
    e.preventDefault()
    setState('sending'); setError(null)
    try {
      const res = await fetch(`${API}/bugs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ game, message, contact }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send that, try again later')
      setState('sent')
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? "Couldn't reach the server, try again in a moment" : err.message)
      setState('idle')
    }
  }

  return (
    <div className="htp-page">
      <div className="htp-card">
        <div className="legal-section">
          <h2 className="htp-section-title">Report a bug</h2>
          {state === 'sent' ? (
            <>
              <p>Thanks, got it. I'll take a look.</p>
              <button className="profile-btn" onClick={() => { setMessage(''); setState('idle') }}>Report another</button>
            </>
          ) : (
            <form className="bug-form" onSubmit={send}>
              <p>Something broken or look wrong? Tell me what happened and we'll fix it.</p>
              <label className="bug-label">
                Which game?
                <select className="profile-input" value={game} onChange={e => setGame(e.target.value)}>
                  {GAMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="bug-label">
                What happened?
                <textarea
                  className="profile-input bug-message"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={6}
                  placeholder="What you did, what you expected, and what happened instead"
                  required
                />
              </label>
              {/* signed in reports already come with your account */}
              {!user && (
                <label className="bug-label">
                  Email (optional, if you want a reply)
                  <input className="profile-input" type="email" value={contact} onChange={e => setContact(e.target.value)} maxLength={200} />
                </label>
              )}
              {error && <p className="bug-error">{error}</p>}
              <button className="profile-btn" type="submit" disabled={state === 'sending' || message.trim().length < 5}>
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

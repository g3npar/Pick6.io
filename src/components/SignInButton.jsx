import { useEffect, useRef } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

function SignInButton({ onSignedIn }) {
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) return
    let cancelled = false
    let pollTimer  = null

    const handleCredential = async ({ credential }) => {
      try {
        const res = await fetch(`${API}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ credential }),
        })
        if (!res.ok) throw new Error('Sign-in failed')
        const { user } = await res.json()
        onSignedIn(user)
      } catch (e) {
        console.error('Sign-in error:', e.message)
      }
    }

    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !buttonRef.current) return
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential })
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'medium', shape: 'pill' })
    }

    if (window.google?.accounts?.id) {
      init()
    } else {
      pollTimer = setInterval(() => {
        if (window.google?.accounts?.id) { clearInterval(pollTimer); init() }
      }, 100)
      setTimeout(() => clearInterval(pollTimer), 10000)
    }

    return () => { cancelled = true; clearInterval(pollTimer) }
  }, [onSignedIn])

  if (!GOOGLE_CLIENT_ID) return null
  return <div ref={buttonRef} />
}

export default SignInButton

import { useEffect, useState } from 'react'
import { trackEvent } from '../utils/track'

const DISMISS_KEY = 'pick6_install_dismissed'
const DISMISS_DAYS = 7

// Chrome on Android hands over its install dialog with this event. it can fire before React
// mounts, so it's caught as soon as this file loads
let deferred = null
const listeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e
    listeners.forEach(fn => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    trackEvent('install')
    listeners.forEach(fn => fn())
  })
}

const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const isPhone = () => window.matchMedia('(max-width: 768px)').matches || /Android|iPhone|iPad|iPod/.test(navigator.userAgent)
const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 86400000 } catch { return false }
}

// "add to home screen" on today's results screen, phones only and never once installed.
// Android gets the real install dialog, iPhone gets the Share steps (Safari doesn't let sites install)
export default function InstallPrompt() {
  const [, rerender] = useState(0)
  const [showTip, setShowTip] = useState(false)
  const [hidden, setHidden] = useState(dismissedRecently)

  useEffect(() => {
    const fn = () => rerender(n => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  if (hidden || installed() || !isPhone()) return null
  // Android without the event: Chrome isn't offering it right now, so don't show a button that can't work
  if (!deferred && !isIOS()) return null

  const install = async () => {
    if (deferred) {
      deferred.prompt()
      await deferred.userChoice.catch(() => null)
      deferred = null
      rerender(n => n + 1)
    } else {
      setShowTip(v => !v)
    }
  }
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setHidden(true)
  }

  return (
    <div className="install-prompt">
      <button className="install-btn" onClick={install}>Add Pick6 to your home screen</button>
      {showTip && (
        <p className="install-tip">
          Tap <strong>Share</strong> <span aria-hidden="true">(the square with the arrow)</span>, then <strong>Add to Home Screen</strong>.
        </p>
      )}
      <button className="install-dismiss" onClick={dismiss}>Not now</button>
    </div>
  )
}

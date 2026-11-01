import { anonId, todayNY } from './percentile'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const VISIT_KEY = 'pick6_visit_day'

const send = (path, body) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  keepalive: true,
}).catch(() => {})

// once a day per browser, so the admin page can count visitors and who comes back
export function trackVisit() {
  const today = todayNY()
  try { if (localStorage.getItem(VISIT_KEY) === today) return } catch {}
  const id = anonId()
  if (!id) return
  send('/track/visit', { anonId: id })
  try { localStorage.setItem(VISIT_KEY, today) } catch {}
}

// 'share' (with the game) or 'install'
export const trackEvent = (kind, game = '') => send('/track/event', { kind, game })

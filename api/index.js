require('dotenv').config({ path: '../.env' })
const express      = require('express')
const cors         = require('cors')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const https        = require('https')
const { getDailyPuzzles, generateFreshPuzzles, generatePlayerPuzzle, getDailyCurrentPuzzle } = require('./puzzle')

const app = express()

// ── Security headers (OWASP) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // API-only; no HTML served
  crossOriginEmbedderPolicy: false,
}))

// ── CORS — restrict to known origins ─────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server / curl (no origin) only in dev
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
}))

// ── Rate limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 60,                       // 60 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
})

// Tighter limit for expensive puzzle generation
const puzzleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many puzzle requests, please wait a moment.' },
})

app.use(apiLimiter)

// ── Disable information-leaking headers ──────────────────────────────────────
app.disable('x-powered-by')

// ── In-memory player cache ────────────────────────────────────────────────────
let players   = []
let cacheTime = 0
const CACHE_TTL = 24 * 60 * 60 * 1000  // 24 hours

// nflverse public players CSV — no auth needed
const PLAYERS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'

function fetchURL(url, hops = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'nfl-puzzle/1.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
        return fetchURL(res.headers.location, hops - 1).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
      else cur += ch
    }
    vals.push(cur)
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').replace(/"/g, '').trim()]))
  })
}

async function ensurePlayers() {
  if (players.length && Date.now() - cacheTime < CACHE_TTL) return

  console.log('Fetching players from nflverse…')
  const text = await fetchURL(PLAYERS_URL)
  const rows  = parseCSV(text)

  // One row per player — dedupe by display_name + position
  const seen = new Map()
  for (const r of rows) {
    const name = (r.display_name || '').trim()
    const pos  = (r.position     || '').trim()
    if (!name || !pos) continue
    const key = `${name}|${pos}`
    if (!seen.has(key)) {
      seen.set(key, {
        id:         r.gsis_id || key,
        name,
        position:   pos,
        teams:      r.latest_team ? [r.latest_team] : [],
        draft_year: r.draft_year || r.rookie_season || null,
      })
    }
  }

  players   = [...seen.values()]
  cacheTime = Date.now()
  console.log(`Cached ${players.length} players.`)
}

// Kick off the fetch immediately so the first search is fast
ensurePlayers().catch(err => console.error('Player load failed:', err.message))

// ── GET /players/search?q=mahomes ────────────────────────────────────────────
app.get('/players/search', async (req, res) => {
  const raw = String(req.query.q || '').trim()
  // Reject overly long or suspicious input
  if (raw.length < 2 || raw.length > 60) return res.json([])

  const q = raw.toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
  if (!q) return res.json([])

  try {
    await ensurePlayers()
  } catch {
    return res.status(503).json({ error: 'Player data unavailable' })
  }

  const norm = s => s.toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
  const results = players
    .filter(p => norm(p.name).includes(q))
    .slice(0, 10)

  res.json(results)
})

// ── GET /puzzle/today ────────────────────────────────────────────────────────
app.get('/puzzle/today', async (req, res) => {
  try {
    const puzzles = await getDailyPuzzles()
    res.json(puzzles)
  } catch (err) {
    console.error('Puzzle generation failed:', err.message)
    res.status(500).json({ error: 'Could not generate puzzles' })
  }
})

// ── GET /puzzle/today/current ─────────────────────────────────────────────────
app.get('/puzzle/today/current', puzzleLimiter, async (req, res) => {
  try {
    const fresh  = req.query.fresh !== undefined
    const puzzle = await getDailyCurrentPuzzle(fresh)
    res.json(puzzle)
  } catch (err) {
    console.error('Current puzzle failed:', err.message)
    res.status(500).json({ error: 'Could not generate current puzzle' })
  }
})

// ── GET /puzzle/generate (fresh random set) ───────────────────────────────────
app.get('/puzzle/generate', puzzleLimiter, async (req, res) => {
  try {
    const puzzles = await generateFreshPuzzles()
    res.json(puzzles)
  } catch (err) {
    console.error('Puzzle generation failed:', err.message)
    res.status(500).json({ error: 'Could not generate puzzles' })
  }
})

// ── GET /puzzle/player?name=Tom+Brady ─────────────────────────────────────────
app.get('/puzzle/player', puzzleLimiter, async (req, res) => {
  const raw  = String(req.query.name || '').trim()
  if (!raw || raw.length > 80) return res.status(400).json({ error: 'Invalid name' })
  // Strip anything that isn't a letter, space, apostrophe, hyphen, or dot
  const name = raw.replace(/[^a-zA-Z .'\-]/g, '').trim()
  if (!name) return res.status(400).json({ error: 'Invalid name' })
  try {
    const puzzle = await generatePlayerPuzzle(name)
    res.json(puzzle)
  } catch (err) {
    console.error('Player puzzle failed:', err.message)
    res.status(404).json({ error: err.message })
  }
})

// ── 404 for any unmatched route ───────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// ── Global error handler (never leak stack traces) ────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || process.env.API_PORT || 3001
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))


require('dotenv').config({ path: '../.env' })
const express      = require('express')
const cors         = require('cors')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const {
  getDailyPuzzles, generateFreshPuzzles, generatePlayerPuzzle, getDailyCurrentPuzzle,
  getPuzzleForDate, listArchiveDates, ensurePuzzleSchema, todayDateStr, pool,
  previewDailyPuzzle, shuffleDailyPuzzle, setScheduledPuzzle, getScheduledDates, previewUpcomingDates,
} = require('./puzzle')
const {
  cookieOptions, COOKIE_NAME, ensureAuthSchema, verifyGoogleCredential,
  upsertUser, setUsername, signSession, optionalAuth, requireAuth, isAdminEmail,
} = require('./auth')

const app = express()

// Trust Render's proxy so rate limiting uses the real client IP
app.set('trust proxy', 1)

// Security headers (OWASP)
app.use(helmet({
  contentSecurityPolicy: false,   // API-only; no HTML served
  crossOriginEmbedderPolicy: false,
}))

app.use(cookieParser())
app.use(express.json({ limit: '10kb' }))

// CORS, restricted to known origins.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server / curl (no origin) only in dev
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  credentials: true,   // required so the browser sends/accepts the session cookie
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type'],
}))

ensureAuthSchema(pool).catch(err => console.error('Auth schema init failed:', err.message))
ensurePuzzleSchema(pool).catch(err => console.error('Puzzle schema init failed:', err.message))

// Rate limiting
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

// Tighter still for auth, since it's a common abuse/brute-force target
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please slow down.' },
})

app.use(apiLimiter)

// Disable information-leaking headers
app.disable('x-powered-by')

// In-memory cache of current players, sourced from our own DB, so search never
// surfaces a retired player who happens to share a name.
let currentPlayers    = []
let playersCacheTime  = 0
const PLAYERS_CACHE_TTL = 60 * 60 * 1000  // 1 hour

async function ensureCurrentPlayers() {
  if (currentPlayers.length && Date.now() - playersCacheTime < PLAYERS_CACHE_TTL) return
  const r = await pool.query(`
    SELECT DISTINCT p.id, p.name, p.position, p.draft_year
    FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    WHERE ps.season_year = (SELECT MAX(season_year) FROM player_seasons)
  `)
  currentPlayers   = r.rows
  playersCacheTime = Date.now()
}

// GET /players/search?q=mahomes
app.get('/players/search', async (req, res) => {
  const raw = String(req.query.q || '').trim()
  // Reject overly long or suspicious input
  if (raw.length < 2 || raw.length > 60) return res.json([])

  const q = raw.toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
  if (!q) return res.json([])

  try {
    await ensureCurrentPlayers()
  } catch {
    return res.status(503).json({ error: 'Player data unavailable' })
  }

  const norm = s => s.toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
  const results = currentPlayers
    .filter(p => norm(p.name).includes(q))
    .slice(0, 10)

  res.json(results)
})

// GET /puzzle/today
app.get('/puzzle/today', async (req, res) => {
  try {
    const puzzles = await getDailyPuzzles()
    res.json(puzzles)
  } catch (err) {
    console.error('Puzzle generation failed:', err.message)
    res.status(500).json({ error: 'Could not generate puzzles' })
  }
})

// A signed-in user's already-saved result for a puzzle date, or null.
async function fetchSavedResult(userId, date) {
  if (!userId) return null
  const r = await pool.query(
    'SELECT lie_found, lie_attempts, player_correct, player_guess, score FROM user_results WHERE user_id = $1 AND puzzle_date = $2',
    [userId, date]
  )
  if (!r.rows.length) return null
  const row = r.rows[0]
  return {
    lieFound: row.lie_found, lieAttempts: row.lie_attempts,
    playerGuess: row.player_guess, playerCorrect: row.player_correct, score: row.score,
  }
}

// GET /puzzle/today/current
app.get('/puzzle/today/current', puzzleLimiter, optionalAuth, async (req, res) => {
  try {
    const fresh  = req.query.fresh !== undefined
    const puzzle = await getDailyCurrentPuzzle(fresh)
    if (fresh) return res.json(puzzle)
    const date   = todayDateStr()
    const result = await fetchSavedResult(req.userId, date)
    res.json({ ...puzzle, date, result })
  } catch (err) {
    console.error('Current puzzle failed:', err.message)
    res.status(500).json({ error: 'Could not generate current puzzle' })
  }
})

// GET /puzzle/date/2026-08-10 (play a specific past archive date)
app.get('/puzzle/date/:date', puzzleLimiter, optionalAuth, async (req, res) => {
  const date = req.params.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' })
  try {
    const puzzle = await getPuzzleForDate(date)
    const result = await fetchSavedResult(req.userId, date)
    res.json({ ...puzzle, date, result })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// GET /puzzle/archive: released dates with per-user completion status, never puzzle content.
app.get('/puzzle/archive', optionalAuth, async (req, res) => {
  try {
    // Today's puzzle lives on the Daily tab, not here.
    const dates = (await listArchiveDates()).filter(d => d < todayDateStr())
    if (!dates.length) return res.json([])
    const r = await pool.query(`
      SELECT dp.puzzle_date, ur.score
      FROM daily_puzzles dp
      LEFT JOIN user_results ur ON ur.puzzle_date = dp.puzzle_date AND ur.user_id = $1
      WHERE dp.puzzle_date = ANY($2::date[])
      ORDER BY dp.puzzle_date DESC
    `, [req.userId || null, dates])
    res.json(r.rows.map(row => ({
      date: row.puzzle_date,
      completed: row.score !== null,
      score: row.score,
    })))
  } catch (err) {
    console.error('Archive fetch failed:', err.message)
    res.status(500).json({ error: 'Could not load archive' })
  }
})

// GET /puzzle/generate (fresh random set)
app.get('/puzzle/generate', puzzleLimiter, async (req, res) => {
  try {
    const puzzles = await generateFreshPuzzles()
    res.json(puzzles)
  } catch (err) {
    console.error('Puzzle generation failed:', err.message)
    res.status(500).json({ error: 'Could not generate puzzles' })
  }
})

// GET /puzzle/player?name=Tom+Brady&draftYear=2000
app.get('/puzzle/player', puzzleLimiter, async (req, res) => {
  const raw  = String(req.query.name || '').trim()
  if (!raw || raw.length > 80) return res.status(400).json({ error: 'Invalid name' })
  // Strip anything that isn't a letter, space, apostrophe, hyphen, or dot
  const name = raw.replace(/[^a-zA-Z .'\-]/g, '').trim()
  if (!name) return res.status(400).json({ error: 'Invalid name' })
  // Disambiguates players who share an exact name (e.g. two different "Josh Allen"s)
  const draftYear = /^\d{4}$/.test(req.query.draftYear) ? Number(req.query.draftYear) : undefined
  try {
    const puzzle = await generatePlayerPuzzle(name, draftYear)
    res.json(puzzle)
  } catch (err) {
    console.error('Player puzzle failed:', err.message)
    res.status(404).json({ error: err.message })
  }
})

const toUserJSON = u => ({
  id: u.id, email: u.email, displayName: u.username || u.display_name, avatarUrl: u.avatar_url,
  isAdmin: isAdminEmail(u.email),
})

// POST /auth/google { credential }
app.post('/auth/google', authLimiter, async (req, res) => {
  const credential = req.body?.credential
  if (!credential || typeof credential !== 'string') return res.status(400).json({ error: 'Missing credential' })
  try {
    const googleUser = await verifyGoogleCredential(credential)
    const user = await upsertUser(pool, googleUser)
    const token = signSession(user.id)
    res.cookie(COOKIE_NAME, token, cookieOptions)
    res.json({ user: toUserJSON(user) })
  } catch (err) {
    console.error('Google sign-in failed:', err.message)
    res.status(401).json({ error: 'Sign-in failed' })
  }
})

// POST /auth/logout
app.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions)
  res.json({ ok: true })
})

// GET /auth/me
app.get('/auth/me', optionalAuth, async (req, res) => {
  if (!req.userId) return res.json({ user: null })
  const r = await pool.query('SELECT id, email, display_name, username, avatar_url FROM users WHERE id = $1', [req.userId])
  if (!r.rows.length) return res.json({ user: null })
  res.json({ user: toUserJSON(r.rows[0]) })
})

// PUT /auth/username { username }
app.put('/auth/username', requireAuth, authLimiter, async (req, res) => {
  const raw = String(req.body?.username || '').trim()
  if (!/^[a-zA-Z0-9 _\-]{2,20}$/.test(raw)) {
    return res.status(400).json({ error: 'Username must be 2-20 letters, numbers, spaces, - or _' })
  }
  try {
    const user = await setUsername(pool, req.userId, raw)
    res.json({ user: toUserJSON(user) })
  } catch (err) {
    res.status(409).json({ error: err.message })
  }
})

// requireAdmin (chain after requireAuth)
async function requireAdmin(req, res, next) {
  const r = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId])
  if (!r.rows.length || !isAdminEmail(r.rows[0].email)) return res.status(403).json({ error: 'Admin access required' })
  next()
}

// POST /puzzle/result: recomputes the score server-side so it can't be faked.
app.post('/puzzle/result', requireAuth, puzzleLimiter, async (req, res) => {
  const { selectedLieId, lieAttempts, playerGuess } = req.body || {}
  const puzzleDate = req.body?.puzzleDate || todayDateStr()
  const attempts = Number(lieAttempts)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate) || !Number.isInteger(attempts) || attempts < 0 || attempts > 3) {
    return res.status(400).json({ error: 'Invalid result' })
  }
  try {
    const today = todayDateStr()
    if (puzzleDate > today) return res.status(400).json({ error: 'Invalid puzzle date' })
    const puzzle = puzzleDate === today ? await getDailyCurrentPuzzle() : await getPuzzleForDate(puzzleDate)

    const lieFound = Number.isInteger(selectedLieId) && selectedLieId === puzzle.falseFactId
    const normName = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
    const playerCorrect = normName(playerGuess) === normName(puzzle.playerName)
    const score = (lieFound ? Math.max(1, 3 - attempts) : 0) + (playerCorrect ? 3 : 0)

    const r = await pool.query(`
      INSERT INTO user_results (user_id, puzzle_date, lie_found, lie_attempts, player_correct, player_guess, score)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, puzzle_date) DO NOTHING
      RETURNING id
    `, [req.userId, puzzleDate, lieFound, attempts, playerCorrect, String(playerGuess ?? '').slice(0, 80), score])

    if (!r.rows.length) return res.status(409).json({ error: "Already recorded that day's result" })
    res.json({ lieFound, playerCorrect, score })
  } catch (err) {
    console.error('Save result failed:', err.message)
    res.status(500).json({ error: 'Could not save result' })
  }
})

// GET /leaderboard
app.get('/leaderboard', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(u.username, u.display_name) AS display_name, u.avatar_url,
             COUNT(*)::int AS puzzles_played,
             SUM(ur.score)::int AS total_score,
             ROUND(AVG(ur.score), 2)::float AS avg_score
      FROM user_results ur
      JOIN users u ON u.id = ur.user_id
      GROUP BY u.id, u.display_name, u.username, u.avatar_url
      ORDER BY total_score DESC
      LIMIT 50
    `)
    res.json(r.rows)
  } catch (err) {
    console.error('Leaderboard fetch failed:', err.message)
    res.status(500).json({ error: 'Could not load leaderboard' })
  }
})

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please slow down.' },
})

function upcomingDates(days) {
  const dates = []
  const [y, m, d] = todayDateStr().split('-').map(Number)
  for (let i = 1; i <= days; i++) {
    const dt = new Date(y, m - 1, d + i)
    dates.push(dt.toLocaleDateString('en-CA'))
  }
  return dates
}

// GET /admin/puzzles?days=14: preview/status for each upcoming date.
app.get('/admin/puzzles', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 14))
  try {
    const results = await previewUpcomingDates(upcomingDates(days))
    res.json(results)
  } catch (err) {
    console.error('Admin puzzle list failed:', err.message)
    res.status(500).json({ error: 'Could not load upcoming puzzles' })
  }
})

// POST /admin/preview { date, mode, name?, draftYear? }: candidate puzzle, not saved.
app.post('/admin/preview', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { date, mode, name, draftYear } = req.body || {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= todayDateStr()) {
    return res.status(400).json({ error: 'Invalid date' })
  }
  try {
    let puzzle
    if (mode === 'shuffle') puzzle = await shuffleDailyPuzzle(date)
    else if (mode === 'player') {
      if (!name) return res.status(400).json({ error: 'Missing player name' })
      puzzle = await generatePlayerPuzzle(name, /^\d{4}$/.test(draftYear) ? Number(draftYear) : undefined)
    } else puzzle = await previewDailyPuzzle(date)
    res.json({ date, puzzle })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /admin/set { date, puzzle }: locks in a puzzle, replacing any prior one for that date.
app.post('/admin/set', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { date, puzzle } = req.body || {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !puzzle?.facts) {
    return res.status(400).json({ error: 'Invalid date or puzzle' })
  }
  try {
    await setScheduledPuzzle(date, puzzle)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// 404 for any unmatched route
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// Global error handler (never leak stack traces)
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || process.env.API_PORT || 3001
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))


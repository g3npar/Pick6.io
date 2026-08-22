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
  headshotThumb,
} = require('./puzzle')
const {
  cookieOptions, COOKIE_NAME, ensureAuthSchema, verifyGoogleCredential,
  upsertUser, setUsername, signSession, optionalAuth, requireAuth, isAdminEmail,
} = require('./auth')

const app = express()

app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: false,   // API-only; no HTML served
  crossOriginEmbedderPolicy: false,
}))

app.use(cookieParser())
app.use(express.json({ limit: '10kb' }))

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

// Rate limiting is disabled outside production (render.yaml sets
// NODE_ENV=production on the deployed API) so local dev/testing never trips
// it — a no-op middleware stands in for each limiter instead.
const RATE_LIMITING_ENABLED = process.env.NODE_ENV === 'production'
const noopLimiter = (req, res, next) => next()

const apiLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 60,                       // 60 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}) : noopLimiter

// Tighter limit for expensive puzzle generation
const puzzleLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many puzzle requests, please wait a moment.' },
}) : noopLimiter

// Tighter still for auth, since it's a common abuse/brute-force target
const authLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please slow down.' },
}) : noopLimiter

app.use(apiLimiter)

// Disable information-leaking headers
app.disable('x-powered-by')

// In-memory cache of current players
let currentPlayers    = []
let playersCacheTime  = 0
const PLAYERS_CACHE_TTL = 60 * 60 * 1000  // 1 hour

async function ensureCurrentPlayers() {
  if (currentPlayers.length && Date.now() - playersCacheTime < PLAYERS_CACHE_TTL) return
  const r = await pool.query(`
    SELECT DISTINCT p.id, p.name, p.position, p.draft_year, p.headshot_url
    FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    WHERE ps.season_year = (SELECT MAX(season_year) FROM player_seasons)
  `)
  currentPlayers   = r.rows.map(p => ({ ...p, headshot_url: headshotThumb(p.headshot_url) }))
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

// A signed-in user's already-saved result for a puzzle date, or null
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

// A signed-in user's in-progress (not yet submitted) lie-guessing state for a date, or null.
async function fetchProgress(userId, date) {
  if (!userId) return null
  const r = await pool.query(
    'SELECT lie_attempts, wrong_ids, lie_found FROM puzzle_progress WHERE user_id = $1 AND puzzle_date = $2',
    [userId, date]
  )
  if (!r.rows.length) return null
  const row = r.rows[0]
  return { lieAttempts: row.lie_attempts, wrongIds: row.wrong_ids, lieFound: row.lie_found }
}

// Strips the answer-revealing fields from a puzzle unless they're safe to show:
// `lie` once the lie phase is resolved (found or exhausted), `player` once fully submitted.
function withReveal(puzzle, { lie = false, player = false } = {}) {
  const { falseFactId, falseExplanation, trueText, playerName, headshotUrl, ...safe } = puzzle
  return {
    ...safe,
    ...(lie    ? { falseFactId, falseExplanation, trueText } : {}),
    ...(player ? { playerName, headshotUrl } : {}),
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
    if (result) {
      return res.json({ ...withReveal(puzzle, { lie: true, player: true }), date, result, progress: null })
    }
    const progress = await fetchProgress(req.userId, date)
    const liePhaseComplete = !!progress && (progress.lieFound || progress.lieAttempts >= 3)
    res.json({ ...withReveal(puzzle, { lie: liePhaseComplete }), date, result: null, progress })
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
    if (result) {
      return res.json({ ...withReveal(puzzle, { lie: true, player: true }), date, result, progress: null })
    }
    const progress = await fetchProgress(req.userId, date)
    const liePhaseComplete = !!progress && (progress.lieFound || progress.lieAttempts >= 3)
    res.json({ ...withReveal(puzzle, { lie: liePhaseComplete }), date, result: null, progress })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /puzzle/guess-lie: server-verified single guess. Answer data is never sent to the
// client before this point, so this is the only way to learn which fact is the lie.
app.post('/puzzle/guess-lie', puzzleLimiter, optionalAuth, async (req, res) => {
  const { puzzleDate, factId, giveUp } = req.body || {}
  const date  = puzzleDate
  const today = todayDateStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return res.status(400).json({ error: 'Invalid date' })
  if (!giveUp && !Number.isInteger(factId)) return res.status(400).json({ error: 'Invalid fact' })

  try {
    const puzzle = date === today ? await getDailyCurrentPuzzle() : await getPuzzleForDate(date)

    // Already fully completed: nothing left to guess, safe to just echo the answer back.
    const already = await fetchSavedResult(req.userId, date)
    if (already) {
      return res.json({
        correct: already.lieFound, lieFound: already.lieFound, lieAttempts: already.lieAttempts,
        wrongIds: [], liePhaseComplete: true,
        falseFactId: puzzle.falseFactId, trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation,
      })
    }

    if (!req.userId) {
      // Anonymous: correctness is still verified server-side (the fix that matters), but
      // nothing is persisted, so the attempt count itself isn't tamper-proof for guests.
      const correct = !giveUp && factId === puzzle.falseFactId
      const liePhaseComplete = correct || !!giveUp
      return res.json({
        correct, lieFound: correct, lieAttempts: null, wrongIds: null, liePhaseComplete,
        ...(liePhaseComplete
          ? { falseFactId: puzzle.falseFactId, trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation }
          : {}),
      })
    }

    // Signed in: the server's own tally is authoritative from here on.
    const progRes = await pool.query(
      'SELECT lie_attempts, wrong_ids, lie_found FROM puzzle_progress WHERE user_id = $1 AND puzzle_date = $2',
      [req.userId, date]
    )
    let attempts = 0, wrongIds = [], lieFound = false
    if (progRes.rows.length) {
      attempts = progRes.rows[0].lie_attempts; wrongIds = progRes.rows[0].wrong_ids; lieFound = progRes.rows[0].lie_found
    }

    let correct = false
    if (!(lieFound || attempts >= 3)) {
      if (giveUp) {
        attempts = 3
      } else {
        correct = factId === puzzle.falseFactId
        if (correct) lieFound = true
        else {
          attempts = Math.min(3, attempts + 1)
          if (!wrongIds.includes(factId)) wrongIds = [...wrongIds, factId]
        }
      }
      await pool.query(`
        INSERT INTO puzzle_progress (user_id, puzzle_date, lie_attempts, wrong_ids, lie_found, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, puzzle_date) DO UPDATE
          SET lie_attempts = EXCLUDED.lie_attempts, wrong_ids = EXCLUDED.wrong_ids,
              lie_found = EXCLUDED.lie_found, updated_at = now()
      `, [req.userId, date, attempts, wrongIds, lieFound])
    }

    const liePhaseComplete = lieFound || attempts >= 3
    res.json({
      correct, lieFound, lieAttempts: attempts, wrongIds, liePhaseComplete,
      ...(liePhaseComplete
        ? { falseFactId: puzzle.falseFactId, trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation }
        : {}),
    })
  } catch (err) {
    console.error('Guess-lie failed:', err.message)
    res.status(500).json({ error: 'Could not process guess' })
  }
})

// GET /puzzle/archive: released dates with per-user completion status
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

// POST /puzzle/result: recomputes the score server-side so it can't be faked. Only persists
// (and only requires auth for persisting) once a userId is present; an anonymous caller still
// gets an accurate, server-verified verdict so the board can reveal immediately, it just isn't
// saved until they sign in and this fires again.
app.post('/puzzle/result', optionalAuth, puzzleLimiter, async (req, res) => {
  const { selectedLieId, lieAttempts, playerGuess } = req.body || {}
  const puzzleDate = req.body?.puzzleDate || todayDateStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) return res.status(400).json({ error: 'Invalid result' })
  try {
    const today = todayDateStr()
    if (puzzleDate > today) return res.status(400).json({ error: 'Invalid puzzle date' })
    const puzzle = puzzleDate === today ? await getDailyCurrentPuzzle() : await getPuzzleForDate(puzzleDate)

    // The server's own tracked guessing progress is authoritative whenever it exists, which
    // is the normal case for anyone signed in while they played. It only falls back to the
    // client-reported attempt info when nothing was tracked (e.g. played anonymously, then
    // signed in afterward) — never trusted at all once a real progress record exists.
    let lieFound, attempts
    if (req.userId) {
      const progRes = await pool.query(
        'SELECT lie_attempts, lie_found FROM puzzle_progress WHERE user_id = $1 AND puzzle_date = $2',
        [req.userId, puzzleDate]
      )
      if (progRes.rows.length) { lieFound = progRes.rows[0].lie_found; attempts = progRes.rows[0].lie_attempts }
    }
    if (lieFound === undefined) {
      attempts = Number(lieAttempts)
      if (!Number.isInteger(attempts) || attempts < 0 || attempts > 3) attempts = 3
      lieFound = Number.isInteger(selectedLieId) && selectedLieId === puzzle.falseFactId
    }

    const normName = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9 .\-]/g, '')
    const playerCorrect = normName(playerGuess) === normName(puzzle.playerName)
    const score = (lieFound ? Math.max(1, 3 - attempts) : 0) + (playerCorrect ? 3 : 0)

    let saved = false
    if (req.userId) {
      const r = await pool.query(`
        INSERT INTO user_results (user_id, puzzle_date, lie_found, lie_attempts, player_correct, player_guess, score)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, puzzle_date) DO NOTHING
        RETURNING id
      `, [req.userId, puzzleDate, lieFound, attempts, playerCorrect, String(playerGuess ?? '').slice(0, 80), score])

      if (!r.rows.length) return res.status(409).json({ error: "Already recorded that day's result" })
      await pool.query('DELETE FROM puzzle_progress WHERE user_id = $1 AND puzzle_date = $2', [req.userId, puzzleDate])
      saved = true
    }

    res.json({
      lieFound, lieAttempts: attempts, playerCorrect, score, saved,
      playerName: puzzle.playerName, falseFactId: puzzle.falseFactId,
      trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation,
      headshotUrl: puzzle.headshotUrl,
    })
  } catch (err) {
    console.error('Save result failed:', err.message)
    res.status(500).json({ error: 'Could not save result' })
  }
})

// GET /leaderboard
app.get('/leaderboard', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(u.username, u.display_name) AS display_name,
             COUNT(*)::int AS puzzles_played,
             SUM(ur.score)::int AS total_score,
             ROUND(AVG(ur.score), 2)::float AS avg_score
      FROM user_results ur
      JOIN users u ON u.id = ur.user_id
      GROUP BY u.id, u.display_name, u.username
      ORDER BY total_score DESC
      LIMIT 50
    `)
    res.json(r.rows)
  } catch (err) {
    console.error('Leaderboard fetch failed:', err.message)
    res.status(500).json({ error: 'Could not load leaderboard' })
  }
})

const adminLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please slow down.' },
}) : noopLimiter

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


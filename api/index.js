require('dotenv').config({ path: '../.env' })
const express      = require('express')
const compression  = require('compression')
const cors         = require('cors')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const {
  getDailyPuzzles, generateFreshPuzzles, generatePlayerPuzzle, getDailyCurrentPuzzle,
  getPuzzleForDate, listArchiveDates, ensurePuzzleSchema, todayDateStr, pool,
  previewDailyPuzzle, shuffleDailyPuzzle, setScheduledPuzzle, getScheduledDates, previewUpcomingDates,
  headshotThumb, loadPortrait, setPuzzleLie, listFactAlternatives, swapPuzzleFact,
} = require('./puzzle')
const {
  cookieOptions, COOKIE_NAME, ensureAuthSchema, verifyGoogleCredential,
  upsertUser, setUsername, signSession, optionalAuth, requireAuth, isAdminEmail,
  signPortrait, verifyPortrait,
} = require('./auth')

const app = express()

app.set('trust proxy', 1)
app.use(compression())

app.use(helmet({
  contentSecurityPolicy: false,   // API-only
  crossOriginEmbedderPolicy: false,
}))

app.use(cookieParser())
app.use(express.json({ limit: '10kb' }))

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // allow no origin in dev only
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'))
  },
  credentials: true,   // required so the browser sends/accepts the session cookie
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type'],
}))

ensureAuthSchema(pool).catch(err => console.error('Auth schema init failed:', err.message))
ensurePuzzleSchema(pool).catch(err => console.error('Puzzle schema init failed:', err.message))

// rate limiting only in production
const RATE_LIMITING_ENABLED = process.env.NODE_ENV === 'production'
const noopLimiter = (req, res, next) => next()

const apiLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}) : noopLimiter

// tighter limit for puzzle generation only
const puzzleLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many puzzle requests, please wait a moment.' },
}) : noopLimiter

// tighter limit for auth
const authLimiter = RATE_LIMITING_ENABLED ? rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please slow down.' },
}) : noopLimiter

app.use(apiLimiter)

// hide identifying headers
app.disable('x-powered-by')

// in memory player cache
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
  // reject bad input length
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

// saved result for a puzzle date
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

// in progress lie guess state
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

// warms the reveal image while the user is still playing
function warmHeadshotFor(puzzle) {
  if (puzzle && puzzle.headshotUrl) loadPortrait(puzzle.headshotUrl).catch(() => {})
}

// reveal portraits come from our cache so they are already warm
function portraitUrl(req, date, headshotUrl) {
  if (!headshotUrl) return null
  return `${req.protocol}://${req.get('host')}/puzzle/portrait/${signPortrait(date)}`
}

// serves the cached reveal image, token proves the puzzle was finished
app.get('/puzzle/portrait/:token', async (req, res) => {
  const date = verifyPortrait(req.params.token)
  if (!date) return res.status(403).json({ error: 'Not available yet' })
  try {
    const puzzle = date === todayDateStr() ? await getDailyCurrentPuzzle() : await getPuzzleForDate(date)
    const img = await loadPortrait(puzzle.headshotUrl)
    if (!img) return res.status(404).json({ error: 'No portrait' })
    res.set('Content-Type', img.type)
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.set('Cache-Control', 'private, max-age=86400, immutable')
    res.send(img.buf)
  } catch (err) {
    console.error('Portrait failed:', err.message)
    res.status(500).json({ error: 'Could not load portrait' })
  }
})

// strips answer fields until safe to show
function withReveal(puzzle, { lie = false, player = false } = {}) {
  // playerId and seed are admin internals, they would give the answer away
  const { falseFactId, falseExplanation, trueText, playerName, headshotUrl,
          playerId, seed, team, position, ...safe } = puzzle
  return {
    ...safe,
    ...(lie    ? { falseFactId, falseExplanation, trueText } : {}),
    // team and position narrow the answer so they wait for the reveal too
    ...(player ? { playerName, headshotUrl, team, position } : {}),
  }
}

// GET /puzzle/today/current
app.get('/puzzle/today/current', optionalAuth, async (req, res) => {
  try {
    const fresh  = req.query.fresh !== undefined
    const puzzle = await getDailyCurrentPuzzle(fresh)
    if (fresh) return res.json(puzzle)
    const date   = todayDateStr()
    const result = await fetchSavedResult(req.userId, date)
    if (result) {
      const revealed = withReveal(puzzle, { lie: true, player: true })
      revealed.headshotUrl = portraitUrl(req, date, revealed.headshotUrl)
      return res.json({ ...revealed, date, result, progress: null })
    }
    warmHeadshotFor(puzzle)
    const progress = await fetchProgress(req.userId, date)
    const liePhaseComplete = !!progress && (progress.lieFound || progress.lieAttempts >= 3)
    res.json({ ...withReveal(puzzle, { lie: liePhaseComplete }), date, result: null, progress })
  } catch (err) {
    console.error('Current puzzle failed:', err.message)
    res.status(500).json({ error: 'Could not generate current puzzle' })
  }
})

// GET /puzzle/date/2026-08-10 archive date
app.get('/puzzle/date/:date', optionalAuth, async (req, res) => {
  const date = req.params.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' })
  try {
    const puzzle = await getPuzzleForDate(date)
    const result = await fetchSavedResult(req.userId, date)
    if (result) {
      const revealed = withReveal(puzzle, { lie: true, player: true })
      revealed.headshotUrl = portraitUrl(req, date, revealed.headshotUrl)
      return res.json({ ...revealed, date, result, progress: null })
    }
    warmHeadshotFor(puzzle)
    const progress = await fetchProgress(req.userId, date)
    const liePhaseComplete = !!progress && (progress.lieFound || progress.lieAttempts >= 3)
    res.json({ ...withReveal(puzzle, { lie: liePhaseComplete }), date, result: null, progress })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /puzzle/guess-lie server verified guess
app.post('/puzzle/guess-lie', optionalAuth, async (req, res) => {
  const { puzzleDate, factId, giveUp } = req.body || {}
  const date  = puzzleDate
  const today = todayDateStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return res.status(400).json({ error: 'Invalid date' })
  if (!giveUp && !Number.isInteger(factId)) return res.status(400).json({ error: 'Invalid fact' })

  try {
    const puzzle = date === today ? await getDailyCurrentPuzzle() : await getPuzzleForDate(date)

    // already complete just echo answer
    const already = await fetchSavedResult(req.userId, date)
    if (already) {
      return res.json({
        correct: already.lieFound, lieFound: already.lieFound, lieAttempts: already.lieAttempts,
        wrongIds: [], liePhaseComplete: true,
        falseFactId: puzzle.falseFactId, trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation,
      })
    }

    if (!req.userId) {
      // anonymous verified but not persisted
      const correct = !giveUp && factId === puzzle.falseFactId
      const liePhaseComplete = correct || !!giveUp
      return res.json({
        correct, lieFound: correct, lieAttempts: null, wrongIds: null, liePhaseComplete,
        ...(liePhaseComplete
          ? { falseFactId: puzzle.falseFactId, trueText: puzzle.trueText, falseExplanation: puzzle.falseExplanation }
          : {}),
      })
    }

    // signed in server tally is authoritative
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

// GET /puzzle/archive completion status
app.get('/puzzle/archive', optionalAuth, async (req, res) => {
  try {
    // todays puzzle lives on daily tab
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

// GET /puzzle/generate fresh random set
app.get('/puzzle/generate', puzzleLimiter, async (req, res) => {
  try {
    const puzzles = await generateFreshPuzzles()
    res.json(puzzles)
  } catch (err) {
    console.error('Puzzle generation failed:', err.message)
    res.status(500).json({ error: 'Could not generate puzzles' })
  }
})

// GET /puzzle/player by name
app.get('/puzzle/player', puzzleLimiter, async (req, res) => {
  const raw  = String(req.query.name || '').trim()
  if (!raw || raw.length > 80) return res.status(400).json({ error: 'Invalid name' })
  // strip disallowed characters
  const name = raw.replace(/[^a-zA-Z .'\-]/g, '').trim()
  if (!name) return res.status(400).json({ error: 'Invalid name' })
  // disambiguates same name players
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
  id: u.id, email: u.email, displayName: u.username || 'Anonymous', avatarUrl: u.avatar_url,
  isAdmin: isAdminEmail(u.email),
})

// POST /auth/google
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

// PUT /auth/username
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

// requireAdmin chain after requireAuth
async function requireAdmin(req, res, next) {
  const r = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId])
  if (!r.rows.length || !isAdminEmail(r.rows[0].email)) return res.status(403).json({ error: 'Admin access required' })
  next()
}

// POST /puzzle/result recomputes score server side
app.post('/puzzle/result', optionalAuth, async (req, res) => {
  const { selectedLieId, lieAttempts, playerGuess } = req.body || {}
  const puzzleDate = req.body?.puzzleDate || todayDateStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) return res.status(400).json({ error: 'Invalid result' })
  try {
    const today = todayDateStr()
    if (puzzleDate > today) return res.status(400).json({ error: 'Invalid puzzle date' })
    const puzzle = puzzleDate === today ? await getDailyCurrentPuzzle() : await getPuzzleForDate(puzzleDate)

    // tracked progress wins over client reported
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
      headshotUrl: portraitUrl(req, puzzleDate, puzzle.headshotUrl),
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
      SELECT COALESCE(u.username, 'Anonymous') AS display_name,
             COUNT(*)::int AS puzzles_played,
             SUM(ur.score)::int AS total_score,
             ROUND(AVG(ur.score), 2)::float AS avg_score
      FROM user_results ur
      JOIN users u ON u.id = ur.user_id
      GROUP BY u.id, u.username
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

// GET /admin/puzzles status per date
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

// POST /admin/preview candidate not saved
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

// POST /admin/preview/lie forces a specific fact as the lie
app.post('/admin/preview/lie', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { candidate, factId } = req.body || {}
  if (!candidate || !Number.isInteger(factId)) return res.status(400).json({ error: 'Invalid request' })
  try {
    const puzzle = await setPuzzleLie(candidate, factId)
    res.json({ puzzle })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /admin/preview/alternatives unused facts for this player
app.post('/admin/preview/alternatives', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { candidate } = req.body || {}
  if (!candidate) return res.status(400).json({ error: 'Invalid request' })
  try {
    res.json({ alternatives: await listFactAlternatives(candidate) })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /admin/preview/swap replaces one fact with another
app.post('/admin/preview/swap', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { candidate, factId, replacementText } = req.body || {}
  if (!candidate || !Number.isInteger(factId) || !replacementText) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  try {
    res.json({ puzzle: await swapPuzzleFact(candidate, factId, replacementText) })
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// POST /admin/set locks in a puzzle
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

// 404 unmatched route
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || process.env.API_PORT || 3001
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))


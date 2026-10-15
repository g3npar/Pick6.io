'use strict'
const crypto  = require('crypto')
const path    = require('path')
const express = require('express')
const sharp   = require('sharp')
const { pool, todayDateStr } = require('./puzzle')
const { optionalAuth } = require('./auth')

// Logo Lineup: six zoomed in logos a day, one each from the NFL, NBA, MLB, NHL
// and college, plus one old logo from any of them. Each miss zooms out.
// Teams come from scripts/build_logo_teams.py, old logos from build_old_logos.py
const TEAMS = require('./data/logo_teams.json')
let OLD = []
try { OLD = require('./data/old_logos.json') } catch {}

// first Logo Lineup day, sets the "#N" number and where the schedule starts
const LINEUP_EPOCH = '2026-10-09'

const LEAGUES = ['nfl', 'nba', 'mlb', 'nhl', 'ncaa']
const LEAGUE_NAMES = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', ncaa: 'NCAA' }
const SLOTS = [...LEAGUES, 'old']
const MAX_ATTEMPTS = 3
// how far in each attempt starts. modern logos are svgs, so these can go as tight as we want
const ZOOMS = [5, 3, 1.6]
// smallest window an old (picture) logo gets cropped to, see cropImage
const MIN_RASTER_WINDOW = 240
const CROP_PX = 320

const LOGO_DIR = path.join(__dirname, '..', 'public', 'logos', 'leagues')
const byLeague = Object.fromEntries(LEAGUES.map(lg => [lg, TEAMS.filter(t => t.league === lg)]))
const OLD_BY_LEAGUE = Object.fromEntries(LEAGUES.map(lg => [lg, OLD.filter(o => o.league === lg)]))
const teamOf = (league, id) => byLeague[league].find(t => t.id === id)

// schedule, same idea as Film Room: every team once per cycle, keyed off a
// server secret so the public repo doesn't give away future answers

function daysSinceEpoch(dateStr) {
  return Math.round((new Date(dateStr) - new Date(LINEUP_EPOCH)) / 86400000)
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seedFor = key => crypto
  .createHmac('sha256', process.env.LINEUP_SECRET || process.env.JWT_SECRET || 'dev')
  .update(`lineup:${key}`).digest().readUInt32BE(0)

const _orders = new Map()
function cycleOrder(name, items, cycle) {
  const key = `${name}:${cycle}`
  if (_orders.has(key)) return _orders.get(key)
  const rng = mulberry32(seedFor(key))
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]]
  }
  _orders.set(key, order)
  return order
}

function pickFor(name, items, day, offset = 0) {
  const n = items.length
  const i = day + offset
  const cycle = Math.floor(i / n)
  return cycleOrder(name, items, cycle)[((i % n) + n) % n]
}

function buildPuzzle(dateStr) {
  const day = daysSinceEpoch(dateStr)
  const slots = LEAGUES.map(lg => {
    const t = pickFor(lg, byLeague[lg], day)
    return { league: lg, team: t.id, logo: t.logo, old: false }
  })
  if (OLD.length) {
    // each league gets the old slot once every five days, otherwise it'd be college a
    // third of the time (it has the most old logos) and those are the most obscure
    const lg = pickFor('old-league', LEAGUES, day)
    const round = Math.floor(day / LEAGUES.length)
    // not the same team as today's modern logo from that league
    let o, offset = 0
    do { o = pickFor(`old-${lg}`, OLD_BY_LEAGUE[lg], round + offset++) } while (o.team === slots.find(s => s.league === lg).team && offset < 5)
    slots.push({ league: o.league, team: o.team, logo: o.logo, old: true, eraName: o.eraName, years: `${o.start}-${o.end}` })
  } else {
    // old logos not built yet, keeps local testing working
    console.warn('Logo Lineup: api/data/old_logos.json is missing, using a modern logo for the old slot')
    const lg = LEAGUES[day % LEAGUES.length]
    const t = pickFor(`${lg}-old`, byLeague[lg], day)
    slots.push({ league: lg, team: t.id, logo: t.logo, old: true, eraName: t.name, years: '' })
  }
  return { slots }
}

// stored on first request so the day's puzzle never changes after that,
// even if a pool gets rebuilt
const _puzzles = new Map()
async function getPuzzleForDate(dateStr) {
  if (_puzzles.has(dateStr)) return _puzzles.get(dateStr)
  // without old logos the 6th slot is a stand-in, don't lock that in for the day
  if (!OLD.length) return buildPuzzle(dateStr)
  await pool.query(
    'INSERT INTO lineup_puzzles (puzzle_date, puzzle) VALUES ($1, $2) ON CONFLICT (puzzle_date) DO NOTHING',
    [dateStr, buildPuzzle(dateStr)]
  )
  const r = await pool.query('SELECT puzzle FROM lineup_puzzles WHERE puzzle_date = $1', [dateStr])
  const puzzle = r.rows[0].puzzle
  if (_puzzles.size >= 8) _puzzles.delete(_puzzles.keys().next().value)
  _puzzles.set(dateStr, puzzle)
  return puzzle
}

// images

const fs = require('fs')

// logos are paths like "nfl/dal.svg". puzzles saved before the svgs only have "nfl/dal"
function logoFile(logo) {
  if (path.extname(logo)) return logo
  return fs.existsSync(path.join(LOGO_DIR, `${logo}.svg`)) ? `${logo}.svg` : `${logo}.webp`
}

// most official svgs carry a ™ or ® off the bottom right corner. it would show up
// crisp in a crop and stretch the trim, so small shapes that sit on their own in
// the bottom right quarter get wiped. shapes drawn on top of the logo aren't on
// their own (alpha is solid under them), so they're safe. rgba pixels, in place
function eraseMarks(px, w, h) {
  const label = new Int32Array(w * h)
  const solid = i => px[i * 4 + 3] > 20
  const parts = []
  const stack = []
  for (let start = 0; start < w * h; start++) {
    if (label[start] || !solid(start)) continue
    const id = parts.length + 1
    const part = { id, size: 0, x0: w, y0: h, x1: 0, y1: 0 }
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i - x) / w
      part.size++
      if (x < part.x0) part.x0 = x
      if (x > part.x1) part.x1 = x
      if (y < part.y0) part.y0 = y
      if (y > part.y1) part.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (!label[j] && solid(j)) { label[j] = id; stack.push(j) }
        }
      }
    }
    parts.push(part)
  }
  if (parts.length < 2) return
  const total = parts.reduce((n, p) => n + p.size, 0)
  const x0 = Math.min(...parts.map(p => p.x0)), x1 = Math.max(...parts.map(p => p.x1))
  const y0 = Math.min(...parts.map(p => p.y0)), y1 = Math.max(...parts.map(p => p.y1))
  const long = Math.max(x1 - x0, y1 - y0)
  const small = (p, share, span) => p.size < total * share && p.x1 - p.x0 < long * span && p.y1 - p.y0 < long * span
  const marks = new Set(parts.filter(p =>
    // a ™ off the bottom right
    (small(p, 0.01, 0.1) && p.x0 > (x0 + x1) / 2 && p.y0 > (y0 + y1) / 2)
    // or a tiny ® anywhere along the bottom (Calgary's is bottom left)
    || (small(p, 0.003, 0.06) && p.y0 > (y0 + y1) / 2)
  ).map(p => p.id))
  if (eraseMarks.log) eraseMarks.log(parts.filter(p => marks.has(p.id)).map(p => ({ share: +(p.size / total).toFixed(4), at: [+((p.x0 - x0) / long).toFixed(2), +((p.y0 - y0) / long).toFixed(2)] })))
  // the ® is two pieces (ring and R), both get caught on their own
  if (!marks.size) return
  for (let i = 0; i < w * h; i++) if (marks.has(label[i])) px[i * 4 + 3] = 0
}

// the logo trimmed to its edges on a square, transparent canvas, at high resolution.
// svgs are drawn at SVG_PX so even the tightest zoom stays sharp
const SVG_PX = 1600   // 5x zoom on a 320px crop needs 1600
const _squares = new Map()
async function logoSquare(logo) {
  if (_squares.has(logo)) return _squares.get(logo)
  const file = path.join(LOGO_DIR, logoFile(logo))
  let img = sharp(file)
  if (file.endsWith('.svg')) {
    const meta = await img.metadata()
    // density is dpi, 72 draws the svg at its own size
    img = sharp(file, { density: Math.min(2400, 72 * SVG_PX / Math.max(meta.width, meta.height)) })
  }
  const raw = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  eraseMarks(raw.data, raw.info.width, raw.info.height)
  // the league svgs have padding (the NHL's are 960x640 with the logo in the middle)
  const trimmed = await sharp(raw.data, { raw: raw.info }).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true })
  const side = Math.max(trimmed.info.width, trimmed.info.height)
  const data = await sharp(trimmed.data)
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  const square = { data, side, vector: file.endsWith('.svg') }
  if (_squares.size >= 24) _squares.delete(_squares.keys().next().value)
  _squares.set(logo, square)
  return square
}

// a spot that's actually logo, not transparent corner, picked per day
async function cropCenter(square, dateStr, slot) {
  const { data, info } = await sharp(square.data).resize(16, 16).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cells = []
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (data[(y * 16 + x) * info.channels + 3] > 200) cells.push([(x + 0.5) / 16, (y + 0.5) / 16])
    }
  }
  const rng = mulberry32(seedFor(`crop:${dateStr}:${slot}`))
  return cells.length ? cells[Math.floor(rng() * cells.length)] : [0.5, 0.5]
}

const _crops = new Map()
// drawing a crop takes ~1s per logo on Render, so every crop is cut once, saved in
// lineup_crops, and kept in memory. warmLineup() cuts each day's ahead of time
const _cutting = new Map()   // crops being cut right now, so two requests share the work
async function cropImage(puzzle, dateStr, slot, level) {
  const { logo } = puzzle.slots[slot]
  const key = `${dateStr}:${slot}:${level}:${logo}`
  if (_crops.has(key)) return _crops.get(key)
  if (_cutting.has(key)) return _cutting.get(key)
  const job = (async () => {
    const saved = await pool.query(
      'SELECT image FROM lineup_crops WHERE puzzle_date = $1 AND slot = $2 AND level = $3', [dateStr, slot, level])
    let buf = saved.rows[0]?.image
    if (!buf) {
      buf = await cutCrop(logo, dateStr, slot, level)
      await pool.query(
        'INSERT INTO lineup_crops (puzzle_date, slot, level, image) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [dateStr, slot, level, buf])
    }
    const url = `data:image/webp;base64,${buf.toString('base64')}`
    if (_crops.size >= 300) _crops.delete(_crops.keys().next().value)
    _crops.set(key, url)
    return url
  })()
  _cutting.set(key, job)
  try { return await job } finally { _cutting.delete(key) }
}

async function cutCrop(logo, dateStr, slot, level) {
  const square = await logoSquare(logo)
  const { side } = square
  const [cx, cy] = await cropCenter(square, dateStr, slot)
  // old logos only come as pictures, so they don't zoom past the point where
  // the crop would be stretched bigger than the real pixels
  const zoom = square.vector ? ZOOMS[level] : Math.min(ZOOMS[level], Math.max(side / MIN_RASTER_WINDOW, ZOOMS[ZOOMS.length - 1]))
  const win = Math.round(side / zoom)
  const left = Math.min(Math.max(0, Math.round(cx * side - win / 2)), side - win)
  const top  = Math.min(Math.max(0, Math.round(cy * side - win / 2)), side - win)
  return sharp(square.data)
    .extract({ left, top, width: win, height: win })
    .resize(CROP_PX, CROP_PX)
    .webp({ quality: 88 }).toBuffer()
}

// cuts and saves every crop for today and tomorrow, then any past day that's missing
// some, one at a time so it doesn't hog the server. runs at startup and every 30 minutes,
// so nobody opening a puzzle has to wait for the drawing
const CROPS_PER_DAY = SLOTS.length * ZOOMS.length
let _warming = false
async function warmLineup() {
  if (_warming) return
  _warming = true
  try {
    const today = todayDateStr()
    const shift = n => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    const dates = [today, shift(1)]
    for (let n = -1; shift(n) >= LINEUP_EPOCH; n--) dates.push(shift(n))
    for (const date of dates) {
      const have = await pool.query('SELECT count(*)::int AS n FROM lineup_crops WHERE puzzle_date = $1', [date])
      if (have.rows[0].n >= CROPS_PER_DAY) continue
      // without old logos the puzzle is a stand-in that isn't saved, don't save its crops either
      if (!OLD.length) continue
      const puzzle = await getPuzzleForDate(date)
      for (let slot = 0; slot < SLOTS.length; slot++) {
        for (let level = 0; level < ZOOMS.length; level++) await cropImage(puzzle, date, slot, level)
      }
    }
  } catch (err) {
    console.error('Logo Lineup warm up failed:', err.message)
  } finally {
    _warming = false
  }
}

// game state, one entry per slot: { attempts, wrong: [team ids], solved }

const freshSlots = () => SLOTS.map(() => ({ attempts: 0, wrong: [], solved: false }))
const slotDone = s => s.solved || s.attempts >= MAX_ATTEMPTS
const scoreOf = slots => slots.filter(s => s.solved).length

// signed out players keep their state in the browser, so take it but sanity check it
function cleanLocal(local) {
  if (!Array.isArray(local) || local.length !== SLOTS.length) return freshSlots()
  return local.map(s => ({
    attempts: Number.isInteger(s?.attempts) ? Math.min(Math.max(s.attempts, 0), MAX_ATTEMPTS) : 0,
    wrong: Array.isArray(s?.wrong) ? s.wrong.filter(x => typeof x === 'string').slice(0, MAX_ATTEMPTS) : [],
    solved: s?.solved === true,
  }))
}

function answerFor(puzzle, i) {
  const s = puzzle.slots[i]
  const t = teamOf(s.league, s.team)
  return { team: s.team, name: t.name, logo: logoFile(s.logo), ...(s.old ? { eraName: s.eraName, years: s.years } : {}) }
}

// what the board needs for one slot: the crop for where you are, or the answer once it's done
async function slotView(puzzle, dateStr, i, state) {
  if (slotDone(state)) return { ...state, done: true, answer: answerFor(puzzle, i) }
  return { ...state, done: false, image: await cropImage(puzzle, dateStr, i, state.attempts) }
}

async function fetchGame(userId, date) {
  if (!userId) return null
  const r = await pool.query('SELECT slots, completed FROM lineup_games WHERE user_id = $1 AND puzzle_date = $2', [userId, date])
  return r.rows[0] || null
}

async function saveGame(userId, date, slots) {
  const completed = slots.every(slotDone)
  await pool.query(`
    INSERT INTO lineup_games (user_id, puzzle_date, slots, score, completed, updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (user_id, puzzle_date)
    DO UPDATE SET slots = EXCLUDED.slots, score = EXCLUDED.score, completed = EXCLUDED.completed, updated_at = now()
  `, [userId, date, JSON.stringify(slots), scoreOf(slots), completed])
  return completed
}

async function ensureLineupSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS lineup_puzzles (
      puzzle_date DATE PRIMARY KEY,
      puzzle      JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)
  // every crop ever cut, so restarts and new days don't redraw them (see cropImage)
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS lineup_crops (
      puzzle_date DATE NOT NULL,
      slot        SMALLINT NOT NULL,
      level       SMALLINT NOT NULL,
      image       BYTEA NOT NULL,
      PRIMARY KEY (puzzle_date, slot, level)
    )
  `)
  // progress and the finished result live in one row, completed flips at the end
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS lineup_games (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_date DATE NOT NULL,
      slots       JSONB NOT NULL,
      score       SMALLINT NOT NULL DEFAULT 0,
      completed   BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, puzzle_date)
    )
  `)
}

// routes

const router = express.Router()

const isPlayableDate = date =>
  typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= LINEUP_EPOCH && date <= todayDateStr()

// every team's name per league, for the search box. it's all of them, so no hints
const SEARCH = Object.fromEntries(LEAGUES.map(lg => [lg, byLeague[lg].map(t => ({ id: t.id, name: t.name }))]))

async function dayResponse(req, date, local) {
  const puzzle = await getPuzzleForDate(date)
  const saved = await fetchGame(req.userId, date)
  const slots = req.userId ? (saved?.slots || freshSlots()) : cleanLocal(local)
  return {
    date, number: daysSinceEpoch(date) + 1, signedIn: !!req.userId,
    leagues: puzzle.slots.map(s => ({ league: s.league, label: LEAGUE_NAMES[s.league], old: s.old })),
    slots: await Promise.all(slots.map((st, i) => slotView(puzzle, date, i, st))),
    score: scoreOf(slots), completed: slots.every(slotDone),
  }
}

// POST /lineup/day  { date?, local? }  today's puzzle or an archive day.
// a POST so signed out players can send the state their browser kept
router.post('/day', optionalAuth, async (req, res) => {
  const date = req.body?.date || todayDateStr()
  if (!isPlayableDate(date)) return res.status(400).json({ error: 'Invalid date' })
  try {
    res.json({ ...(await dayResponse(req, date, req.body?.local)), teams: SEARCH })
  } catch (err) {
    console.error('Logo Lineup load failed:', err.message)
    res.status(500).json({ error: 'Could not load Logo Lineup' })
  }
})

// POST /lineup/guess  { date, slot, team, local? }  or  { date, slot, giveUp: true, local? }
router.post('/guess', optionalAuth, async (req, res) => {
  const { date, slot, team, giveUp, local } = req.body || {}
  if (!isPlayableDate(date)) return res.status(400).json({ error: 'Invalid date' })
  if (!(Number.isInteger(slot) && slot >= 0 && slot < SLOTS.length)) return res.status(400).json({ error: 'Invalid logo' })
  try {
    const puzzle = await getPuzzleForDate(date)
    const saved = await fetchGame(req.userId, date)
    if (saved?.completed) return res.status(409).json({ error: 'Already finished this Logo Lineup' })
    const slots = req.userId ? (saved?.slots || freshSlots()) : cleanLocal(local)

    let correct = false
    if (giveUp) {
      // just the logo you're on, it counts as missed and shows the answer
      if (!slotDone(slots[slot])) slots[slot].attempts = MAX_ATTEMPTS
    } else {
      const s = slots[slot]
      const { league } = puzzle.slots[slot]
      if (!teamOf(league, team)) return res.status(400).json({ error: 'Pick a team from the list' })
      // a team you already missed on this logo doesn't cost another attempt
      if (!slotDone(s) && !s.wrong.includes(team)) {
        if (team === puzzle.slots[slot].team) {
          correct = true
          s.solved = true
        } else {
          s.attempts += 1
          s.wrong.push(team)
        }
      }
    }

    const completed = req.userId ? await saveGame(req.userId, date, slots) : slots.every(slotDone)
    res.json({
      correct,
      slots: await Promise.all(slots.map((st, i) => slotView(puzzle, date, i, st))),
      score: scoreOf(slots), completed,
    })
  } catch (err) {
    console.error('Logo Lineup guess failed:', err.message)
    res.status(500).json({ error: 'Could not check that guess' })
  }
})

// GET /lineup/archive  every past day, newest first, with your score if you finished it
router.get('/archive', optionalAuth, async (req, res) => {
  try {
    const today = todayDateStr()
    const dates = []
    for (let d = new Date(LINEUP_EPOCH); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      if (ds >= today) break
      dates.push(ds)
    }
    const scores = new Map()
    if (req.userId && dates.length) {
      const r = await pool.query(
        `SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS date, score FROM lineup_games WHERE user_id = $1 AND completed`,
        [req.userId]
      )
      for (const row of r.rows) scores.set(row.date, row.score)
    }
    res.json(dates.reverse().map(date => ({
      date, number: daysSinceEpoch(date) + 1,
      completed: scores.has(date), score: scores.get(date) ?? null,
    })))
  } catch (err) {
    console.error('Logo Lineup archive failed:', err.message)
    res.status(500).json({ error: 'Could not load archive' })
  }
})

// GET /lineup/leaderboard  same shape as the other two games
router.get('/leaderboard', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(u.username, 'Anonymous') AS display_name,
             COUNT(*)::int AS puzzles_played,
             SUM(g.score)::int AS total_score,
             ROUND(AVG(g.score), 2)::float AS avg_score
      FROM lineup_games g
      JOIN users u ON u.id = g.user_id
      WHERE g.completed
      GROUP BY u.id, u.username
      ORDER BY total_score DESC
      LIMIT 50
    `)
    res.json(r.rows)
  } catch (err) {
    console.error('Logo Lineup leaderboard failed:', err.message)
    res.status(500).json({ error: 'Could not load leaderboard' })
  }
})

module.exports = { lineupRouter: router, ensureLineupSchema, warmLineup, LINEUP_EPOCH }

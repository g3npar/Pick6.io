'use strict'
const crypto  = require('crypto')
const express = require('express')
const { pool, todayDateStr } = require('./puzzle')
const { optionalAuth } = require('./auth')

// Film Room: guess the team, then the year, from six clues about one team season.
// Answer data is static history, built by scripts/build_team_seasons.py.
const SEASONS = require('./data/team_seasons.json')

// first Film Room day, sets the "#N" number and where the schedule starts
const FILMROOM_EPOCH = '2026-10-06'

// only record and playoffs start face up. any player name gives the team away
// (receiver + rusher pinned it 99% of the time), so names wait for a miss.
// each miss flips the next clue: receiver, then rusher. coach and QB show for the year
const INITIAL_CLUES = 2
const MAX_TEAM_ATTEMPTS = 3

// seasons people actually remember, plus the famous misses at both ends
const isNotable = s =>
  s.playoffs !== 'Missed Playoffs'
  || s.wins >= 10   // won a lot and still missed
  || s.wins <= 2    // the 0-16s and 1-15s

const POOL = SEASONS.filter(isNotable)
// whatever seasons the data file has, so adding one only means rebuilding it
const FIRST_YEAR = Math.min(...SEASONS.map(s => s.season))
const LAST_YEAR  = Math.max(...SEASONS.map(s => s.season))

// guessing is by franchise so relocations don't matter, these are today's names
const FRANCHISES = {
  ARI: 'Arizona Cardinals',    ATL: 'Atlanta Falcons',      BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',        CAR: 'Carolina Panthers',    CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',   CLE: 'Cleveland Browns',     DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',       DET: 'Detroit Lions',        GB:  'Green Bay Packers',
  HOU: 'Houston Texans',       IND: 'Indianapolis Colts',   JAX: 'Jacksonville Jaguars',
  KC:  'Kansas City Chiefs',   LA:  'Los Angeles Rams',     LAC: 'Los Angeles Chargers',
  LV:  'Las Vegas Raiders',    MIA: 'Miami Dolphins',       MIN: 'Minnesota Vikings',
  NE:  'New England Patriots', NO:  'New Orleans Saints',   NYG: 'New York Giants',
  NYJ: 'New York Jets',        PHI: 'Philadelphia Eagles',  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',     SF:  'San Francisco 49ers',  TB:  'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',     WAS: 'Washington Commanders',
}

// schedule

function daysSinceEpoch(dateStr) {
  return Math.round((new Date(dateStr) - new Date(FILMROOM_EPOCH)) / 86400000)
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

// the repo is public, so the order is keyed off a server secret, otherwise
// anyone could run this file and read off every future answer
function cycleSeed(cycle) {
  const secret = process.env.FILMROOM_SECRET || process.env.JWT_SECRET || 'dev'
  return crypto.createHmac('sha256', secret).update(`filmroom:${cycle}`).digest().readUInt32BE(0)
}

const _orders = new Map()
// every pool season once per cycle, so nothing repeats until the pool runs out
function cycleOrder(cycle) {
  if (_orders.has(cycle)) return _orders.get(cycle)
  const rng = mulberry32(cycleSeed(cycle))
  const order = [...POOL]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]]
  }
  // no same franchise two days in a row
  for (let i = 1; i < order.length; i++) {
    if (order[i].franchise !== order[i - 1].franchise) continue
    const j = order.findIndex((s, k) => k > i && s.franchise !== order[i - 1].franchise
      && (k + 1 >= order.length || order[k + 1].franchise !== order[i].franchise)
      && order[k - 1].franchise !== order[i].franchise)
    if (j > 0) [order[i], order[j]] = [order[j], order[i]]
  }
  _orders.set(cycle, order)
  return order
}

function seasonForDate(dateStr) {
  const day = daysSinceEpoch(dateStr)
  const cycle = Math.floor(day / POOL.length)
  return cycleOrder(cycle)[((day % POOL.length) + POOL.length) % POOL.length]
}

// puzzle building

const fmt = n => Number(n).toLocaleString('en-US')

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// doesn't name the division, "1st in AFC West" would narrow the team round to four
const standing = s => `${ordinal(s.divRank)} in Division${s.seed ? ` · ${ordinal(s.seed)} in Conference` : ''}`
  
// short big word plus a small line under it, long phrases run into the center circle
const PLAYOFF_CLUE = {
  'Won Super Bowl':          ['Won', 'Super Bowl'],
  'Lost Super Bowl':         ['Lost', 'Super Bowl'],
  'Lost Conf. Championship': ['Lost', 'Conf. Championship'],
  'Lost Divisional':         ['Lost', 'Divisional Round'],
  'Lost Wild Card':          ['Lost', 'Wild Card Round'],
  'Missed Playoffs':         ['Missed', 'the playoffs'],
}

function buildPuzzle(s) {
  const record = `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`
  return {
    season: s.season,
    franchise: s.franchise,
    name: s.name,
    clues: [
      { id: 1, kind: 'record',   label: 'RECORD',       value: record, sublabel: standing(s) },
      { id: 2, kind: 'playoffs', label: 'PLAYOFFS',     value: PLAYOFF_CLUE[s.playoffs][0], sublabel: PLAYOFF_CLUE[s.playoffs][1] },
      { id: 3, kind: 'receiver', label: 'TOP RECEIVER', value: s.topReceiver, sublabel: `${fmt(s.topReceiverYards)} yds` },
      { id: 4, kind: 'rusher',   label: 'TOP RUSHER',   value: s.topRusher,   sublabel: `${fmt(s.topRusherYards)} yds` },
      { id: 5, kind: 'coach',    label: 'HEAD COACH',   value: s.coach },
      { id: 6, kind: 'qb',       label: 'STARTING QB',  value: s.qb },
    ],
  }
}

async function ensureFilmroomSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS filmroom_puzzles (
      puzzle_date DATE PRIMARY KEY,
      puzzle      JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS filmroom_results (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_date   DATE NOT NULL,
      team_found    BOOLEAN NOT NULL,
      team_attempts SMALLINT NOT NULL,
      year_guess    SMALLINT,
      score         SMALLINT NOT NULL,
      completed_at  TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, puzzle_date)
    )
  `)
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS filmroom_progress (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_date   DATE NOT NULL,
      team_attempts SMALLINT NOT NULL DEFAULT 0,
      wrong_teams   TEXT[] NOT NULL DEFAULT '{}',
      team_found    BOOLEAN NOT NULL DEFAULT false,
      updated_at    TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, puzzle_date)
    )
  `)
  // added after launch so the finished board can still show the misses
  await dbPool.query(`ALTER TABLE filmroom_results ADD COLUMN IF NOT EXISTS wrong_teams TEXT[] NOT NULL DEFAULT '{}'`)
}

// a few days, so someone playing the archive doesn't push today's puzzle out
const _cache = new Map()   // date -> puzzle

// stored on first request so the day's puzzle never changes after that
async function getPuzzleForDate(dateStr) {
  if (_cache.has(dateStr)) return _cache.get(dateStr)
  let res = await pool.query('SELECT puzzle FROM filmroom_puzzles WHERE puzzle_date = $1', [dateStr])
  if (!res.rows.length) {
    await pool.query(
      'INSERT INTO filmroom_puzzles (puzzle_date, puzzle) VALUES ($1, $2) ON CONFLICT (puzzle_date) DO NOTHING',
      [dateStr, buildPuzzle(seasonForDate(dateStr))]
    )
    res = await pool.query('SELECT puzzle FROM filmroom_puzzles WHERE puzzle_date = $1', [dateStr])
  }
  const puzzle = res.rows[0].puzzle
  if (_cache.size >= 8) _cache.delete(_cache.keys().next().value)
  _cache.set(dateStr, puzzle)
  return puzzle
}

// what the player is allowed to see

const teamPhaseDone = p => p.teamFound || p.attempts >= MAX_TEAM_ATTEMPTS

// the last clue a miss can flip, after that you're on your final try
const LAST_FLIPPABLE = INITIAL_CLUES + MAX_TEAM_ATTEMPTS - 1

function visibleClues(puzzle, attempts, allVisible) {
  const shown = allVisible ? puzzle.clues.length : Math.min(puzzle.clues.length, INITIAL_CLUES + attempts)
  return puzzle.clues.map(c => (c.id <= shown ? c : {
    id: c.id, kind: c.kind, label: c.label, hidden: true,
    hint: c.id <= LAST_FLIPPABLE ? 'flips on a miss' : 'shows for the year',
  }))
}

// current name only, the era name ("St. Louis Rams") would narrow the year
const teamReveal = puzzle => ({ franchise: puzzle.franchise, name: FRANCHISES[puzzle.franchise] })

// logo is looked up here, not stored in the puzzle, so days saved before logos existed still get one
const eraLogo = puzzle => SEASONS.find(s => s.season === puzzle.season && s.franchise === puzzle.franchise)?.logo ?? null

const fullReveal = puzzle => ({ franchise: puzzle.franchise, name: puzzle.name, season: puzzle.season, logo: eraLogo(puzzle) })

function scoreOf({ teamFound, attempts, yearGuess, season }) {
  const teamScore = teamFound ? Math.max(1, MAX_TEAM_ATTEMPTS - attempts) : 0
  const off = Number.isInteger(yearGuess) ? Math.abs(yearGuess - season) : Infinity
  // 2 off used to score too, and guessing the middle of a QB's era averaged 1.84
  const yearScore = off === 0 ? 3 : off === 1 ? 1 : 0
  return { teamScore, yearScore, score: teamScore + yearScore }
}

async function fetchProgress(userId, date) {
  if (!userId) return null
  const r = await pool.query(
    'SELECT team_attempts, wrong_teams, team_found FROM filmroom_progress WHERE user_id = $1 AND puzzle_date = $2',
    [userId, date]
  )
  if (!r.rows.length) return null
  return { attempts: r.rows[0].team_attempts, wrongTeams: r.rows[0].wrong_teams, teamFound: r.rows[0].team_found }
}

async function fetchResult(userId, date) {
  if (!userId) return null
  const r = await pool.query(
    'SELECT team_found, team_attempts, wrong_teams, year_guess, score FROM filmroom_results WHERE user_id = $1 AND puzzle_date = $2',
    [userId, date]
  )
  if (!r.rows.length) return null
  const row = r.rows[0]
  return {
    teamFound: row.team_found, attempts: row.team_attempts, wrongTeams: row.wrong_teams,
    yearGuess: row.year_guess, score: row.score,
  }
}

// routes

const router = express.Router()

// one puzzle a day for now, there's no Film Room archive yet
// any day from #1 through today, past days are the archive
const isPlayableDate = date =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= FILMROOM_EPOCH && date <= todayDateStr()

function checkDate(req, res) {
  const date = req.body?.puzzleDate || todayDateStr()
  if (!isPlayableDate(date)) {
    res.status(400).json({ error: 'Invalid date' })
    return null
  }
  return date
}

// local testing only: random puzzles that are never saved
const PRACTICE = process.env.NODE_ENV !== 'production'
const practiceKey = () => crypto.createHash('sha256')
  .update(`filmroom-practice:${process.env.FILMROOM_SECRET || process.env.JWT_SECRET || 'dev'}`).digest()

// encrypted, so the token in the network tab doesn't spell out the answer
function practiceToken(s) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', practiceKey(), iv)
  const body = Buffer.concat([cipher.update(`${s.season}:${s.franchise}`, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

function practiceSeason(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', practiceKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const [season, franchise] = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8').split(':')
    return SEASONS.find(s => s.season === Number(season) && s.franchise === franchise) || null
  } catch {
    return null
  }
}

// today's puzzle, or a practice one when the request carries a token
async function resolvePuzzle(req, res) {
  if (req.body?.practice) {
    const s = PRACTICE && practiceSeason(req.body.practice)
    if (!s) { res.status(400).json({ error: 'Invalid practice puzzle' }); return null }
    // never saved, even for signed in players
    return { puzzle: buildPuzzle(s), date: null, userId: null }
  }
  const date = checkDate(req, res)
  if (!date) return null
  return { puzzle: await getPuzzleForDate(date), date, userId: req.userId }
}

// POST /filmroom/practice  local dev only
router.post('/practice', (_req, res) => {
  if (!PRACTICE) return res.status(404).json({ error: 'Not found' })
  const s = POOL[crypto.randomInt(POOL.length)]
  res.json({
    practice: practiceToken(s), firstYear: FIRST_YEAR, lastYear: LAST_YEAR,
    clues: visibleClues(buildPuzzle(s), 0, false),
  })
})

// today's puzzle and archive days come back in the same shape
async function sendDay(req, res, date) {
  try {
    const puzzle = await getPuzzleForDate(date)
    const base   = {
      date, number: daysSinceEpoch(date) + 1, firstYear: FIRST_YEAR, lastYear: LAST_YEAR,
      // anonymous games are kept in the browser, signed in ones here
      signedIn: !!req.userId,
    }

    const result = await fetchResult(req.userId, date)
    if (result) {
      return res.json({
        ...base, clues: puzzle.clues, answer: fullReveal(puzzle),
        result: { ...result, ...scoreOf({ ...result, season: puzzle.season }) },
      })
    }
    const progress = await fetchProgress(req.userId, date)
    const p = progress || { attempts: 0, wrongTeams: [], teamFound: false }
    const done = teamPhaseDone(p)
    res.json({
      ...base, clues: visibleClues(puzzle, p.attempts, done),
      progress: progress && { ...p, teamPhaseComplete: done },
      ...(done ? { answer: teamReveal(puzzle) } : {}),
    })
  } catch (err) {
    console.error('Film Room puzzle failed:', err.message)
    res.status(500).json({ error: 'Could not load the Film Room puzzle' })
  }
}

// GET /filmroom/today
router.get('/today', optionalAuth, (req, res) => sendDay(req, res, todayDateStr()))

// GET /filmroom/date/2026-10-07  an archive day
router.get('/date/:date', optionalAuth, (req, res) => {
  if (!isPlayableDate(req.params.date)) return res.status(400).json({ error: 'Invalid date' })
  sendDay(req, res, req.params.date)
})

// GET /filmroom/archive  every past day, newest first, with your score if you played it
router.get('/archive', optionalAuth, async (req, res) => {
  try {
    const today = todayDateStr()
    const dates = []
    for (let d = new Date(FILMROOM_EPOCH); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      if (ds >= today) break
      dates.push(ds)
    }
    if (!dates.length) return res.json([])
    const scores = new Map()
    if (req.userId) {
      const r = await pool.query(
        `SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS date, score FROM filmroom_results WHERE user_id = $1`,
        [req.userId]
      )
      for (const row of r.rows) scores.set(row.date, row.score)
    }
    res.json(dates.reverse().map(date => ({
      date, number: daysSinceEpoch(date) + 1,
      completed: scores.has(date), score: scores.get(date) ?? null,
    })))
  } catch (err) {
    console.error('Film Room archive failed:', err.message)
    res.status(500).json({ error: 'Could not load archive' })
  }
})

// POST /filmroom/guess-team  { puzzleDate, franchise, attempts? }  or  { puzzleDate, giveUp: true }
router.post('/guess-team', optionalAuth, async (req, res) => {
  const { franchise, giveUp } = req.body || {}
  if (!giveUp && !FRANCHISES[franchise]) return res.status(400).json({ error: 'Invalid team' })

  try {
    const ctx = await resolvePuzzle(req, res)
    if (!ctx) return
    const { puzzle, date, userId } = ctx
    // both lookups at once, every round trip is a hop from Render to RDS
    const [finished, saved] = await Promise.all([fetchResult(userId, date), fetchProgress(userId, date)])
    if (finished) return res.status(409).json({ error: 'Already finished this Film Room' })

    // signed in the server count is the truth, anonymous counts come from the
    // browser since nothing gets saved for them anyway
    let p = saved
    if (!p) {
      const sent = Number(req.body.attempts)
      p = { attempts: !userId && Number.isInteger(sent) && sent >= 0 && sent <= 2 ? sent : 0, wrongTeams: [], teamFound: false }
    }

    let correct = false
    // a team you already missed doesn't cost another try
    const repeat = !giveUp && p.wrongTeams.includes(franchise)
    if (!teamPhaseDone(p) && !repeat) {
      if (giveUp) {
        p.attempts = MAX_TEAM_ATTEMPTS
      } else if (franchise === puzzle.franchise) {
        correct = true
        p.teamFound = true
      } else {
        p.attempts += 1
        if (!p.wrongTeams.includes(franchise)) p.wrongTeams = [...p.wrongTeams, franchise]
      }
      if (userId) {
        await pool.query(`
          INSERT INTO filmroom_progress (user_id, puzzle_date, team_attempts, wrong_teams, team_found, updated_at)
          VALUES ($1, $2, $3, $4, $5, now())
          ON CONFLICT (user_id, puzzle_date) DO UPDATE
            SET team_attempts = EXCLUDED.team_attempts, wrong_teams = EXCLUDED.wrong_teams,
                team_found = EXCLUDED.team_found, updated_at = now()
        `, [userId, date, p.attempts, p.wrongTeams, p.teamFound])
      }
    }

    const done = teamPhaseDone(p)
    res.json({
      correct, teamFound: p.teamFound, attempts: p.attempts, wrongTeams: p.wrongTeams,
      teamPhaseComplete: done, clues: visibleClues(puzzle, p.attempts, done),
      ...(done ? { answer: teamReveal(puzzle) } : {}),
    })
  } catch (err) {
    console.error('Film Room team guess failed:', err.message)
    res.status(500).json({ error: 'Could not check that guess' })
  }
})

// POST /filmroom/result  { puzzleDate, yearGuess, teamFound?, attempts? }  or  { puzzleDate, giveUp: true }
router.post('/result', optionalAuth, async (req, res) => {
  const { giveUp } = req.body || {}
  const yearGuess = giveUp ? null : Number(req.body?.yearGuess)
  if (!giveUp && !(Number.isInteger(yearGuess) && yearGuess >= FIRST_YEAR && yearGuess <= LAST_YEAR)) {
    return res.status(400).json({ error: 'Pick a year' })
  }

  try {
    const ctx = await resolvePuzzle(req, res)
    if (!ctx) return
    const { puzzle, date, userId } = ctx
    const [finished, progress] = await Promise.all([fetchResult(userId, date), fetchProgress(userId, date)])
    if (finished) return res.status(409).json({ error: 'Already finished this Film Room' })

    let teamFound, attempts, wrongTeams = null
    if (userId) {
      const p = progress || { attempts: 0, teamFound: false }
      // giving up mid team round counts as missing it
      if (!teamPhaseDone(p) && !giveUp) return res.status(400).json({ error: 'Guess the team first' })
      teamFound = p.teamFound
      attempts  = p.teamFound ? p.attempts : MAX_TEAM_ATTEMPTS
      wrongTeams = p.wrongTeams || []
    } else {
      const sent = Number(req.body.attempts)
      teamFound = !giveUp && req.body.teamFound === true
      attempts  = teamFound && Number.isInteger(sent) && sent >= 0 && sent <= 2 ? sent : MAX_TEAM_ATTEMPTS
    }

    const scored = scoreOf({ teamFound, attempts, yearGuess, season: puzzle.season })
    let saved = false
    if (userId) {
      // save the result and clear progress in one round trip
      const r = await pool.query(`
        WITH saved AS (
          INSERT INTO filmroom_results (user_id, puzzle_date, team_found, team_attempts, wrong_teams, year_guess, score)
          VALUES ($1, $2, $3, $4, $7, $5, $6)
          ON CONFLICT (user_id, puzzle_date) DO NOTHING
          RETURNING id
        ), cleared AS (
          DELETE FROM filmroom_progress WHERE user_id = $1 AND puzzle_date = $2 AND EXISTS (SELECT 1 FROM saved)
        )
        SELECT id FROM saved
      `, [userId, date, teamFound, attempts, yearGuess, scored.score, wrongTeams])
      if (!r.rows.length) return res.status(409).json({ error: 'Already finished this Film Room' })
      saved = true
    }

    res.json({
      teamFound, attempts, yearGuess, ...scored, saved,
      // signed out players already have their misses in the browser
      ...(wrongTeams ? { wrongTeams } : {}),
      clues: puzzle.clues, answer: fullReveal(puzzle),
    })
  } catch (err) {
    console.error('Film Room result failed:', err.message)
    res.status(500).json({ error: 'Could not save result' })
  }
})

// GET /filmroom/leaderboard  same shape as Pick 6's /leaderboard
router.get('/leaderboard', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(u.username, 'Anonymous') AS display_name,
             COUNT(*)::int AS puzzles_played,
             SUM(fr.score)::int AS total_score,
             ROUND(AVG(fr.score), 2)::float AS avg_score
      FROM filmroom_results fr
      JOIN users u ON u.id = fr.user_id
      GROUP BY u.id, u.username
      ORDER BY total_score DESC
      LIMIT 50
    `)
    res.json(r.rows)
  } catch (err) {
    console.error('Film Room leaderboard failed:', err.message)
    res.status(500).json({ error: 'Could not load leaderboard' })
  }
})

module.exports = {
  filmroomRouter: router, ensureFilmroomSchema, FILMROOM_EPOCH,
  // exported for the pool size check
  POOL, FRANCHISES, seasonForDate,
}

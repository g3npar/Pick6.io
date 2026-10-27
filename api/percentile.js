// percentiles: every finished game on its own day, signed in or not, goes in day_scores
const { pool, todayDateStr } = require('./puzzle')

const GAMES = ['pick6', 'filmroom', 'lineup']
// random id the browser keeps for signed out players
const isAnonId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)

async function ensurePercentileSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS day_scores (
      game        TEXT NOT NULL,
      puzzle_date DATE NOT NULL,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      anon_id     TEXT,
      score       NUMERIC(4,2) NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)
  await dbPool.query('CREATE UNIQUE INDEX IF NOT EXISTS day_scores_user ON day_scores (game, puzzle_date, user_id) WHERE user_id IS NOT NULL')
  await dbPool.query('CREATE UNIQUE INDEX IF NOT EXISTS day_scores_anon ON day_scores (game, puzzle_date, anon_id) WHERE anon_id IS NOT NULL')
  // signed in games finished on their own day, from before this table existed
  const sameDay = col => `(${col} AT TIME ZONE 'America/New_York')::date = puzzle_date`
  await dbPool.query(`
    INSERT INTO day_scores (game, puzzle_date, user_id, score)
    SELECT 'pick6', puzzle_date, user_id, score FROM user_results WHERE ${sameDay('completed_at')}
    UNION ALL
    SELECT 'filmroom', puzzle_date, user_id, score FROM filmroom_results WHERE ${sameDay('completed_at')}
    UNION ALL
    SELECT 'lineup', puzzle_date, user_id, score FROM lineup_games WHERE completed AND ${sameDay('updated_at')}
    ON CONFLICT DO NOTHING
  `)
}

// only games finished on the puzzle's own day count, archive plays don't
async function recordScore(game, date, score, userId, anonId) {
  if (date !== todayDateStr()) return
  if (!userId && !isAnonId(anonId)) return
  // never fails the guess that finished the game
  await pool.query(
    'INSERT INTO day_scores (game, puzzle_date, user_id, anon_id, score) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [game, date, userId || null, userId ? null : anonId, score]
  ).catch(err => console.error('Saving day score failed:', err.message))
}

// "top X%" against everyone else that day: ties share the best spot. null if nobody else played
const topPercent = (higher, others) => (others ? Math.max(1, Math.round((100 * (higher + 1)) / (others + 1))) : null)

async function percentileOf(game, date, score, userId, anonId) {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS others, COUNT(*) FILTER (WHERE score > $3)::int AS higher
    FROM day_scores
    WHERE game = $1 AND puzzle_date = $2
      -- leave yourself out, signed in or not
      AND ($4::int IS NULL OR user_id IS DISTINCT FROM $4)
      AND ($5::text IS NULL OR anon_id IS DISTINCT FROM $5)
  `, [game, date, score, userId || null, isAnonId(anonId) ? anonId : null])
  const { others, higher } = r.rows[0]
  return { top: topPercent(higher, others), players: others + 1 }
}

// for the profile: top % for each of a user's days in one query per game
async function percentilesFor(userId, game, rows) {
  if (!rows.length) return new Map()
  const r = await pool.query(`
    SELECT to_char(mine.d, 'YYYY-MM-DD') AS date,
           COUNT(s.*)::int AS others,
           COUNT(s.*) FILTER (WHERE s.score > mine.score)::int AS higher
    FROM unnest($3::date[], $4::numeric[]) AS mine(d, score)
    LEFT JOIN day_scores s ON s.game = $2 AND s.puzzle_date = mine.d AND s.user_id IS DISTINCT FROM $1
    GROUP BY mine.d
  `, [userId, game, rows.map(x => x.date), rows.map(x => x.score)])
  return new Map(r.rows.map(x => [x.date, topPercent(x.higher, x.others)]))
}

const express = require('express')
const { optionalAuth } = require('./auth')
const router = express.Router()

// GET /percentile?game=&date=&score=&anonId=
router.get('/', optionalAuth, async (req, res) => {
  const { game, date, anonId } = req.query
  const score = Number(req.query.score)
  if (!GAMES.includes(game) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !(score >= 0 && score <= 6)) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  try {
    res.json(await percentileOf(game, date, score, req.userId, anonId))
  } catch (err) {
    console.error('Percentile failed:', err.message)
    res.status(500).json({ error: 'Could not load percentile' })
  }
})

module.exports = { ensurePercentileSchema, recordScore, percentilesFor, percentileRouter: router }

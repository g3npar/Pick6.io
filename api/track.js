// simple counts for the admin page: who visits each day, who comes back, shares and installs.
// visitors are the same random browser id the percentile uses, nothing else is stored
const express = require('express')
const { pool, todayDateStr } = require('./puzzle')

const isAnonId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
const EVENTS = ['share', 'install']
const GAMES = ['pick6', 'filmroom', 'lineup', '']

async function ensureTrackSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS daily_visitors (
      day        DATE NOT NULL,
      visitor_id TEXT NOT NULL,
      PRIMARY KEY (day, visitor_id)
    )
  `)
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS daily_events (
      day   DATE NOT NULL,
      kind  TEXT NOT NULL,
      game  TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, kind, game)
    )
  `)
}

const router = express.Router()

// POST /track/visit  { anonId }  once a day per browser
router.post('/visit', async (req, res) => {
  const id = req.body?.anonId
  if (!isAnonId(id)) return res.status(400).json({ error: 'Invalid id' })
  try {
    await pool.query('INSERT INTO daily_visitors (day, visitor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [todayDateStr(), id])
    res.json({ ok: true })
  } catch (err) {
    console.error('Track visit failed:', err.message)
    res.status(500).json({ error: 'Could not track' })
  }
})

// POST /track/event  { kind: 'share' | 'install', game? }
router.post('/event', async (req, res) => {
  const kind = req.body?.kind
  const game = req.body?.game || ''
  if (!EVENTS.includes(kind) || !GAMES.includes(game)) return res.status(400).json({ error: 'Invalid event' })
  try {
    await pool.query(`
      INSERT INTO daily_events (day, kind, game, count) VALUES ($1, $2, $3, 1)
      ON CONFLICT (day, kind, game) DO UPDATE SET count = daily_events.count + 1
    `, [todayDateStr(), kind, game])
    res.json({ ok: true })
  } catch (err) {
    console.error('Track event failed:', err.message)
    res.status(500).json({ error: 'Could not track' })
  }
})

// last 7 days for the admin page: visitors, how many had been here before, shares, installs
async function trafficStats() {
  const today = todayDateStr()
  const [visits, events] = await Promise.all([
    pool.query(`
      SELECT to_char(v.day, 'YYYY-MM-DD') AS date, count(*)::int AS visitors,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM daily_visitors p WHERE p.visitor_id = v.visitor_id AND p.day < v.day
             ))::int AS returning
      FROM daily_visitors v
      WHERE v.day > $1::date - 7
      GROUP BY v.day
    `, [today]),
    pool.query(`
      SELECT to_char(day, 'YYYY-MM-DD') AS date, kind, game, count
      FROM daily_events WHERE day > $1::date - 7
    `, [today]),
  ])
  return { visits: visits.rows, events: events.rows }
}

module.exports = { ensureTrackSchema, trackRouter: router, trafficStats }

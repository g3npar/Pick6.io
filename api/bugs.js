// bug reports from the "Report a bug" page, read on the admin page
const express = require('express')
const { pool } = require('./puzzle')
const { optionalAuth } = require('./auth')

const GAMES = ['pick6', 'filmroom', 'lineup', 'other']

async function ensureBugSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      game       TEXT NOT NULL,
      message    TEXT NOT NULL,
      contact    TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
}

const router = express.Router()

// POST /bugs  { game, message, contact? }
router.post('/', optionalAuth, async (req, res) => {
  const game = GAMES.includes(req.body?.game) ? req.body.game : 'other'
  const message = String(req.body?.message || '').trim().slice(0, 2000)
  const contact = String(req.body?.contact || '').trim().slice(0, 200) || null
  if (message.length < 5) return res.status(400).json({ error: 'Tell us a little more about the bug' })
  try {
    await pool.query(
      'INSERT INTO bug_reports (user_id, game, message, contact, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [req.userId || null, game, message, contact, String(req.get('user-agent') || '').slice(0, 300)]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('Bug report failed:', err.message)
    res.status(500).json({ error: 'Could not send that, try again later' })
  }
})

// newest first, for the admin page
async function listBugs() {
  const r = await pool.query(`
    SELECT b.id, b.game, b.message, b.contact, b.user_agent, b.created_at, u.email
    FROM bug_reports b LEFT JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC
    LIMIT 100
  `)
  return r.rows
}

module.exports = { ensureBugSchema, bugsRouter: router, listBugs }

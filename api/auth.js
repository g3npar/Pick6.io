'use strict'
const { OAuth2Client } = require('google-auth-library')
const jwt = require('jsonwebtoken')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const JWT_SECRET = process.env.JWT_SECRET
const SESSION_DAYS = 30
const COOKIE_NAME = 'session'

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

// admin email allowlist
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase())
}

// creates tables if missing
async function ensureAuthSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      google_id    TEXT UNIQUE NOT NULL,
      email        TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url   TEXT,
      created_at   TIMESTAMPTZ DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_results (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_date    DATE NOT NULL,
      lie_found      BOOLEAN NOT NULL,
      lie_attempts   SMALLINT NOT NULL,
      player_correct BOOLEAN NOT NULL,
      score          SMALLINT NOT NULL,
      completed_at   TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, puzzle_date)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_results_user ON user_results (user_id)')
  // custom display name
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE')
  // typed player guess for refresh restore
  await pool.query('ALTER TABLE user_results ADD COLUMN IF NOT EXISTS player_guess TEXT')
  // tracked lie guess progress
  await pool.query(`
    CREATE TABLE IF NOT EXISTS puzzle_progress (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      puzzle_date  DATE NOT NULL,
      lie_attempts SMALLINT NOT NULL DEFAULT 0,
      wrong_ids    SMALLINT[] NOT NULL DEFAULT '{}',
      lie_found    BOOLEAN NOT NULL DEFAULT false,
      updated_at   TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, puzzle_date)
    )
  `)
}

// verifies google id token
async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Google sign-in is not configured on this server')
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
  const payload = ticket.getPayload()
  if (!payload?.sub || !payload?.email) throw new Error('Invalid Google credential')
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || null,
  }
}

async function upsertUser(pool, { googleId, email, name, picture }) {
  const res = await pool.query(`
    INSERT INTO users (google_id, email, display_name, avatar_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (google_id) DO UPDATE
      SET email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url
    RETURNING id, email, display_name, username, avatar_url
  `, [googleId, email, name, picture])
  return res.rows[0]
}

// sets custom username
async function setUsername(pool, userId, username) {
  try {
    const res = await pool.query(
      'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, email, display_name, username, avatar_url',
      [username, userId]
    )
    return res.rows[0]
  } catch (err) {
    if (err.code === '23505') throw new Error('That username is taken')
    throw err
  }
}

function signSession(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` })
}

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET).uid
  } catch {
    return null
  }
}

// lax works for shared domain
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
}

// attaches userId or null never rejects
function optionalAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  req.userId = token ? verifySession(token) : null
  next()
}

// same but rejects with 401
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  const uid = token ? verifySession(token) : null
  if (!uid) return res.status(401).json({ error: 'Sign in required' })
  req.userId = uid
  next()
}

module.exports = {
  COOKIE_NAME,
  cookieOptions,
  ensureAuthSchema,
  verifyGoogleCredential,
  upsertUser,
  setUsername,
  signSession,
  optionalAuth,
  requireAuth,
  isAdminEmail,
}

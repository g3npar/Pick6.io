'use strict'
const { OAuth2Client } = require('google-auth-library')
const jwt = require('jsonwebtoken')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const JWT_SECRET = process.env.JWT_SECRET
const SESSION_DAYS = 30
const COOKIE_NAME = 'session'

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

// Creates the users/user_results tables if they don't exist yet. Safe to call on every boot.
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
}

// Verifies a Google Identity Services credential (ID token) and returns the
// caller's real, verified Google account details. Throws if the token is
// invalid, expired, or wasn't issued for this app.
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
    RETURNING id, email, display_name, avatar_url
  `, [googleId, email, name, picture])
  return res.rows[0]
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

// Frontend (pick-six.io) and API (api.pick-six.io) share a parent domain, so
// the browser treats them as same-site — Lax works everywhere and avoids the
// SameSite=None cross-site cookie flakiness (Safari, browsers with strict
// third-party cookie rules) a split vercel.app/onrender.com setup would hit.
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
}

// Attaches req.userId if a valid session cookie is present, otherwise null. Never rejects.
function optionalAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  req.userId = token ? verifySession(token) : null
  next()
}

// Same, but rejects with 401 if there's no valid session.
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
  signSession,
  optionalAuth,
  requireAuth,
}

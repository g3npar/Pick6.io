// Mirror of _normName in api/puzzle.js — keep the two in step, or the admin
// play test will grade a guess differently from the real game.
// Suffix- and punctuation-insensitive, so "Antoine Winfield Jr", "Antoine
// Winfield Jr." and "antoine  winfield" all compare equal.
export function normalizePlayerName(name) {
  return String(name ?? '').toLowerCase()
    .replace(/\bj\.?r\.?\b|\bs\.?r\.?\b|\bii\b|\biii\b|\biv\b|\bv\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// same as _normName in api/puzzle.js, keep them matching. ignores suffixes, punctuation and case
export function normalizePlayerName(name) {
  return String(name ?? '').toLowerCase()
    .replace(/\bj\.?r\.?\b|\bs\.?r\.?\b|\bii\b|\biii\b|\biv\b|\bv\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

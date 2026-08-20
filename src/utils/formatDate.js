// Dates arrive as plain "YYYY-MM-DD" strings; parse as a local calendar date
// (not UTC) so it can't drift a day off in any timezone.
export function formatDate(d) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

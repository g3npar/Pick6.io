// share text and copying, shared by all three games so their results look the same:
//
//   Film Room #10
//   🟥🟩 Team: 2/3
//   🟨 Year: 1/3
//   3/6
//
//   https://pick6.io

// a red square per miss, then green for the one you got, or three reds if you never did
export const tries = (got, misses) => (got ? '🟥'.repeat(Math.max(0, misses)) + '🟩' : '🟥🟥🟥')

// 4.75, 5.5, 6, never 5.50
export const pts = n => String(Number(Number(n).toFixed(2)))

// lines: [[squares, label, points, out of], ...]
export function shareText(title, lines, score) {
  const body = lines.map(([squares, label, got, of]) => `${squares} ${label}: ${pts(got)}/${of}`).join('\n')
  return `${title}\n${body}\n${pts(score)}/6\n\nhttps://pick6.io`
}

// clipboard, with the old textarea trick for browsers that block it
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

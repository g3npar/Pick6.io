// share text for all three games, e.g. "Film Room #10 / 🟥🟩 Team: 2/3 / 🟨 Year: 1/3 / 3/6 (Top 20%)"

// red per miss then green, or three reds
export const tries = (got, misses) => (got ? '🟥'.repeat(Math.max(0, misses)) + '🟩' : '🟥🟥🟥')

// no trailing zeros
export const pts = n => String(Number(Number(n).toFixed(2)))

// lines: [[squares, label, points, out of], ...], top: the day's top %, if known
export function shareText(title, lines, score, top = null) {
  const body = lines.map(([squares, label, got, of]) => `${squares} ${label}: ${pts(got)}/${of}`).join('\n')
  return `${title}\n${body}\n${pts(score)}/6${top ? ` (Top ${top}%)` : ''}\n\nhttps://pick6.io`
}

// clipboard, with a fallback
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

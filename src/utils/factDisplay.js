/**
 * Parses a plain-text fact sentence into structured display parts.
 * Returns { label, value, sublabel }
 *   label:    small category heading (e.g. "PRO BOWLS", "RUSHING YARDS")
 *   value:    the prominent display value (e.g. "5", "2,097", "Ohio State")
 *   sublabel: optional context (e.g. "in 2012", null)
 */

// Compacts "2018, 2020 and 2022" → "2018, 2020 & 2022" for tight sublabel space
const amp = s => s.replace(/ and /g, ' & ')

export function parseFact(text) {
  let m

  m = text.match(/Was selected to (\d+) Pro Bowl/)
  if (m) return { label: 'WON', value: m[1], sublabel: m[1] === '1' ? 'PRO BOWL' : 'PRO BOWLS' }

  m = text.match(/Won (\d+) Super Bowl/)
  if (m) return { label: 'WON', value: m[1], sublabel: 'SUPER BOWL' + (parseInt(m[1]) !== 1 ? 'S' : '') }

  if (/Won a Super Bowl/.test(text)) return { label: 'WON', value: '1', sublabel: 'SUPER BOWL' }

  if (/Never won a Super Bowl/.test(text)) return { label: 'WON', value: '0', sublabel: 'SUPER BOWLS' }

  m = text.match(/Was named AP First-Team All-Pro (\d+) time/)
  if (m) return { label: 'WON', value: m[1], sublabel: 'AP ALL-PRO' }

  m = text.match(/Won the AP NFL MVP award in (\d{4})$/)
  if (m) return { label: 'WON', value: 'AP MVP', sublabel: m[1] }

  m = text.match(/Won the AP NFL MVP award in (.+)/)
  if (m) return { label: 'WON', value: 'AP MVP', sublabel: amp(m[1]) }

  m = text.match(/Rushed for ([0-9,]+) yards in the (\d{4}) season/)
  if (m) return { label: 'RUSHING YDS', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Threw for ([0-9,]+) yards.*in the (\d{4}) season/)
  if (m) return { label: 'PASSING YDS', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Threw (\d+) touchdown passes in the (\d{4}) season/)
  if (m) return { label: 'PASSING TDs', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Had ([0-9,]+) receiving yards in the (\d{4}) season/)
  if (m) return { label: 'RECEIVING YARDS', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Caught (\d+) receiving touchdowns? in the (\d{4}) season/)
  if (m) return { label: 'RECEIVING TDs', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Recorded (\d+) sacks? in the (\d{4}) season/)
  if (m) return { label: 'SACKS', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Recorded (\d+) interceptions? in the (\d{4}) season/)
  if (m) return { label: 'INTERCEPTIONS', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Played for the (.+) during their career/)
  if (m) return { label: 'PLAYED FOR', value: m[1], sublabel: null, isTeams: true }

  m = text.match(/Wears jersey number (\d+)/)
  if (m) return { label: 'JERSEY NO.', value: m[1], sublabel: null, isJersey: true }

  m = text.match(/Played college football at (.+)/)
  if (m) return { label: 'COLLEGE', value: m[1], sublabel: null, isCollege: true }

  m = text.match(/Was the (\w+) overall pick \(Round (\d+)\) in the (\d{4}) NFL Draft/)
  if (m) return { label: 'NFL DRAFT', value: m[1], sublabel: `Rd ${m[2]} · ${m[3]}` }

  m = text.match(/Was the (\w+) overall pick in the (\d{4}) NFL Draft/)
  if (m) return { label: 'NFL DRAFT', value: m[1], sublabel: `in ${m[2]}` }

  m = text.match(/Won the Heisman Trophy in (\d{4})/)
  if (m) return { label: 'WON', value: 'HEISMAN', sublabel: `in ${m[1]}` }

  m = text.match(/Hall of Fame in the class of (\d{4})/)
  if (m) return { label: 'INDUCTED INTO', value: 'HALL OF FAME', sublabel: `in ${m[1]}` }

  const awardMap = {
    'AP Offensive Rookie of the Year': 'OROY',
    'AP Defensive Rookie of the Year': 'DROY',
    'AP Offensive Player of the Year': 'OPOY',
    'AP Defensive Player of the Year': 'DPOY',
    'AP Comeback Player of the Year':  'CPOY',
  }
  for (const [full, short] of Object.entries(awardMap)) {
    m = text.match(new RegExp(`Won the ${full} award (.+)`))
    if (m) return { label: 'WON', value: short, sublabel: m[1] }
  }

  return { label: 'FACT', value: text, sublabel: null }
}

/**
 * Parses a plain-text fact sentence into structured display parts.
 * Returns { label, value, sublabel }
 *   label    — small category heading (e.g. "PRO BOWLS", "RUSHING YARDS")
 *   value    — the prominent display value (e.g. "5", "2,097", "Ohio State")
 *   sublabel — optional context (e.g. "in 2012", null)
 */

export function parseFact(text) {
  let m

  // Pro Bowls
  m = text.match(/Was selected to (\d+) Pro Bowl/)
  if (m) return { label: 'WON', value: m[1], sublabel: m[1] === '1' ? 'PRO BOWL' : 'PRO BOWLS' }

  // Super Bowl — won N
  m = text.match(/Won (\d+) Super Bowl/)
  if (m) return { label: 'WON', value: m[1], sublabel: 'SUPER BOWL' + (parseInt(m[1]) !== 1 ? 'S' : '') }

  // Super Bowl — won a (= 1)
  if (/Won a Super Bowl/.test(text)) return { label: 'WON', value: '1', sublabel: 'SUPER BOWL' }

  // Super Bowl — never
  if (/Never won a Super Bowl/.test(text)) return { label: 'WON', value: '0', sublabel: 'SUPER BOWLS' }

  // AP All-Pro
  m = text.match(/Was named AP First-Team All-Pro (\d+) time/)
  if (m) return { label: 'WON', value: `${m[1]}\u00d7`, sublabel: 'AP ALL-PRO' }

  // AP MVP — single year
  m = text.match(/Won the AP NFL MVP award in (\d{4})$/)
  if (m) return { label: 'WON', value: 'AP MVP', sublabel: m[1] }

  // AP MVP — multiple years (e.g. "in 2011 and 2014")
  m = text.match(/Won the AP NFL MVP award in (.+)/)
  if (m) return { label: 'WON', value: 'AP MVP', sublabel: amp(m[1]) }

  // Rushing
  m = text.match(/Rushed for ([0-9,]+) yards in the (\d{4}) season/)
  if (m) return { label: 'RUSHING YDS', value: m[1], sublabel: `in ${m[2]}` }

  // Passing — show yards only
  m = text.match(/Threw for ([0-9,]+) yards.*in the (\d{4}) season/)
  if (m) return { label: 'PASSING YDS', value: m[1], sublabel: `in ${m[2]}` }

  // Receiving yards
  m = text.match(/Had ([0-9,]+) receiving yards in the (\d{4}) season/)
  if (m) return { label: 'REC. YARDS', value: m[1], sublabel: `in ${m[2]}` }

  // Receiving TDs
  m = text.match(/Caught (\d+) receiving touchdowns? in the (\d{4}) season/)
  if (m) return { label: 'REC. TDs', value: m[1], sublabel: `in ${m[2]}` }

  // Sacks
  m = text.match(/Recorded (\d+) sacks? in the (\d{4}) season/)
  if (m) return { label: 'SACKS', value: m[1], sublabel: `in ${m[2]}` }

  // Played for
  m = text.match(/Played for the (.+) during their career/)
  if (m) return { label: 'PLAYED FOR', value: m[1], sublabel: null, isTeams: true }

  // College
  m = text.match(/Played college football at (.+)/)
  if (m) return { label: 'COLLEGE', value: m[1], sublabel: null, isCollege: true }

  // Draft
  m = text.match(/Was the (\w+) overall pick in the (\d{4}) NFL Draft/)
  if (m) return { label: 'NFL DRAFT', value: m[1] + ' pick', sublabel: m[2] }

  // Heisman
  m = text.match(/Won the Heisman Trophy in (\d{4})/)
  if (m) return { label: 'WON', value: 'HEISMAN', sublabel: `in ${m[1]}` }

  // Hall of Fame
  m = text.match(/Hall of Fame in the class of (\d{4})/)
  if (m) return { label: 'INDUCTED INTO', value: 'HALL OF FAME', sublabel: `in ${m[1]}` }

  // Named AP awards (OROY, DROY, OPOY, DPOY, CPOY)
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

  // Fallback
  return { label: 'FACT', value: text, sublabel: null }
}

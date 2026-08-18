'use strict'
const { Pool, types } = require('pg')
const fs   = require('fs')
const path = require('path')

// Returns DATE columns as plain "YYYY-MM-DD" strings instead of a JS Date.
types.setTypeParser(1082, val => val)

// Awards CSV, loaded once at startup.
const _awardsIdx = new Map()  // normalizedName → [{award, year, ...}]

function _normName(n) {
  return String(n).toLowerCase()
    .replace(/\bj\.?r\.?\b|\bii\b|\biii\b|\biv\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

;(function loadAwardsCSV() {
  const csvPath = path.join(__dirname, '..', 'public', 'awards.csv')
  if (!fs.existsSync(csvPath)) { console.warn('awards.csv not found, CSV facts disabled'); return }
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 3) continue
    const row = {
      player:   parts[0].trim(),
      award:    parts[1].trim(),
      year:     parseInt(parts[2]) || 0,
      team:     (parts[3] || '').trim(),
      position: (parts[4] || '').trim(),
    }
    const key = _normName(row.player)
    if (!_awardsIdx.has(key)) _awardsIdx.set(key, [])
    _awardsIdx.get(key).push(row)
  }
  console.log(`Awards CSV loaded: ${_awardsIdx.size} players indexed`)
})()

function lookupAwards(playerName) {
  const key = _normName(playerName)
  // Exact match only, to avoid contamination from a last-name fallback.
  return _awardsIdx.get(key) || []
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
})

function seedRng(seed) {
  let s = (seed ^ 0xdeadbeef) >>> 0 || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

function seededShuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Formatting helpers.
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

function fakeYear(year, rng) {
  const delta = 1 + Math.floor(rng() * 3)
  const sign  = (year + delta > 2025) ? -1 : (year - delta < 1970) ? 1 : (rng() < 0.5 ? 1 : -1)
  return year + sign * delta
}

const NFL_COLLEGES = [
  'Alabama', 'Ohio State', 'Michigan', 'USC', 'LSU', 'Florida', 'Texas',
  'Notre Dame', 'Penn State', 'Clemson', 'Georgia', 'Oklahoma', 'Stanford',
  'Nebraska', 'Auburn', 'Florida State', 'Miami', 'Tennessee', 'Wisconsin',
  'Iowa', 'Oregon', 'Washington', 'Pittsburgh', 'Virginia Tech', 'TCU',
  'Baylor', 'Texas A&M', 'Mississippi State', 'Ole Miss', 'Boise State',
  'Arizona State', 'Colorado', 'North Carolina', 'Louisville', 'Maryland',
]

function otherCollege(real, rng) {
  const pool = NFL_COLLEGES.filter(c => c.toLowerCase() !== real.toLowerCase())
  return pool[Math.floor(rng() * pool.length)]
}

// Award display labels.
const AWARD_LABELS = {
  OPOY: 'AP Offensive Player of the Year',
  DPOY: 'AP Defensive Player of the Year',
  OROY: 'AP Offensive Rookie of the Year',
  DROY: 'AP Defensive Rookie of the Year',
  CPOY: 'AP Comeback Player of the Year',
}

// Fact builders, each returning { cat, text, makeLie(rng) } or null if the player lacks data for that category.

function primaryCollege(raw) {
  if (!raw) return null
  return raw.split(';')[0].trim()
}

function collegeFact(p) {
  const college = primaryCollege(p.college)
  if (!college) return null
  return {
    cat: 'college',
    text: `Played college football at ${college}`,
    makeLie(rng) {
      const fake = otherCollege(college, rng)
      return {
        text: `Played college football at ${fake}`,
        explanation: `${p.name} played at ${college}, not ${fake}.`,
      }
    },
  }
}

function jerseyFact(p) {
  if (p.jersey_number === null || p.jersey_number === undefined) return null
  return {
    cat: 'jersey',
    text: `Wears jersey number ${p.jersey_number}`,
    makeLie(rng) {
      let fake
      do { fake = Math.floor(rng() * 100) } while (fake === p.jersey_number)
      return {
        text: `Wears jersey number ${fake}`,
        explanation: `${p.name} actually wears number ${p.jersey_number}, not ${fake}.`,
      }
    },
  }
}

const roundForPick = pick => Math.min(7, Math.max(1, Math.ceil(pick / 32)))

function draftFact(p) {
  if (!p.draft_number || !p.draft_year || !p.draft_round) return null
  return {
    cat: 'draft',
    text: `Was the ${ordinal(p.draft_number)} overall pick (Round ${p.draft_round}) in the ${p.draft_year} NFL Draft`,
    makeLie(rng) {
      const delta = 3 + Math.floor(rng() * 12)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(1, p.draft_number + sign * delta)
      return {
        text: `Was the ${ordinal(fake)} overall pick (Round ${roundForPick(fake)}) in the ${p.draft_year} NFL Draft`,
        explanation: `${p.name} was actually the ${ordinal(p.draft_number)} overall pick (Round ${p.draft_round}).`,
      }
    },
  }
}

function allProFact(p, count) {
  if (!count) return null
  const pl = count > 1 ? 's' : ''
  return {
    cat: 'allpro',
    text: `Was named AP First-Team All-Pro ${count} time${pl}`,
    makeLie(rng) {
      const delta = 1 + Math.floor(rng() * 2)
      const fake  = rng() < 0.5 ? count + delta : Math.max(1, count - delta)
      const fpl   = fake > 1 ? 's' : ''
      return {
        text: `Was named AP First-Team All-Pro ${fake} time${fpl}`,
        explanation: `${p.name} earned ${count} First-Team All-Pro selection${pl}, not ${fake}.`,
      }
    },
  }
}

function proBowlFact(p, count) {
  if (!count) return null
  const pl = count > 1 ? 's' : ''
  return {
    cat: 'probowl',
    text: `Was selected to ${count} Pro Bowl${pl}`,
    makeLie(rng) {
      const delta = 1 + Math.floor(rng() * 3)
      // Always add when subtracting would hit 0 or the same value
      const fake  = (count - delta) >= 1 && (count - delta) !== count && rng() < 0.5
        ? count - delta
        : count + delta
      const fpl   = fake > 1 ? 's' : ''
      return {
        text: `Was selected to ${fake} Pro Bowl${fpl}`,
        explanation: `${p.name} was selected to ${count} Pro Bowl${pl}, not ${fake}.`,
      }
    },
  }
}

function superBowlFact(p, sbWins) {
  if (sbWins === 0) {
    return {
      cat: 'superbowl',
      text: `Never won a Super Bowl championship`,
      makeLie(_rng) {
        return {
          text: `Won a Super Bowl championship`,
          explanation: `${p.name} never won a Super Bowl.`,
        }
      },
    }
  }
  const pl = sbWins > 1 ? 's' : ''
  return {
    cat: 'superbowl',
    text: `Won ${sbWins} Super Bowl championship${pl}`,
    makeLie(_rng) {
      const fake     = sbWins === 1 ? 0 : sbWins - 1
      const fakeText = fake === 0
        ? `Never won a Super Bowl championship`
        : `Won ${fake} Super Bowl championship${fake > 1 ? 's' : ''}`
      return {
        text: fakeText,
        explanation: `${p.name} won ${sbWins} Super Bowl${pl}.`,
      }
    },
  }
}

function mvpFact(p, mvpYears) {
  if (!mvpYears.length) return null
  const yrs    = [...mvpYears].sort()
  const yearStr = yrs.length === 1
    ? `in ${yrs[0]}`
    : `in ${yrs.slice(0, -1).join(', ')} and ${yrs[yrs.length - 1]}`
  return {
    cat: 'mvp',
    text: `Won the AP NFL MVP award ${yearStr}`,
    makeLie(rng) {
      const shift    = rng() < 0.5 ? 1 : -1
      const fakeYrs  = [yrs[0] + shift, ...yrs.slice(1)]
      const fakeStr  = fakeYrs.length === 1
        ? `in ${fakeYrs[0]}`
        : `in ${fakeYrs.slice(0, -1).join(', ')} and ${fakeYrs[fakeYrs.length - 1]}`
      return {
        text: `Won the AP NFL MVP award ${fakeStr}`,
        explanation: `${p.name} won the MVP ${yearStr}.`,
      }
    },
  }
}

function passingFact(p, season) {
  if (!season || !season.passing_yards || season.passing_yards < 2000) return null
  return {
    cat: 'passing',
    text: `Threw for ${fmt(season.passing_yards)} yards and ${season.passing_tds} touchdowns in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Threw for ${fmt(season.passing_yards)} yards and ${season.passing_tds} touchdowns in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function passingTdsFact(p, season) {
  if (!season || !season.passing_tds || season.passing_tds < 20) return null
  return {
    cat: 'passing_tds',
    text: `Threw ${season.passing_tds} touchdown passes in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Threw ${season.passing_tds} touchdown passes in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function rushingFact(p, season) {
  if (!season || !season.rush_yards || season.rush_yards < 500) return null
  return {
    cat: 'rushing',
    text: `Rushed for ${fmt(season.rush_yards)} yards in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Rushed for ${fmt(season.rush_yards)} yards in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function receivingFact(p, season) {
  if (!season || !season.receiving_yards || season.receiving_yards < 500) return null
  return {
    cat: 'receiving',
    text: `Had ${fmt(season.receiving_yards)} receiving yards in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Had ${fmt(season.receiving_yards)} receiving yards in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function recTdFact(p, season) {
  if (!season || !season.rec_tds || season.rec_tds < 4) return null
  return {
    cat: 'rec_tds',
    text: `Caught ${season.rec_tds} receiving touchdowns in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Caught ${season.rec_tds} receiving touchdowns in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function sacksFact(p, season) {
  // Only valid for defensive positions, since the sacks column means times sacked for offensive players.
  const defPositions = /^(DE|DT|LB|OLB|ILB|MLB|EDGE|NT|DL|LDE|RDE|LDT|RDT|LLB|RLB|LILB|RILB|LOLB|ROLB|LE|RE)$/i
  if (!defPositions.test(p.position || '')) return null
  if (!season || !season.sacks || season.sacks < 5) return null
  return {
    cat: 'sacks',
    text: `Recorded ${season.sacks} sacks in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Recorded ${season.sacks} sacks in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function intsFact(p, season) {
  const dbPositions = /^(CB|S|SS|FS|DB|SAF|LCB|RCB)$/i
  if (!dbPositions.test(p.position || '')) return null
  if (!season || !season.def_ints || season.def_ints < 3) return null
  return {
    cat: 'def_ints',
    text: `Recorded ${season.def_ints} interceptions in the ${season.season_year} season`,
    makeLie(rng) {
      const fakeYr = fakeYear(season.season_year, rng)
      return {
        text: `Recorded ${season.def_ints} interceptions in the ${fakeYr} season`,
        explanation: `${p.name} did that in ${season.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

function heismanFact(p) {
  if (!p.heisman_year) return null
  return {
    cat: 'heisman',
    text: `Won the Heisman Trophy in ${p.heisman_year}`,
    makeLie(rng) {
      const shift   = rng() < 0.5 ? 1 : -1
      const fakeYr  = p.heisman_year + shift
      return {
        text: `Won the Heisman Trophy in ${fakeYr}`,
        explanation: `${p.name} won the Heisman in ${p.heisman_year}, not ${fakeYr}.`,
      }
    },
  }
}

const TEAM_FULL = {
  ARI:'Arizona Cardinals', ATL:'Atlanta Falcons', BAL:'Baltimore Ravens',
  BUF:'Buffalo Bills', CAR:'Carolina Panthers', CHI:'Chicago Bears',
  CIN:'Cincinnati Bengals', CLE:'Cleveland Browns', DAL:'Dallas Cowboys',
  DEN:'Denver Broncos', DET:'Detroit Lions', GB:'Green Bay Packers',
  HOU:'Houston Texans', IND:'Indianapolis Colts', JAC:'Jacksonville Jaguars',
  JAX:'Jacksonville Jaguars', KC:'Kansas City Chiefs', LA:'Los Angeles Rams',
  LAC:'Los Angeles Chargers', LAR:'Los Angeles Rams', LV:'Las Vegas Raiders',
  MIA:'Miami Dolphins', MIN:'Minnesota Vikings', NE:'New England Patriots',
  NO:'New Orleans Saints', NYG:'New York Giants', NYJ:'New York Jets',
  OAK:'Las Vegas Raiders', PHI:'Philadelphia Eagles', PIT:'Pittsburgh Steelers',
  SD:'Los Angeles Chargers', SEA:'Seattle Seahawks', SF:'San Francisco 49ers',
  STL:'Los Angeles Rams', TB:'Tampa Bay Buccaneers', TEN:'Tennessee Titans',
  WAS:'Washington Commanders', WSH:'Washington Commanders',
}

function playedForFact(p, seasons, rng) {
  const MULTI_TEAM = /^\d+TM$/
  const abbrs = [...new Set(seasons.map(s => s.team).filter(a => a && !MULTI_TEAM.test(a)))]
  if (!abbrs.length) return null
  const allNames = [...new Set(abbrs.map(a => TEAM_FULL[a] || a).filter(Boolean))]
  if (!allNames.length) return null
  const count = 1 + Math.floor(rng() * Math.min(3, allNames.length))
  const names = allNames.slice(0, count)
  const teamStr = names.join(', ')
  return {
    cat: 'played_for',
    text: `Played for the ${teamStr} during their career`,
    makeLie(rng) {
      const allTeams = Object.values(TEAM_FULL).filter(t => !allNames.includes(t))
      const fakeTeam = allTeams[Math.floor(rng() * allTeams.length)]
      const fakeNames = names.length > 1
        ? [...names.slice(0, -1), fakeTeam]
        : [fakeTeam]
      return {
        text: `Played for the ${fakeNames.join(', ')} during their career`,
        explanation: `${p.name} played for the ${teamStr}, not ${fakeTeam}.`,
      }
    },
  }
}

function awardFact(p, award) {
  const label = AWARD_LABELS[award.award_type]
  if (!label) return null
  return {
    cat: `award_${award.award_type}`,
    text: `Won the ${label} award in ${award.season_year}`,
    makeLie(rng) {
      const shift   = rng() < 0.5 ? 1 : -1
      const fakeYr  = award.season_year + shift
      return {
        text: `Won the ${label} award in ${fakeYr}`,
        explanation: `${p.name} won the ${label} in ${award.season_year}, not ${fakeYr}.`,
      }
    },
  }
}

// CSV-backed fact builders.

function hofFact(p, csvAwards) {
  const entry = csvAwards.find(a => a.award === 'HOF' && a.year > 0)
  if (!entry) return null
  return {
    cat: 'hof',
    text: `Was inducted into the Pro Football Hall of Fame in the class of ${entry.year}`,
    makeLie(rng) {
      const fakeYr = entry.year + (rng() < 0.5 ? 2 : -2)
      return {
        text: `Was inducted into the Pro Football Hall of Fame in the class of ${fakeYr}`,
        explanation: `${p.name} was inducted in the class of ${entry.year}, not ${fakeYr}.`,
      }
    },
  }
}

function csvAwardFact(p, csvAwards) {
  const CSV_LABELS = {
    OPOY: 'AP Offensive Player of the Year',
    DPOY: 'AP Defensive Player of the Year',
    OROY: 'AP Offensive Rookie of the Year',
    DROY: 'AP Defensive Rookie of the Year',
    CPOY: 'AP Comeback Player of the Year',
  }
  // Return one fact for the highest-priority award the player won
  for (const atype of ['OPOY', 'DPOY', 'OROY', 'DROY', 'CPOY']) {
    const entries = csvAwards.filter(a => a.award === atype && a.year > 0)
    if (!entries.length) continue
    const label  = CSV_LABELS[atype]
    const years  = [...new Set(entries.map(e => e.year))].sort()
    const yearStr = years.length === 1
      ? `in ${years[0]}`
      : `in ${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`
    return {
      cat: `csv_${atype}`,
      text: `Won the ${label} award ${yearStr}`,
      makeLie(rng) {
        const shift   = rng() < 0.5 ? 1 : -1
        const fakeYrs = [years[0] + shift, ...years.slice(1)]
        const fakeStr = fakeYrs.length === 1
          ? `in ${fakeYrs[0]}`
          : `in ${fakeYrs.slice(0, -1).join(', ')} and ${fakeYrs[fakeYrs.length - 1]}`
        return {
          text: `Won the ${label} award ${fakeStr}`,
          explanation: `${p.name} won the ${label} ${yearStr}.`,
        }
      },
    }
  }
  return null
}

// Assembles the fact pool for a player.
function buildFactPool(player, seasons, dbAwards, rng) {
  // CSV awards: Pro Bowl count, HOF, OPOY/DPOY/OROY/DROY/CPOY
  const csvAwards = lookupAwards(player.name)

  // CSV counts are more reliable than the DB's ap_allpro_first/pro_bowl columns
  const csvAllProCount = csvAwards.filter(a => a.award === 'ALL_PRO_FIRST').length
  const allPro      = csvAllProCount || seasons.filter(s => s.ap_allpro_first).length
  const csvPBCount = csvAwards.filter(a => a.award === 'PRO_BOWL').length
  const proBowl    = csvPBCount || seasons.filter(s => s.pro_bowl).length
  const sbWins  = seasons.filter(s => s.super_bowl_winner).length
  const mvpYrs  = seasons.filter(s => s.ap_mvp).map(s => s.season_year)

  // Best single-season performances per category
  const bestPass    = [...seasons].filter(s => s.passing_yards  > 0).sort((a, b) => b.passing_yards  - a.passing_yards)[0]
  const bestPassTds = [...seasons].filter(s => s.passing_tds > 0).sort((a, b) => b.passing_tds - a.passing_tds)[0]
  const bestRush    = [...seasons].filter(s => s.rush_yards     > 0).sort((a, b) => b.rush_yards     - a.rush_yards)[0]
  const bestRec  = [...seasons].filter(s => s.receiving_yards > 0).sort((a, b) => b.receiving_yards - a.receiving_yards)[0]
  const bestRTd  = [...seasons].filter(s => s.rec_tds        > 0).sort((a, b) => b.rec_tds        - a.rec_tds)[0]
  const bestSack = [...seasons].filter(s => s.sacks          > 0).sort((a, b) => b.sacks          - a.sacks)[0]
  const bestInts = [...seasons].filter(s => s.def_ints       > 0).sort((a, b) => b.def_ints       - a.def_ints)[0]

  return [
    collegeFact(player),
    draftFact(player),
    jerseyFact(player),
    allPro  > 0 ? allProFact(player, allPro)     : null,
    proBowl > 0 ? proBowlFact(player, proBowl)   : null,
    superBowlFact(player, sbWins),
    mvpYrs.length ? mvpFact(player, mvpYrs)       : null,
    passingFact(player, bestPass),
    passingTdsFact(player, bestPassTds),
    rushingFact(player, bestRush),
    receivingFact(player, bestRec),
    recTdFact(player, bestRTd),
    sacksFact(player, bestSack),
    intsFact(player, bestInts),
    heismanFact(player),
    hofFact(player, csvAwards),
    csvAwardFact(player, csvAwards),
    playedForFact(player, seasons, rng),
    ...dbAwards.map(a => awardFact(player, a)),
  ].filter(Boolean)
}

const STAT_CATS = new Set(['passing', 'passing_tds', 'rushing', 'receiving', 'rec_tds', 'sacks', 'def_ints'])

// Builds one puzzle from raw DB data.
function buildPuzzle(id, player, seasons, awards, seed) {
  const rng  = seedRng(seed)
  const pool = buildFactPool(player, seasons, awards, rng)
  if (pool.length < 6) return null

  const statFacts    = seededShuffle(pool.filter(f =>  STAT_CATS.has(f.cat)), rng)
  const nonStatFacts = seededShuffle(pool.filter(f => !STAT_CATS.has(f.cat)), rng)

  // Uses at most one stat fact and fills the rest with non-stat facts, aiming for six.
  const chosen = [
    ...statFacts.slice(0, 1),
    ...nonStatFacts,
  ].slice(0, 6)

  // Fall back to more stat facts if we can't reach 6
  if (chosen.length < 6) {
    chosen.push(...statFacts.slice(1, 6 - chosen.length + 1))
  }
  // Every one of the six needs a fact, so a partial puzzle is never returned.
  if (chosen.length < 6) return null

  const lieIdx = Math.floor(rng() * chosen.length)
  const lie    = chosen[lieIdx].makeLie(rng)

  const teams   = [...new Set(seasons.map(s => s.team).filter(Boolean))]
  const teamStr = teams.length <= 2 ? teams.join(' / ') : `${teams[0]} and others`

  return {
    id,
    playerName:       player.name,
    position:         player.position,
    team:             teamStr,
    facts:            chosen.map((f, i) => ({ id: i + 1, text: i === lieIdx ? lie.text : f.text })),
    falseFactId:      lieIdx + 1,
    falseExplanation: lie.explanation,
    trueText:         chosen[lieIdx].text,
  }
}

// DB helpers.
async function fetchEligibleIds() {
  const res = await pool.query(`
    SELECT p.id, p.name
    FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    GROUP BY p.id
    HAVING COUNT(ps.id) >= 3
    ORDER BY p.id
  `)

  const era1 = [], era2 = [], era3 = []
  for (const r of res.rows) {
    // awards.csv has no Pro Bowl rows, so All-Pro selections place a player in an era instead.
    const allPros = lookupAwards(r.name).filter(a => a.award === 'ALL_PRO_FIRST' && a.year > 0)
    if (allPros.length < 1) continue

    // Uses the median All-Pro year to determine era.
    const years = allPros.map(a => a.year).sort((a, b) => a - b)
    const median = years[Math.floor(years.length / 2)]

    if (median <= 1995)      era1.push(r.id)
    else if (median <= 2010) era2.push(r.id)
    else                     era3.push(r.id)
  }

  return { era1, era2, era3 }
}

async function fetchPlayerData(playerId) {
  const [pRes, sRes, aRes] = await Promise.all([
    pool.query('SELECT * FROM players       WHERE id        = $1', [playerId]),
    pool.query('SELECT * FROM player_seasons WHERE player_id = $1 ORDER BY season_year', [playerId]),
    pool.query('SELECT * FROM player_awards  WHERE player_id = $1', [playerId]),
  ])
  return { player: pRes.rows[0], seasons: sRes.rows, awards: aRes.rows }
}

async function generatePlayerPuzzle(name, draftYear) {
  const trimmed = name.trim()
  let res
  if (draftYear) {
    res = await pool.query(
      `SELECT id FROM players WHERE LOWER(name) = LOWER($1) AND draft_year = $2 LIMIT 1`,
      [trimmed, draftYear]
    )
  }
  if (!res || !res.rows.length) {
    res = await pool.query(
      `SELECT id FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [trimmed]
    )
  }
  if (!res.rows.length) throw new Error(`Player not found: ${name}`)
  const { player, seasons, awards } = await fetchPlayerData(res.rows[0].id)
  const puzzle = buildPuzzle(1, player, seasons, awards, Date.now())
  if (!puzzle) throw new Error(`Could not build puzzle for ${name} (insufficient facts)`)
  return puzzle
}

// Daily puzzle cache.
let _cache = null   // { date: 'YYYY-MM-DD', puzzles: [...] }

const EPOCH = new Date('2026-01-01')

async function pickOneFromBucket(bucket, rng, seed, pid, attempted) {
  const shuffled = seededShuffle(bucket, rng)
  for (const id of shuffled) {
    if (attempted.has(id)) continue
    attempted.add(id)
    const { player, seasons, awards } = await fetchPlayerData(id)
    const puzzle = buildPuzzle(pid, player, seasons, awards, seed * 100 + pid)
    if (puzzle) return puzzle
  }
  return null
}

async function getDailyPuzzles() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  if (_cache?.date === today) return _cache.puzzles

  const daySeed = Math.floor((new Date(today) - EPOCH) / 86400000)
  const rng     = seedRng(daySeed)
  const { era1, era2, era3 } = await fetchEligibleIds()

  if (era1.length < 1 || era2.length < 1 || era3.length < 1) {
    throw new Error(`Era buckets too small: ${era1.length}/${era2.length}/${era3.length}`)
  }

  const attempted = new Set()
  const p1 = await pickOneFromBucket(era1, seedRng(daySeed + 1), daySeed, 1, attempted)
  const p2 = await pickOneFromBucket(era2, seedRng(daySeed + 2), daySeed, 2, attempted)
  const p3 = await pickOneFromBucket(era3, seedRng(daySeed + 3), daySeed, 3, attempted)
  const puzzles = [p1, p2, p3].filter(Boolean)

  if (puzzles.length < 3) {
    throw new Error(`Only generated ${puzzles.length}/3 puzzles`)
  }

  _cache = { date: today, puzzles }
  return puzzles
}

// Current-player daily puzzle, one puzzle from the active roster.
let _currentCache = null  // { date: 'YYYY-MM-DD', puzzle: {...} }

async function fetchCurrentPlayerIds() {
  const res = await pool.query(`
    SELECT DISTINCT p.id, p.name
    FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    WHERE ps.season_year = (SELECT MAX(season_year) FROM player_seasons)
  `)

  // Award-only gating excluded notable players with no All-Pro or Pro Bowl selections.
  const statRes = await pool.query(`
    SELECT DISTINCT player_id AS id
    FROM player_seasons
    WHERE player_id = ANY($1::int[])
      AND (
        passing_yards    >= 2000
        OR passing_tds   >= 20
        OR rush_yards    >= 500
        OR receiving_yards >= 500
        OR rec_tds       >= 4
        OR sacks         >= 5
        OR def_ints      >= 3
      )
  `, [res.rows.map(r => r.id)])
  const statQualified = new Set(statRes.rows.map(r => r.id))

  return res.rows
    .filter(r => {
      if (statQualified.has(r.id)) return true
      const awards = lookupAwards(r.name)
      return awards.some(a => a.award === 'ALL_PRO_FIRST' && a.year >= 2021)
          || awards.some(a => a.award === 'PRO_BOWL')
    })
    .map(r => r.id)
}

function todayDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// Durable storage for daily puzzles, since the in-memory cache is lost on every server restart.
async function ensurePuzzleSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS daily_puzzles (
      puzzle_date DATE PRIMARY KEY,
      puzzle      JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)
}

async function buildAndStoreDailyPuzzle(dateStr) {
  const seed      = Math.floor((new Date(dateStr) - EPOCH) / 86400000) + 9999
  const ids       = await fetchCurrentPlayerIds()
  if (!ids.length) throw new Error('No current eligible players found')

  const attempted = new Set()
  const puzzle    = await pickOneFromBucket(ids, seedRng(seed), seed, 1, attempted)
  if (!puzzle) throw new Error('Could not build current player puzzle')

  await pool.query(
    'INSERT INTO daily_puzzles (puzzle_date, puzzle) VALUES ($1, $2) ON CONFLICT (puzzle_date) DO NOTHING',
    [dateStr, puzzle]
  )
  return puzzle
}

// Admin puzzle scheduler

// The same deterministic pick a future date would get by default, computed live.
async function previewDailyPuzzle(dateStr) {
  const seed      = Math.floor((new Date(dateStr) - EPOCH) / 86400000) + 9999
  const ids       = await fetchCurrentPlayerIds()
  if (!ids.length) throw new Error('No current eligible players found')
  const puzzle = await pickOneFromBucket(ids, seedRng(seed), seed, 1, new Set())
  if (!puzzle) throw new Error('Could not build a puzzle for that date')
  return puzzle
}

// A different random candidate for the same date, for the admin to shuffle through.
async function shuffleDailyPuzzle(dateStr) {
  const seed = Date.now()
  const ids  = await fetchCurrentPlayerIds()
  if (!ids.length) throw new Error('No current eligible players found')
  const puzzle = await pickOneFromBucket(ids, seedRng(seed), seed, 1, new Set())
  if (!puzzle) throw new Error('Could not build a puzzle for that date')
  return puzzle
}

// Locks in a puzzle for dateStr, replacing whatever was set before. Future dates only.
async function setScheduledPuzzle(dateStr, puzzle) {
  if (dateStr <= todayDateStr()) throw new Error('Can only schedule a date after today')
  await pool.query(
    `INSERT INTO daily_puzzles (puzzle_date, puzzle) VALUES ($1, $2)
     ON CONFLICT (puzzle_date) DO UPDATE SET puzzle = EXCLUDED.puzzle`,
    [dateStr, puzzle]
  )
}

// Which of a list of dates already have a puzzle locked in.
async function getScheduledDates(dates) {
  const res = await pool.query(
    'SELECT puzzle_date FROM daily_puzzles WHERE puzzle_date = ANY($1::date[])',
    [dates]
  )
  return new Set(res.rows.map(r => r.puzzle_date))
}

// Fetches the eligible pool once and reuses it across every date, instead of re-querying per day.
async function previewUpcomingDates(dates) {
  const ids = await fetchCurrentPlayerIds()
  if (!ids.length) throw new Error('No current eligible players found')

  const scheduled = await getScheduledDates(dates)
  const stored = scheduled.size
    ? await pool.query('SELECT puzzle_date, puzzle FROM daily_puzzles WHERE puzzle_date = ANY($1::date[])', [dates])
    : { rows: [] }
  const storedByDate = new Map(stored.rows.map(r => [r.puzzle_date, r.puzzle]))

  const results = []
  for (const dateStr of dates) {
    if (storedByDate.has(dateStr)) {
      results.push({ date: dateStr, scheduled: true, puzzle: storedByDate.get(dateStr) })
      continue
    }
    try {
      const seed = Math.floor((new Date(dateStr) - EPOCH) / 86400000) + 9999
      const puzzle = await pickOneFromBucket(ids, seedRng(seed), seed, 1, new Set())
      if (!puzzle) throw new Error('no candidate')
      results.push({ date: dateStr, scheduled: false, puzzle })
    } catch {
      results.push({ date: dateStr, scheduled: false, puzzle: null })
    }
  }
  return results
}

async function getDailyCurrentPuzzle(fresh = false) {
  const today = todayDateStr()

  if (fresh) {
    const seed      = Date.now()
    const ids       = await fetchCurrentPlayerIds()
    if (!ids.length) throw new Error('No current eligible players found')
    const attempted = new Set()
    const puzzle    = await pickOneFromBucket(ids, seedRng(seed), seed, 1, attempted)
    if (!puzzle) throw new Error('Could not build current player puzzle')
    return puzzle
  }

  if (_currentCache?.date === today) return _currentCache.puzzle

  const stored = await pool.query('SELECT puzzle FROM daily_puzzles WHERE puzzle_date = $1', [today])
  const puzzle = stored.rows.length ? stored.rows[0].puzzle : await buildAndStoreDailyPuzzle(today)

  _currentCache = { date: today, puzzle }
  return puzzle
}

// Serves a past date's puzzle for the Archive. Never regenerates a missing date.
async function getPuzzleForDate(dateStr) {
  if (dateStr >= todayDateStr()) throw new Error('That date is not available yet')
  const res = await pool.query('SELECT puzzle FROM daily_puzzles WHERE puzzle_date = $1', [dateStr])
  if (!res.rows.length) throw new Error('No puzzle found for that date')
  return res.rows[0].puzzle
}

// Lists every date with a stored daily puzzle, most recent first, no puzzle content included.
async function listArchiveDates(limit = 60) {
  const res = await pool.query('SELECT puzzle_date FROM daily_puzzles ORDER BY puzzle_date DESC LIMIT $1', [limit])
  return res.rows.map(r => r.puzzle_date)
}

async function generateFreshPuzzles() {  const seed = Date.now()
  const { era1, era2, era3 } = await fetchEligibleIds()

  if (era1.length < 1 || era2.length < 1 || era3.length < 1) {
    throw new Error(`Era buckets too small: ${era1.length}/${era2.length}/${era3.length}`)
  }

  const attempted = new Set()
  const p1 = await pickOneFromBucket(era1, seedRng(seed + 1), seed, 1, attempted)
  const p2 = await pickOneFromBucket(era2, seedRng(seed + 2), seed, 2, attempted)
  const p3 = await pickOneFromBucket(era3, seedRng(seed + 3), seed, 3, attempted)
  const puzzles = [p1, p2, p3].filter(Boolean)

  if (puzzles.length < 3) {
    throw new Error(`Only generated ${puzzles.length}/3 puzzles`)
  }

  return puzzles
}

module.exports = {
  getDailyPuzzles, generateFreshPuzzles, generatePlayerPuzzle, getDailyCurrentPuzzle,
  getPuzzleForDate, listArchiveDates, ensurePuzzleSchema, todayDateStr, pool,
  previewDailyPuzzle, shuffleDailyPuzzle, setScheduledPuzzle, getScheduledDates, previewUpcomingDates,
}

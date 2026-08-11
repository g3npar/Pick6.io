'use strict'
// api/puzzle.js — daily puzzle generation from the DB
// ─────────────────────────────────────────────────────────────────────────────
const { Pool } = require('pg')
const fs   = require('fs')
const path = require('path')

// ── Awards CSV — loaded once at startup ──────────────────────────────────────
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
  if (!fs.existsSync(csvPath)) { console.warn('awards.csv not found — CSV facts disabled'); return }
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
  // Exact match only — avoid cross-player contamination from last-name fallback
  return _awardsIdx.get(key) || []
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
})

// ── Seeded pseudo-random (xorshift32-based) ───────────────────────────────────
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

// ── Formatting helpers ────────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

// ── College pool for generating false college facts ───────────────────────────
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

// ── Award display labels ──────────────────────────────────────────────────────
const AWARD_LABELS = {
  OPOY: 'AP Offensive Player of the Year',
  DPOY: 'AP Defensive Player of the Year',
  OROY: 'AP Offensive Rookie of the Year',
  DROY: 'AP Defensive Rookie of the Year',
  CPOY: 'AP Comeback Player of the Year',
}

// ── Fact builders ─────────────────────────────────────────────────────────────
// Each returns { cat, text, makeLie(rng) → { text, explanation } }
// Returns null if the player lacks data for this category.

// Extract the primary (first) college from nfl_data_py's semicolon-separated list
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

function draftFact(p) {
  if (!p.draft_number || !p.draft_year) return null
  return {
    cat: 'draft',
    text: `Was the ${ordinal(p.draft_number)} overall pick in the ${p.draft_year} NFL Draft`,
    makeLie(rng) {
      const delta = 3 + Math.floor(rng() * 12)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(1, p.draft_number + sign * delta)
      return {
        text: `Was the ${ordinal(fake)} overall pick in the ${p.draft_year} NFL Draft`,
        explanation: `${p.name} was actually the ${ordinal(p.draft_number)} overall pick.`,
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
      const delta = 200 + Math.floor(rng() * 600)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(1000, season.passing_yards + sign * delta)
      return {
        text: `Threw for ${fmt(fake)} yards and ${season.passing_tds} touchdowns in the ${season.season_year} season`,
        explanation: `${p.name} threw for ${fmt(season.passing_yards)} yards that season, not ${fmt(fake)}.`,
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
      const delta = 100 + Math.floor(rng() * 300)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(200, season.rush_yards + sign * delta)
      return {
        text: `Rushed for ${fmt(fake)} yards in the ${season.season_year} season`,
        explanation: `${p.name} rushed for ${fmt(season.rush_yards)} yards that season, not ${fmt(fake)}.`,
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
      const delta = 100 + Math.floor(rng() * 350)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(200, season.receiving_yards + sign * delta)
      return {
        text: `Had ${fmt(fake)} receiving yards in the ${season.season_year} season`,
        explanation: `${p.name} had ${fmt(season.receiving_yards)} receiving yards that season, not ${fmt(fake)}.`,
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
      const delta = 2 + Math.floor(rng() * 4)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(1, season.rec_tds + sign * delta)
      return {
        text: `Caught ${fake} receiving touchdowns in the ${season.season_year} season`,
        explanation: `${p.name} caught ${season.rec_tds} receiving touchdowns that season, not ${fake}.`,
      }
    },
  }
}

function sacksFact(p, season) {
  // Only valid for defensive / pass-rush positions; the DB sacks column for
  // offensive players records times sacked, which is not a useful puzzle fact.
  const defPositions = /^(DE|DT|LB|OLB|ILB|MLB|EDGE|NT|DL|LDE|RDE|LE|RE)$/i
  if (!defPositions.test(p.position || '')) return null
  if (!season || !season.sacks || season.sacks < 5) return null
  return {
    cat: 'sacks',
    text: `Recorded ${season.sacks} sacks in the ${season.season_year} season`,
    makeLie(rng) {
      const delta = 2 + Math.floor(rng() * 4)
      const sign  = rng() < 0.5 ? 1 : -1
      const fake  = Math.max(1, season.sacks + sign * delta)
      return {
        text: `Recorded ${fake} sacks in the ${season.season_year} season`,
        explanation: `${p.name} recorded ${season.sacks} sacks that season, not ${fake}.`,
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

// Abbreviation → full team name (used for "PLAYED FOR" display)
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

function playedForFact(p, seasons) {
  const MULTI_TEAM = /^\d+TM$/   // filters out "2TM", "3TM" etc.
  const abbrs = [...new Set(seasons.map(s => s.team).filter(a => a && !MULTI_TEAM.test(a)))]
  if (!abbrs.length) return null
  const names = [...new Set(abbrs.map(a => TEAM_FULL[a] || a).filter(Boolean))].slice(0, 3)
  if (!names.length) return null
  const teamStr = names.join(', ')
  return {
    cat: 'played_for',
    text: `Played for the ${teamStr} during their career`,
    makeLie(rng) {
      // Replace one team with a random wrong team
      const allTeams = Object.values(TEAM_FULL).filter(t => !names.includes(t))
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

// ── CSV-backed fact builders ──────────────────────────────────────────────────

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

// ── Assemble the fact pool for a player ──────────────────────────────────────
function buildFactPool(player, seasons, dbAwards) {
  // CSV awards: Pro Bowl count, HOF, OPOY/DPOY/OROY/DROY/CPOY
  const csvAwards = lookupAwards(player.name)

  const allPro  = seasons.filter(s => s.ap_allpro_first).length
  // CSV Pro Bowl count is more reliable than the DB's pro_bowl column
  const csvPBCount = csvAwards.filter(a => a.award === 'PRO_BOWL').length
  const proBowl    = csvPBCount || seasons.filter(s => s.pro_bowl).length
  const sbWins  = seasons.filter(s => s.super_bowl_winner).length
  const mvpYrs  = seasons.filter(s => s.ap_mvp).map(s => s.season_year)

  // Best single-season performances per category
  const bestPass = [...seasons].filter(s => s.passing_yards  > 0).sort((a, b) => b.passing_yards  - a.passing_yards)[0]
  const bestRush = [...seasons].filter(s => s.rush_yards     > 0).sort((a, b) => b.rush_yards     - a.rush_yards)[0]
  const bestRec  = [...seasons].filter(s => s.receiving_yards > 0).sort((a, b) => b.receiving_yards - a.receiving_yards)[0]
  const bestRTd  = [...seasons].filter(s => s.rec_tds        > 0).sort((a, b) => b.rec_tds        - a.rec_tds)[0]
  const bestSack = [...seasons].filter(s => s.sacks          > 0).sort((a, b) => b.sacks          - a.sacks)[0]

  return [
    collegeFact(player),
    draftFact(player),
    allPro  > 0 ? allProFact(player, allPro)     : null,
    proBowl > 0 ? proBowlFact(player, proBowl)   : null,
    superBowlFact(player, sbWins),
    mvpYrs.length ? mvpFact(player, mvpYrs)       : null,
    passingFact(player, bestPass),
    rushingFact(player, bestRush),
    receivingFact(player, bestRec),
    recTdFact(player, bestRTd),
    sacksFact(player, bestSack),
    heismanFact(player),
    hofFact(player, csvAwards),           // Hall of Fame (CSV)
    csvAwardFact(player, csvAwards),      // OPOY/DPOY/OROY/DROY/CPOY (CSV)
    playedForFact(player, seasons),       // Teams played for
    ...dbAwards.map(a => awardFact(player, a)),
  ].filter(Boolean)
}

// ── Build one puzzle from raw DB data ─────────────────────────────────────────
function buildPuzzle(id, player, seasons, awards, seed) {
  const rng  = seedRng(seed)
  const pool = buildFactPool(player, seasons, awards)
  if (pool.length < 5) return null

  const chosen = seededShuffle(pool, rng).slice(0, 5)
  const lieIdx = Math.floor(rng() * 5)
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
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function fetchEligibleIds() {
  // Fetch all players with at least 3 seasons in the DB
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
    const proBowls = lookupAwards(r.name).filter(a => a.award === 'PRO_BOWL' && a.year > 0)
    if (proBowls.length < 1) continue

    // Use median Pro Bowl year to determine era — works even without historical DB seasons
    const years = proBowls.map(a => a.year).sort((a, b) => a - b)
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

async function generatePlayerPuzzle(name) {
  const res = await pool.query(
    `SELECT id FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name.trim()]
  )
  if (!res.rows.length) throw new Error(`Player not found: ${name}`)
  const { player, seasons, awards } = await fetchPlayerData(res.rows[0].id)
  const puzzle = buildPuzzle(1, player, seasons, awards, Date.now())
  if (!puzzle) throw new Error(`Could not build puzzle for ${name} (insufficient facts)`)
  return puzzle
}

// ── Daily puzzle cache ────────────────────────────────────────────────────────
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
  const today = new Date().toISOString().slice(0, 10)
  if (_cache?.date === today) return _cache.puzzles

  const daySeed = Math.floor((Date.now() - EPOCH) / 86400000)
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

async function generateFreshPuzzles() {
  const seed = Date.now()
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

module.exports = { getDailyPuzzles, generateFreshPuzzles, generatePlayerPuzzle }

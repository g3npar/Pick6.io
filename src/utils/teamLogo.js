// Maps canonical team names (and historical aliases) -> /logos/*.png URL
const TEAM_SLUG = {
  'Arizona Cardinals':        'arizona-cardinals',
  'Atlanta Falcons':          'atlanta-falcons',
  'Baltimore Ravens':         'baltimore-ravens',
  'Buffalo Bills':            'buffalo-bills',
  'Carolina Panthers':        'carolina-panthers',
  'Chicago Bears':            'chicago-bears',
  'Cincinnati Bengals':       'cincinnati-bengals',
  'Cleveland Browns':         'cleveland-browns',
  'Dallas Cowboys':           'dallas-cowboys',
  'Denver Broncos':           'denver-broncos',
  'Detroit Lions':            'detroit-lions',
  'Green Bay Packers':        'green-bay-packers',
  'Houston Texans':           'houston-texans',
  'Indianapolis Colts':       'indianapolis-colts',
  'Jacksonville Jaguars':     'jacksonville-jaguars',
  'Kansas City Chiefs':       'kansas-city-chiefs',
  'Las Vegas Raiders':        'las-vegas-raiders',
  'Los Angeles Chargers':     'los-angeles-chargers',
  'Los Angeles Rams':         'los-angeles-rams',
  'Miami Dolphins':           'miami-dolphins',
  'Minnesota Vikings':        'minnesota-vikings',
  'New England Patriots':     'new-england-patriots',
  'New Orleans Saints':       'new-orleans-saints',
  'New York Giants':          'new-york-giants',
  'New York Jets':            'new-york-jets',
  'Philadelphia Eagles':      'philadelphia-eagles',
  'Pittsburgh Steelers':      'pittsburgh-steelers',
  'San Francisco 49ers':      'san-francisco-49ers',
  'Seattle Seahawks':         'seattle-seahawks',
  'Tampa Bay Buccaneers':     'tampa-bay-buccaneers',
  'Tennessee Titans':         'tennessee-titans',
  'Washington Commanders':    'washington-commanders',
  // Historical aliases
  'Oakland Raiders':          'las-vegas-raiders',
  'San Diego Chargers':       'los-angeles-chargers',
  'St. Louis Rams':           'los-angeles-rams',
  'Baltimore Colts':          'indianapolis-colts',
  'Washington Redskins':      'washington-commanders',
  'Washington Football Team': 'washington-commanders',
  'Tennessee Oilers':         'tennessee-titans',
  'Houston Oilers':           'tennessee-titans',
  // Conferences
  'AFC':                      'afc',
  'NFC':                      'nfc',
}

/**
 * Returns the absolute URL path to a team's logo PNG, or null if not found
 * @param {string} teamName - Canonical or historical team name
 */
export function teamLogo(teamName) {
  const slug = TEAM_SLUG[teamName]
  return slug ? `/logos/nfl/${slug}.png` : null
}

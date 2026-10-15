// the 32 teams you can guess in Film Room, by today's name
// keys match api/filmroom.js, relocated teams count as the same franchise
export const FRANCHISES = [
  { key: 'ARI', name: 'Arizona Cardinals' },
  { key: 'ATL', name: 'Atlanta Falcons' },
  { key: 'BAL', name: 'Baltimore Ravens' },
  { key: 'BUF', name: 'Buffalo Bills' },
  { key: 'CAR', name: 'Carolina Panthers' },
  { key: 'CHI', name: 'Chicago Bears' },
  { key: 'CIN', name: 'Cincinnati Bengals' },
  { key: 'CLE', name: 'Cleveland Browns' },
  { key: 'DAL', name: 'Dallas Cowboys' },
  { key: 'DEN', name: 'Denver Broncos' },
  { key: 'DET', name: 'Detroit Lions' },
  { key: 'GB',  name: 'Green Bay Packers' },
  { key: 'HOU', name: 'Houston Texans' },
  { key: 'IND', name: 'Indianapolis Colts' },
  { key: 'JAX', name: 'Jacksonville Jaguars' },
  { key: 'KC',  name: 'Kansas City Chiefs' },
  { key: 'LV',  name: 'Las Vegas Raiders' },
  { key: 'LAC', name: 'Los Angeles Chargers' },
  { key: 'LA',  name: 'Los Angeles Rams' },
  { key: 'MIA', name: 'Miami Dolphins' },
  { key: 'MIN', name: 'Minnesota Vikings' },
  { key: 'NE',  name: 'New England Patriots' },
  { key: 'NO',  name: 'New Orleans Saints' },
  { key: 'NYG', name: 'New York Giants' },
  { key: 'NYJ', name: 'New York Jets' },
  { key: 'PHI', name: 'Philadelphia Eagles' },
  { key: 'PIT', name: 'Pittsburgh Steelers' },
  { key: 'SF',  name: 'San Francisco 49ers' },
  { key: 'SEA', name: 'Seattle Seahawks' },
  { key: 'TB',  name: 'Tampa Bay Buccaneers' },
  { key: 'TEN', name: 'Tennessee Titans' },
  { key: 'WAS', name: 'Washington Commanders' },
]

export const franchiseName = key => FRANCHISES.find(f => f.key === key)?.name ?? key

// current alignment, so the picker reads like a standings page
export const DIVISIONS = [
  { conf: 'AFC', name: 'East',  teams: ['BUF', 'MIA', 'NE', 'NYJ'] },
  { conf: 'AFC', name: 'North', teams: ['BAL', 'CIN', 'CLE', 'PIT'] },
  { conf: 'AFC', name: 'South', teams: ['HOU', 'IND', 'JAX', 'TEN'] },
  { conf: 'AFC', name: 'West',  teams: ['DEN', 'KC', 'LV', 'LAC'] },
  { conf: 'NFC', name: 'East',  teams: ['DAL', 'NYG', 'PHI', 'WAS'] },
  { conf: 'NFC', name: 'North', teams: ['CHI', 'DET', 'GB', 'MIN'] },
  { conf: 'NFC', name: 'South', teams: ['ATL', 'CAR', 'NO', 'TB'] },
  { conf: 'NFC', name: 'West',  teams: ['ARI', 'LA', 'SF', 'SEA'] },
]

export const nickname = key => franchiseName(key).split(' ').pop()

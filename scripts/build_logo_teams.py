"""
Builds api/data/logo_teams.json and downloads each team's SVG logo, for Logo Lineup.
Every NFL, NBA, MLB and NHL team plus Power 4 and Notre Dame. Existing logos are skipped.

Run: python3 scripts/build_logo_teams.py
"""

import json
import os
import re
import unicodedata
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT_JSON = os.path.join(ROOT, 'api', 'data', 'logo_teams.json')
OUT_LOGOS = os.path.join(ROOT, 'public', 'logos', 'leagues')

ESPN = 'https://site.api.espn.com/apis/site/v2/sports/{}/teams?limit=1000'
LEAGUES = {
    'nfl':  'football/nfl',
    'nba':  'basketball/nba',
    'mlb':  'baseball/mlb',
    'nhl':  'hockey/nhl',
    'ncaa': 'football/college-football',
}

# college pool, by ESPN's "location"
POWER_4 = {
    'ACC':     ['Boston College', 'California', 'Clemson', 'Duke', 'Florida State', 'Georgia Tech', 'Louisville',
                'Miami', 'NC State', 'North Carolina', 'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia',
                'Virginia Tech', 'Wake Forest'],
    'Big Ten': ['Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State', 'Minnesota', 'Nebraska',
                'Northwestern', 'Ohio State', 'Oregon', 'Penn State', 'Purdue', 'Rutgers', 'UCLA', 'USC',
                'Washington', 'Wisconsin'],
    'Big 12':  ['Arizona', 'Arizona State', 'Baylor', 'BYU', 'Cincinnati', 'Colorado', 'Houston', 'Iowa State',
                'Kansas', 'Kansas State', 'Oklahoma State', 'TCU', 'Texas Tech', 'UCF', 'Utah', 'West Virginia'],
    'SEC':     ['Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU', 'Mississippi State',
                'Missouri', 'Oklahoma', 'Ole Miss', 'South Carolina', 'Tennessee', 'Texas', 'Texas A&M',
                'Vanderbilt'],
    'Independent': ['Notre Dame'],
}
COLLEGES = {school for schools in POWER_4.values() for school in schools}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (pick6.io data script)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# map ESPN teams to each league's own ids
NFL_CODES = {'wsh': 'WAS', 'lar': 'LA'}   # the rest are ESPN's abbreviation in capitals
NBA_IDS = {
    'atl': 37, 'bos': 38, 'cle': 39, 'no': 40, 'chi': 41, 'dal': 42, 'den': 43, 'gs': 44, 'hou': 45, 'lac': 46,
    'lal': 47, 'mia': 48, 'mil': 49, 'min': 50, 'bkn': 51, 'ny': 52, 'orl': 53, 'ind': 54, 'phi': 55, 'phx': 56,
    'por': 57, 'sac': 58, 'sa': 59, 'okc': 60, 'tor': 61, 'utah': 62, 'mem': 63, 'wsh': 64, 'det': 65, 'cha': 66,
}
NCAA_SLUGS = {'Miami': 'miami-fl', 'USC': 'southern-california', 'Ole Miss': 'ole-miss', 'NC State': 'north-carolina-st'}


def plain(name):
    # the NHL writes "Montréal", ESPN doesn't
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower())


def svg_sources():
    mlb = {t['name']: t['id'] for t in json.loads(get('https://statsapi.mlb.com/api/v1/teams?sportId=1'))['teams']}
    nhl = {plain(t['fullName']): t['triCode'] for t in json.loads(get('https://api.nhle.com/stats/rest/en/team'))['data']}
    ncaa = {s['name']: s['slug'] for s in json.loads(get('https://www.ncaa.com/json/schools')) if s.get('name')}

    def url(league, team_id, t):
        if league == 'nfl':
            return f"https://static.www.nfl.com/league/api/clubs/logos/{NFL_CODES.get(team_id, team_id.upper())}.svg"
        if league == 'nba':
            return f'https://cdn.nba.com/logos/nba/16106127{NBA_IDS[team_id]:02d}/primary/L/logo.svg'
        if league == 'mlb':
            return f"https://www.mlbstatic.com/team-logos/{mlb[t['displayName']]}.svg"
        if league == 'nhl':
            return f"https://assets.nhle.com/logos/nhl/svg/{nhl[plain(t['displayName'])]}_light.svg"
        loc = t['location']
        # ncaa.com writes "Ohio St." for Ohio State
        slug = NCAA_SLUGS.get(loc) or ncaa.get(loc) or ncaa[loc.replace(' State', ' St.')]
        return f'https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/{slug}.svg'
    return url


def save_svg(url, path):
    data = get(url)
    # must be a real vector
    if b'<svg' not in data[:2000] or b'<image' in data:
        raise SystemExit(f'not a usable svg: {url}')
    with open(path, 'wb') as f:
        f.write(data)


svg_url = svg_sources()
teams = []
for league, path in LEAGUES.items():
    print(f'── {league} ──')
    data = json.loads(get(ESPN.format(path)))
    seen = set()
    for entry in data['sports'][0]['leagues'][0]['teams']:
        t = entry['team']
        if league == 'ncaa' and t.get('location') not in COLLEGES:
            continue
        if t['id'] in seen:
            continue
        seen.add(t['id'])
        team_id = t['abbreviation'].lower().replace('&', '')
        os.makedirs(os.path.join(OUT_LOGOS, league), exist_ok=True)
        file = os.path.join(OUT_LOGOS, league, f'{team_id}.svg')
        if not os.path.exists(file):
            save_svg(svg_url(league, team_id, t), file)
            time.sleep(0.25)
        teams.append({
            'league': league,
            'id': team_id,
            'name': t['displayName'],
            'nickname': t.get('name') or t['displayName'],
            'logo': f'{league}/{team_id}.svg',
        })

# catch schools ESPN renamed
found = sum(t['league'] == 'ncaa' for t in teams)
if found != len(COLLEGES):
    raise SystemExit(f'only matched {found} of {len(COLLEGES)} colleges, check POWER_4 against ESPN')

with open(OUT_JSON, 'w') as f:
    json.dump(teams, f, indent=1)

counts = {lg: sum(t['league'] == lg for t in teams) for lg in LEAGUES}
print(f'  {len(teams)} teams {counts}')
print(f'  wrote {os.path.relpath(OUT_JSON)}')

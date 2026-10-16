"""
Builds api/data/team_seasons.json, Film Room's answer data: one row per team per season.
Only needs rerunning to add a season (bump LAST_SEASON).

Run: python3 scripts/build_team_seasons.py
"""

import collections
import json
import os

import nfl_data_py as nfl
import nflreadpy
import pandas as pd

FIRST_SEASON = 2002   # current 32 team / 8 division setup, and where nflverse standings start
LAST_SEASON  = 2025   # last finished season, bump this after each Super Bowl
YEARS = list(range(FIRST_SEASON, LAST_SEASON + 1))

# nfl_data_py's weekly stats stop at 2024, later seasons come from nflreadpy
NFLDATAPY_MAX_SEASON = 2024

# official division finish and playoff seed, tiebreakers already applied
STANDINGS_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/standings.csv'

OUT = os.path.join(os.path.dirname(__file__), '..', 'api', 'data', 'team_seasons.json')

# schedules use the abbreviation from that era, weekly stats use today's
FRANCHISE = {'STL': 'LA', 'SD': 'LAC', 'OAK': 'LV'}

NAMES = {
    'ARI': 'Arizona Cardinals',    'ATL': 'Atlanta Falcons',      'BAL': 'Baltimore Ravens',
    'BUF': 'Buffalo Bills',        'CAR': 'Carolina Panthers',    'CHI': 'Chicago Bears',
    'CIN': 'Cincinnati Bengals',   'CLE': 'Cleveland Browns',     'DAL': 'Dallas Cowboys',
    'DEN': 'Denver Broncos',       'DET': 'Detroit Lions',        'GB':  'Green Bay Packers',
    'HOU': 'Houston Texans',       'IND': 'Indianapolis Colts',   'JAX': 'Jacksonville Jaguars',
    'KC':  'Kansas City Chiefs',   'LA':  'Los Angeles Rams',     'LAC': 'Los Angeles Chargers',
    'LV':  'Las Vegas Raiders',    'MIA': 'Miami Dolphins',       'MIN': 'Minnesota Vikings',
    'NE':  'New England Patriots', 'NO':  'New Orleans Saints',   'NYG': 'New York Giants',
    'NYJ': 'New York Jets',        'OAK': 'Oakland Raiders',      'PHI': 'Philadelphia Eagles',
    'PIT': 'Pittsburgh Steelers',  'SD':  'San Diego Chargers',   'SEA': 'Seattle Seahawks',
    'SF':  'San Francisco 49ers',  'STL': 'St. Louis Rams',       'TB':  'Tampa Bay Buccaneers',
    'TEN': 'Tennessee Titans',
}


def team_name(abbr, season):
    # the pre-2020 name was retired, so those seasons just say Washington
    if abbr == 'WAS':
        if season <= 2019:
            return 'Washington'
        return 'Washington Football Team' if season <= 2021 else 'Washington Commanders'
    return NAMES[abbr]


# first season of each logo (from 2002), images in public/logos/nfl/eras/{TEAM}-{year}.webp.
# Washington before 2020 has no logo on purpose
LOGO_ERAS = {
    'ARI': [2002, 2005],             'ATL': [2002, 2003],             'BAL': [2002],
    'BUF': [2002],                   'CAR': [2002, 2012],             'CHI': [2002, 2023],
    'CIN': [2002, 2004, 2021],       'CLE': [2002, 2006, 2007, 2015, 2024],
    'DAL': [2002],                   'DEN': [2002],                   'DET': [2002, 2003, 2009, 2017],
    'GB':  [2002],                   'HOU': [2002, 2024],             'IND': [2002, 2004],
    'JAX': [2002, 2013],             'KC':  [2002],                   'LA':  [2002, 2016, 2017, 2020],
    'LAC': [2002, 2007, 2017, 2020], 'LV':  [2002, 2020],             'MIA': [2002, 2013, 2018],
    'MIN': [2002, 2010, 2013],       'NE':  [2002],                   'NO':  [2002, 2012, 2017],
    'NYG': [2002],                   'NYJ': [2002, 2019, 2024],       'PHI': [2002],
    'PIT': [2002],                   'SEA': [2002, 2009, 2012],       'SF':  [2002, 2005, 2009],
    'TB':  [2002, 2014, 2020],       'TEN': [2002],                   'WAS': [2020, 2022],
}


def era_logo(franchise, season):
    years = [y for y in LOGO_ERAS[franchise] if y <= season]
    return f'{franchise}-{max(years)}' if years else None


PLAYOFFS = {
    'WC':  'Lost Wild Card',
    'DIV': 'Lost Divisional',
    'CON': 'Lost Conf. Championship',
    'SB':  'Lost Super Bowl',
}

print("── Fetching schedules and weekly stats ──")
sched  = nfl.import_schedules(YEARS)
WEEKLY_COLS = ['player_id', 'player_display_name', 'recent_team', 'season', 'season_type', 'rushing_yards', 'receiving_yards']
weekly = nfl.import_weekly_data([y for y in YEARS if y <= NFLDATAPY_MAX_SEASON], columns=WEEKLY_COLS)
newer = [y for y in YEARS if y > NFLDATAPY_MAX_SEASON]
if newer:
    # same shape, nflreadpy just calls the team column "team"
    recent = nflreadpy.load_player_stats(seasons=newer).to_pandas().rename(columns={'team': 'recent_team'})
    weekly = pd.concat([weekly, recent[WEEKLY_COLS]], ignore_index=True)
weekly = weekly[weekly['season_type'] == 'REG']

# leading receiver / rusher per franchise-season, regular season only
leaders = {}
for col in ('receiving_yards', 'rushing_yards'):
    # on a tie, fewer games wins
    totals = (
        weekly.groupby(['season', 'recent_team', 'player_id', 'player_display_name'])
        .agg(yards=(col, 'sum'), games=(col, 'size')).reset_index()
        .rename(columns={'yards': col})
        .sort_values([col, 'games', 'player_display_name'], ascending=[False, True, True])
        .drop_duplicates(['season', 'recent_team'])
    )
    leaders[col] = {
        (int(r['season']), r['recent_team']): (r['player_display_name'], int(r[col]), r['player_id'])
        for _, r in totals.iterrows()
    }

standings = pd.read_csv(STANDINGS_URL)
standings = {
    (int(r['season']), r['team']): (int(r['div_rank']), int(r['seed']) if pd.notna(r['seed']) else None)
    for _, r in standings.iterrows()
}

print("── Building team seasons ──")
rows = []
for season in YEARS:
    games = sched[(sched['season'] == season) & sched['home_score'].notna()]
    record  = collections.defaultdict(lambda: [0, 0, 0])
    coaches = collections.defaultdict(collections.Counter)
    qbs     = collections.defaultdict(collections.Counter)
    playoff = {}

    for _, g in games.iterrows():
        sides = (
            (g['home_team'], g['home_score'], g['away_score'], g['home_coach'], (g['home_qb_id'], g['home_qb_name'])),
            (g['away_team'], g['away_score'], g['home_score'], g['away_coach'], (g['away_qb_id'], g['away_qb_name'])),
        )
        if g['game_type'] == 'REG':
            for team, scored, allowed, coach, qb in sides:
                record[team][0 if scored > allowed else 1 if scored < allowed else 2] += 1
                coaches[team][coach] += 1
                # most regular-season starts
                if isinstance(qb[0], str):
                    qbs[team][qb] += 1
        else:
            winner, loser = (g['home_team'], g['away_team']) if g['home_score'] > g['away_score'] \
                else (g['away_team'], g['home_team'])
            playoff[loser] = PLAYOFFS[g['game_type']]
            if g['game_type'] == 'SB':
                playoff[winner] = 'Won Super Bowl'

    for team, (w, l, t) in record.items():
        franchise = FRANCHISE.get(team, team)
        wr = leaders['receiving_yards'].get((season, franchise))
        rb = leaders['rushing_yards'].get((season, franchise))
        qb = qbs[team].most_common(1)[0][0] if qbs[team] else None
        rows.append({
            'season': season,
            'franchise': franchise,
            'name': team_name(team, season),
            'logo': era_logo(franchise, season),
            'wins': w, 'losses': l, 'ties': t,
            # seed only exists for playoff teams
            'divRank': standings[(season, team)][0], 'seed': standings[(season, team)][1],
            'playoffs': playoff.get(team, 'Missed Playoffs'),
            'coach': coaches[team].most_common(1)[0][0],
            'qb': qb[1] if qb else None,
            'topReceiver': wr[0] if wr else None, 'topReceiverYards': wr[1] if wr else None,
            'topRusher': rb[0] if rb else None,   'topRusherYards': rb[1] if rb else None,
        })

rows.sort(key=lambda r: (r['season'], r['franchise']))
missing = sum(1 for r in rows if not all([r['coach'], r['qb'], r['topReceiver'], r['topRusher']]))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(rows, f, separators=(',', ':'))

print(f"  {len(rows)} team seasons ({FIRST_SEASON}–{LAST_SEASON}), {missing} missing a clue")
print(f"  wrote {os.path.relpath(OUT)}")

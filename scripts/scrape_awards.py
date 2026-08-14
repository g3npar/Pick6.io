"""
Scrapes footballdb.com and Wikipedia for NFL award data and writes public/awards.csv.

Columns: player, award, year, team, position

Awards collected:
  MVP, OPOY, DPOY, OROY, DROY, CPOY, ALL_PRO_FIRST, HOF  - footballdb.com
  PRO_BOWL                                               - Wikipedia (footballdb has no Pro Bowl data)

A Pro Bowl honoring <season_year> is played the following January/February and
titled accordingly on Wikipedia (e.g. the 2022-season game is "2023 Pro Bowl").
1997, 1998, and 2013-2015 use one-off page layouts and are skipped.

Usage:
  python3 scripts/scrape_awards.py
"""

import re, time, csv, os
import requests
from bs4 import BeautifulSoup

BASE      = 'https://www.footballdb.com'
WIKI_BASE = 'https://en.wikipedia.org/wiki'
HEADERS   = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
DELAY     = 0.6
START     = 1980
END       = 2025

rows = []

def get(url):
    resp = requests.get(url, headers=HEADERS, timeout=15)
    time.sleep(DELAY)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return BeautifulSoup(resp.text, 'html.parser')

INDIVIDUAL_SLUGS = {
    'ap-nfl-most-valuable-player':         'MVP',
    'ap-nfl-offensive-player-of-the-year': 'OPOY',
    'ap-nfl-defensive-player-of-the-year': 'DPOY',
    'ap-nfl-offensive-rookie-of-the-year': 'OROY',
    'ap-nfl-defensive-rookie-of-the-year': 'DROY',
    'ap-nfl-comeback-player-of-the-year':  'CPOY',
}

def scrape_individual(year):
    soup = get(f'{BASE}/awards/index.html?lg=NFL&yr={year}')
    if not soup:
        return
    for tr in soup.select('table.statistics tr'):
        award_a  = tr.select_one('td:first-child a')
        player_a = tr.select_one('td:nth-child(2) a[href^="/players/"]')
        if not award_a or not player_a:
            continue
        href = award_a.get('href', '')
        slug = href.removeprefix('/awards/').rstrip('/')
        award_type = INDIVIDUAL_SLUGS.get(slug)
        if not award_type:
            continue
        cells = tr.select('td')
        pos  = cells[2].get_text(strip=True) if len(cells) > 2 else ''
        team = cells[3].get_text(strip=True) if len(cells) > 3 else ''
        rows.append((player_a.get_text(strip=True), award_type, year, team, pos))

def scrape_allpro(year):
    soup = get(f'{BASE}/awards/ap-nfl-all-pro-team/{year}')
    if not soup:
        return
    in_first = False
    for tag in soup.find_all(['div', 'h2', 'h3', 'tr']):
        if tag.name in ('div', 'h2', 'h3'):
            text = tag.get_text(strip=True)
            if 'Second Team' in text or 'Second-Team' in text:
                in_first = False
            elif 'First Team' in text or 'First-Team' in text:
                in_first = True
        if tag.name == 'tr' and in_first:
            cells = tag.select('td')
            if len(cells) < 2:
                continue
            player_a = cells[1].select_one('a[href^="/players/"]')
            if not player_a:
                continue
            pos = cells[0].get_text(strip=True)
            rows.append((player_a.get_text(strip=True), 'ALL_PRO_FIRST', year, '', pos))

def scrape_hof():
    soup = get(f'{BASE}/awards/pro-football-hall-of-fame')
    if not soup:
        return
    current_year = None
    for tr in soup.select('table.statistics tr'):
        cells = tr.select('td')
        if not cells:
            continue
        yr_match = re.search(r'(19|20)\d{2}', cells[0].get_text(strip=True))
        if yr_match:
            current_year = int(yr_match.group())
        if not current_year or current_year < START:
            continue
        player_a = cells[1].select_one('a[href^="/players/"]') if len(cells) > 1 else None
        if not player_a:
            continue
        if len(cells) > 2 and cells[2].get_text(strip=True) != 'Player':
            continue
        pos = cells[3].get_text(strip=True) if len(cells) > 3 else ''
        rows.append((player_a.get_text(strip=True), 'HOF', current_year, '', pos))

# ── Pro Bowl (Wikipedia) ──────────────────────────────────────────────────────
# A link's title is the player's full name, or a team/season page name — used
# to tell player links from team links in the roster tables below.
PROBOWL_TEAM_TITLES = {
    'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills',
    'Carolina Panthers', 'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns',
    'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers',
    'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Kansas City Chiefs',
    'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins',
    'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants',
    'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers',
    'Seattle Seahawks', 'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders',
    # Historical franchise names within the 1980–2025 window
    'Oakland Raiders', 'Los Angeles Raiders', 'San Diego Chargers', 'St. Louis Rams',
    'Washington Redskins', 'Washington Football Team', 'Houston Oilers', 'Tennessee Oilers',
    'Phoenix Cardinals', 'St. Louis Cardinals', 'Baltimore Colts', 'Boston Patriots',
}
PROBOWL_SEASON_RE = re.compile(r'^\d{4}(–\d{2,4})? .+ season$')

def _is_probowl_team_link(title):
    if not title:
        return True
    return title in PROBOWL_TEAM_TITLES or bool(PROBOWL_SEASON_RE.match(title))

def scrape_probowl(season_year):
    game_year = season_year + 1
    soup = get(f'{WIKI_BASE}/{game_year}_Pro_Bowl')
    if not soup:
        return
    roster_heads = [
        h for h in soup.find_all(['h2', 'h3'])
        if h.get('id') and re.search(r'roster', h.get('id'), re.I)
    ]
    if not roster_heads:
        return

    # Some mid-90s pages use a <table class="col-begin"> column layout instead
    # of a wikitable — every selection is a plain link, no starter/reserve split.
    for tbl in roster_heads[0].find_all_next('table', class_='col-begin', limit=1):
        for p in tbl.find_all('p'):
            for a in p.find_all('a'):
                if _is_probowl_team_link(a.get('title')):
                    continue
                name = a.get_text(strip=True)
                if name:
                    rows.append((name, 'PRO_BOWL', season_year, '', ''))
        return

    boundary = soup.find(['h2', 'h3'], id=re.compile(r'Number_of_selections|^References$'))
    for tbl in roster_heads[0].find_all_next('table', class_='wikitable'):
        if boundary and tbl.sourceline and boundary.sourceline and tbl.sourceline > boundary.sourceline:
            break
        trs = tbl.find_all('tr')
        if not trs:
            continue
        header = [c.get_text(strip=True).lower() for c in trs[0].find_all(['th', 'td'])]
        if not header or 'position' not in header[0]:
            continue
        # Alternate(s) only played if someone dropped out, so only count Starter(s)/Reserve(s)
        col_idx = [i for i, h in enumerate(header) if 'starter' in h or 'reserve' in h]
        if not col_idx:
            continue
        for tr in trs[1:]:
            cells = tr.find_all(['th', 'td'])
            if not cells:
                continue
            pos = cells[0].get_text(strip=True)
            if not pos:
                continue
            for ci in col_idx:
                if ci >= len(cells):
                    continue
                for a in cells[ci].find_all('a'):
                    if a.get('href', '').startswith('#'):
                        continue
                    if _is_probowl_team_link(a.get('title')):
                        continue
                    name = a.get_text(strip=True)
                    if name:
                        rows.append((name, 'PRO_BOWL', season_year, '', pos))

print(f'Scraping footballdb.com awards {START}–{END}...')

print('  Hall of Fame...')
scrape_hof()
print(f'    {len(rows)} rows')

for year in range(START, END + 1):
    print(f'  {year}...', end=' ', flush=True)
    before = len(rows)
    scrape_individual(year)
    scrape_allpro(year)
    print(f'+{len(rows) - before}')

print(f'\nScraping Wikipedia Pro Bowl rosters {START}–{END}...')
for year in range(START, END + 1):
    print(f'  {year}...', end=' ', flush=True)
    before = len(rows)
    scrape_probowl(year)
    print(f'+{len(rows) - before}')

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'awards.csv')
seen = set()
deduped = []
for r in rows:
    key = (r[0], r[1], r[2])
    if key not in seen:
        seen.add(key)
        deduped.append(r)

with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['player', 'award', 'year', 'team', 'position'])
    w.writerows(deduped)

from collections import Counter
counts = Counter(r[1] for r in deduped)
print(f'\nWrote {len(deduped)} rows to {out}')
for award, n in sorted(counts.items()):
    print(f'  {award}: {n}')

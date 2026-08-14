"""
Scrapes footballdb.com for NFL award data and writes public/awards.csv.

Columns: player, award, year, team, position

Awards collected:
  MVP           - AP NFL Most Valuable Player
  OPOY          - AP Offensive Player of the Year
  DPOY          - AP Defensive Player of the Year
  OROY          - AP Offensive Rookie of the Year
  DROY          - AP Defensive Rookie of the Year
  CPOY          - AP Comeback Player of the Year
  ALL_PRO_FIRST - AP First-Team All-Pro (per year)
  HOF           - Pro Football Hall of Fame inductees (players only)

Note: Pro Bowl data is not available on footballdb.com; the game falls back to
the pro_bowl column in player_seasons (populated via nfl_data_py.import_awards).

Usage:
  python3 scripts/scrape_awards.py
"""

import re, time, csv, os
import requests
from bs4 import BeautifulSoup

BASE    = 'https://www.footballdb.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
DELAY   = 0.6
START   = 1980
END     = 2025

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

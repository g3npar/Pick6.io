"""
Scrapes Wikipedia for NFL award data and writes awards.csv.

Columns: player, award, year, team, position

Awards collected:
  HOF           — Pro Football Hall of Fame inductees
  MVP           — AP NFL Most Valuable Player
  OPOY          — AP Offensive Player of the Year
  DPOY          — AP Defensive Player of the Year
  OROY          — AP Offensive Rookie of the Year
  DROY          — AP Defensive Rookie of the Year
  CPOY          — AP Comeback Player of the Year
  ALL_PRO_FIRST — AP First-Team All-Pro (per year, 1970–2025)
  PRO_BOWL      — Pro Bowl selections (per year, 1999–2025)

Usage:
  python3 scripts/scrape_awards.py
"""

import re
import time
import requests
import pandas as pd
from bs4 import BeautifulSoup

HEADERS = {'User-Agent': 'nfl-puzzle-research/1.0 (educational, non-commercial)'}
DELAY   = 0.8   # seconds between requests

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_soup(url):
    resp = requests.get(url, headers=HEADERS, timeout=15)
    time.sleep(DELAY)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return BeautifulSoup(resp.text, 'html.parser')

def clean(s):
    if not isinstance(s, str):
        s = str(s)
    # Remove Wikipedia footnote markers, citation numbers, special chars
    s = re.sub(r'\[[\w\s\d]+\]|\*+|†|‡|♦|\u2020|\u2021', '', s)
    # Remove trailing superscript-style markers
    s = re.sub(r'\s*\(\d+\)', '', s)
    return s.strip()

def split_names(raw):
    """
    Some Wikipedia cells merge co-winners: 'Brett Favre Barry Sanders'.
    Split on known name boundaries (capital letter after space after non-initial word).
    Simple heuristic: split on two consecutive Title Case words that look like
    separate names — we detect this by checking for known patterns.
    Returns a list of cleaned name strings.
    """
    cleaned = clean(raw)
    # If it contains a newline, split on that
    if '\n' in cleaned:
        return [p.strip() for p in cleaned.split('\n') if p.strip()]
    return [cleaned]

def extract_year(s):
    m = re.search(r'(19|20)\d{2}', str(s))
    return m.group() if m else None

def is_junk(name):
    if not name or len(name) < 2:
        return True
    lower = name.lower()
    return lower in {'player', 'name', 'winner', 'nan', 'inductee', 'no.', '#'}

def parse_wikitable(table):
    """
    Parse a <table class='wikitable'> into a list of row dicts.
    Handles rowspan carry-forward so multi-row season/team cells are filled in.
    """
    all_rows = table.find_all('tr')
    if not all_rows:
        return []

    # Find header row
    headers = []
    data_start = 0
    for i, tr in enumerate(all_rows):
        ths = tr.find_all('th')
        if ths and len(ths) > 1:
            headers = [clean(th.get_text(' ', strip=True)) for th in ths]
            data_start = i + 1
            break

    results = []
    carry = {}  # col_idx → (remaining_rowspan, value)

    for tr in all_rows[data_start:]:
        cells = tr.find_all(['td', 'th'])
        if not cells:
            continue

        row_data = {}
        cell_idx = 0
        max_col = max(len(headers) if headers else 0,
                      len(cells) + len(carry), 10)

        for col in range(max_col):
            if col in carry and carry[col][0] > 0:
                row_data[col] = carry[col][1]
                carry[col] = (carry[col][0] - 1, carry[col][1])
                if carry[col][0] == 0:
                    del carry[col]
            elif cell_idx < len(cells):
                cell = cells[cell_idx]
                val  = clean(cell.get_text(' ', strip=True))
                rs   = cell.get('rowspan', '1')
                rs   = int(re.sub(r'[^\d]', '', rs) or 1)
                if rs > 1:
                    carry[col] = (rs - 1, val)
                row_data[col] = val
                cell_idx += 1
            else:
                break

        if headers:
            row_dict = {headers[i]: row_data.get(i, '')
                        for i in range(min(len(headers), max_col))}
        else:
            row_dict = {str(i): v for i, v in row_data.items()}

        results.append(row_dict)

    return results

def get_wikitables(url):
    """Return list of parsed wikitables (each is a list of row dicts)."""
    soup = get_soup(url)
    if not soup:
        return []
    tables = soup.find_all('table', class_=re.compile(r'wikitable'))
    return [parse_wikitable(t) for t in tables if t]

def find_key(d, *keywords):
    """Return value from dict for first key matching any keyword (case-insensitive)."""
    for kw in keywords:
        for k, v in d.items():
            if kw in k.lower():
                return v
    return ''

# ── Collect rows ──────────────────────────────────────────────────────────────
rows = []

def add(player, award, year, team='', position=''):
    p = clean(str(player))
    if not is_junk(p):
        rows.append({'player': p, 'award': award, 'year': str(year),
                     'team': clean(str(team)), 'position': clean(str(position))})

# ─────────────────────────────────────────────────────────────────────────────
# 1. Individual AP award winner pages
# ─────────────────────────────────────────────────────────────────────────────
AWARD_PAGES = [
    ('MVP',  'https://en.wikipedia.org/wiki/AP_NFL_Most_Valuable_Player'),
    ('OPOY', 'https://en.wikipedia.org/wiki/AP_NFL_Offensive_Player_of_the_Year_Award'),
    ('DPOY', 'https://en.wikipedia.org/wiki/AP_NFL_Defensive_Player_of_the_Year_Award'),
    ('OROY', 'https://en.wikipedia.org/wiki/AP_NFL_Offensive_Rookie_of_the_Year_Award'),
    ('DROY', 'https://en.wikipedia.org/wiki/AP_NFL_Defensive_Rookie_of_the_Year_Award'),
    ('CPOY', 'https://en.wikipedia.org/wiki/AP_NFL_Comeback_Player_of_the_Year_Award'),
]

print("── Award winner pages ──")
for award, url in AWARD_PAGES:
    print(f"  {award}...", end=' ', flush=True)
    before = len(rows)
    for tbl in get_wikitables(url):
        for row in tbl:
            yr   = extract_year(find_key(row, 'year', 'season'))
            name = find_key(row, 'player', 'winner', 'name')
            if not yr or not name:
                continue
            for n in split_names(name):
                add(n, award, yr,
                    find_key(row, 'team', 'club'),
                    find_key(row, 'pos', 'position'))
    print(f"{len(rows) - before} rows")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Hall of Fame
# ─────────────────────────────────────────────────────────────────────────────
print("\n── Hall of Fame ──")
before = len(rows)
for tbl in get_wikitables('https://en.wikipedia.org/wiki/List_of_Pro_Football_Hall_of_Fame_inductees'):
    for row in tbl:
        name = find_key(row, 'name', 'inductee', 'player')
        if not name or is_junk(name):
            continue
        yr  = extract_year(find_key(row, 'class', 'year', 'inducted'))
        pos = find_key(row, 'pos')
        add(name, 'HOF', yr or '', '', pos)
print(f"  {len(rows) - before} rows")

# ─────────────────────────────────────────────────────────────────────────────
# 3. AP First-Team All-Pro
#    Data lives in {year}_NFL_season under an "All-Pro team" heading.
#    Table: col 0 = position, col 1 = "Name ( TEAM ) Name2 ( TEAM2 )"
# ─────────────────────────────────────────────────────────────────────────────
def scrape_allpro(year):
    soup = get_soup(f'https://en.wikipedia.org/wiki/{year}_NFL_season')
    if not soup:
        return []
    results = []
    for heading in soup.find_all(['h2', 'h3', 'h4']):
        if 'all-pro' not in heading.get_text(strip=True).lower():
            continue
        tbl = heading.find_next('table', class_=re.compile('wikitable'))
        if not tbl:
            continue
        for row in tbl.find_all('tr'):
            cells = row.find_all(['th', 'td'])
            if len(cells) < 2:
                continue
            pos = clean(cells[0].get_text(' ', strip=True))
            if re.match(r'^(Offense|Defense|Special|Teams?)$', pos, re.I):
                continue
            raw = cells[1].get_text('\n', strip=True)
            for segment in raw.split('\n'):
                segment = segment.strip()
                if not segment:
                    continue
                # Strip team abbreviation in parens: "( BAL )" or "(BAL)"
                name = re.sub(r'\(\s*[A-Z]{2,4}\s*\)', '', segment).strip()
                name = clean(name)
                if name and len(name) > 3:
                    results.append({'player': name, 'position': pos})
        break  # only use first All-Pro table found
    return results

print("\n── AP First-Team All-Pro (1970–2025) ──")
all_pro_total = 0
for yr in range(1970, 2026):
    entries = scrape_allpro(yr)
    for e in entries:
        add(e['player'], 'ALL_PRO_FIRST', yr, '', e['position'])
    all_pro_total += len(entries)
    print(f"  {yr}: {len(entries) if entries else 'not found'}")
print(f"  → {all_pro_total} total")

# ─────────────────────────────────────────────────────────────────────────────
# 4. Pro Bowl rosters
#    URL: {season+1}_Pro_Bowl_Games (2022+) or {season+1}_Pro_Bowl (pre-2022)
#    Table: Position | Starter(s) | Reserve(s) | Alternate(s)
#    Each cell: "31 Name , Team\n8 Name2 , Team2"
# ─────────────────────────────────────────────────────────────────────────────
def extract_probowl_names(cell):
    raw = cell.get_text('\n', strip=True)
    names = []
    for line in raw.split('\n'):
        line = line.strip()
        if not line:
            continue
        line = re.sub(r'^\d{1,2}\s+', '', line)          # strip jersey number
        line = re.sub(r'\s*,\s*\w[\w\s]*$', '', line)    # strip ", Team"
        name = clean(line)
        if name and len(name) > 4 and ' ' in name:
            names.append(name)
    return names

def scrape_probowl(season):
    game_year = season + 1
    for url in [
        f'https://en.wikipedia.org/wiki/{game_year}_Pro_Bowl_Games',
        f'https://en.wikipedia.org/wiki/{game_year}_Pro_Bowl',
    ]:
        soup = get_soup(url)
        if not soup:
            continue
        results = []
        for tbl in soup.find_all('table', class_=re.compile('wikitable')):
            header_row = tbl.find('tr')
            if not header_row:
                continue
            headers = [c.get_text(strip=True).lower()
                       for c in header_row.find_all(['th', 'td'])]
            if not any('starter' in h or 'player' in h for h in headers):
                continue
            for row in tbl.find_all('tr')[1:]:
                for cell in row.find_all(['td', 'th']):
                    results.extend(extract_probowl_names(cell))
        if results:
            return list(dict.fromkeys(results))
    return []

print("\n── Pro Bowl rosters (1980–2025 seasons) ──")
pro_bowl_total = 0
for season in range(1979, 2026):
    names = scrape_probowl(season)
    for name in names:
        add(name, 'PRO_BOWL', season)
    pro_bowl_total += len(names)
    print(f"  {season}: {len(names)}")
print(f"  → {pro_bowl_total} total")

# ─────────────────────────────────────────────────────────────────────────────
# Write CSV
# ─────────────────────────────────────────────────────────────────────────────
df = (
    pd.DataFrame(rows, columns=['player', 'award', 'year', 'team', 'position'])
    .drop_duplicates()
    .query("player.str.len() > 1")
    .sort_values(['award', 'year', 'player'])
    .reset_index(drop=True)
)

out = 'awards.csv'
df.to_csv(out, index=False)
print(f"\n{'='*50}")
print(f"Wrote {len(df)} rows to {out}")
print(df['award'].value_counts().to_string())

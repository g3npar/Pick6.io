"""
Builds api/data/old_logos.json and downloads old logos from sportslogos.net, for Logo Lineup.
Keeps each team's two most recent old logos (used 1980+) that look different from today's.
Pages are cached and fetched slowly.

Run: python3 scripts/build_old_logos.py --review   (contact sheet to check, add bad ones to EXCLUDE)
     python3 scripts/build_old_logos.py            (download)
"""

import argparse
import hashlib
import html as html_lib
import io
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
TEAMS_JSON = os.path.join(ROOT, 'api', 'data', 'logo_teams.json')
OUT_JSON = os.path.join(ROOT, 'api', 'data', 'old_logos.json')
OUT_LOGOS = os.path.join(ROOT, 'public', 'logos', 'leagues', 'old')

SITE = 'https://www.sportslogos.net'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

OLDEST_END = 1980     # a logo retired before this is too old for casual fans
PER_TEAM = 2          # most recent old logos kept per team
MIN_DIFF = 0.14       # how different from today's logo an old one has to look, see difference()

# sportslogos league ids (college is six pages)
LEAGUE_PAGES = {'nhl': [1], 'mlb': [4], 'nba': [6], 'nfl': [7], 'ncaa': [30, 31, 32, 33, 34, 35]}

# old pages whose title doesn't match ESPN's name
ALIASES = {
    ('nhl', 'Anaheim Ducks'): ['Mighty Ducks of Anaheim'],
    ('ncaa', 'BYU Cougars'): ['Brigham Young Cougars'],
    ('ncaa', 'NC State Wolfpack'): ['North Carolina State Wolfpack'],
    ('ncaa', 'Ole Miss Rebels'): ['Mississippi Rebels'],
}
SKIP_PAGES = {
    168, 182, 6741,   # Redskins and Washington Football Team, the old names are retired
    226, 990,         # New Orleans / OKC Hornets, that's the Pelicans' history not Charlotte's
    34,               # Minnesota North Stars, a different nickname from the Dallas Stars
}
# never used: (team, first season), or a team to skip entirely
EXCLUDE = {
    # Native American caricatures
    ('mlb:atl', 1968), ('mlb:atl', 1985),   # Braves screaming face
    ('ncaa:ill', 1981),                     # Chief Illiniwek
    ('ncaa:utah', 1975),                    # drum and feathers
    ('ncaa:miss', 1970),                    # Colonel Reb
    # too close to today's logo
    'nfl:lv',                               # the Raiders shield never really changed
    ('nfl:lac', 2002),                      # same bolt, white
    ('nfl:min', 1961), ('nfl:ari', 1988), ('nfl:ari', 1970), ('nfl:sf', 1968),
    ('nhl:bos', 2025), ('nhl:tor', 1988), ('nhl:edm', 1997), ('nhl:stl', 1990),
    ('nba:ny', 1993), ('nba:ind', 2006),
    ('ncaa:hou', 2000), ('ncaa:tam', 1981), ('ncaa:wash', 1983), ('ncaa:iu', 1979), ('ncaa:wis', 1970),
    ('ncaa:stan', 2002), ('ncaa:uva', 1994), ('ncaa:ark', 1967), ('ncaa:cin', 1990),
    'nfl:cle', 'nhl:tor',                   # always a helmet / always a leaf
    ('nfl:no', 1967), ('nba:ny', 1984), ('nba:hou', 2004),
    ('nhl:stl', 1988), ('nhl:stl', 1979), ('ncaa:hou', 1962), ('ncaa:stan', 1979),
    ('nfl:nyj', 1998), ('mlb:sd', 2015), ('nhl:nyi', 1973), ('mlb:sd', 2012), ('nhl:min', 2001),
    # too rough to zoom
    ('ncaa:colo', 1967),
}
excluded = lambda t, start: f"{t['league']}:{t['id']}" in EXCLUDE or (f"{t['league']}:{t['id']}", start) in EXCLUDE


def cache_dir():
    d = os.path.join(tempfile.gettempdir(), 'pick6-sportslogos')
    os.makedirs(d, exist_ok=True)
    return d


def url_name(kind, url):
    # ids repeat across leagues, so cache by url
    return f"{kind}_{hashlib.sha1(url.encode()).hexdigest()[:16]}"


def fetch(url, name, binary=False):
    path = os.path.join(cache_dir(), name)
    if not os.path.exists(path) or os.path.getsize(path) < 200:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': SITE + '/'})
        # retry network blips
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                break
            except OSError:
                if attempt == 3:
                    raise
                time.sleep(10 * (attempt + 1))
        with open(path, 'wb') as f:
            f.write(data)
        time.sleep(2)
    with open(path, 'rb') as f:
        data = f.read()
    return data if binary else data.decode('utf-8', 'ignore')


norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())


def team_pages(teams):
    """{(league, id): {page id: page title}}, same nickname under any city"""
    out = {}
    for league, ids in LEAGUE_PAGES.items():
        pages = {}
        for i in ids:
            html = fetch(f'{SITE}/teams/list_by_league/{i}/x/', f'league_{i}.html')
            for pid, slug in re.findall(r'href="/logos/list_by_team/(\d+)/([^/"]+)', html):
                if '_' not in slug and int(pid) not in SKIP_PAGES:
                    pages[int(pid)] = slug.replace('-Logos', '').replace('-', ' ')
        for t in (t for t in teams if t['league'] == league):
            names = [t['name']] + ALIASES.get((league, t['name']), [])
            if league == 'ncaa':
                hit = {p: n for p, n in pages.items() if norm(n) in {norm(x) for x in names}}
            else:
                # whole words ("Hornets" isn't the Nets)
                hit = {p: n for p, n in pages.items()
                       if (' ' + n.lower()).endswith(' ' + t['nickname'].lower()) or norm(n) in {norm(x) for x in names}}
            if not hit:
                raise SystemExit(f"no sportslogos page for {t['name']}")
            out[(league, t['id'])] = hit
    return out


LOGO_RE = re.compile(
    r'href="(/logos/view/([^/"]+)/[^"]+/Primary-Logo)"\s*title="([^"]*?) Primary Logo \((\d{4})\s*-\s*(\d{4}|Pres\w*)\)"'
    r'.*?<img src="([^"]+/thumbs/[^"]+)"', re.S)


def signature(im):
    # tiny thumbnail for comparing logos
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, 'white')
    bg.alpha_composite(im)
    im = bg.convert('RGB')
    # near white is background
    bbox = im.convert('L').point(lambda v: 255 if v < 235 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    return list(im.resize((24, 24), Image.LANCZOS).getdata())


def difference(a, b):
    # 0 same, ~0.1 redraw, 0.2+ different
    return sum(abs(x - y) for p, q in zip(a, b) for x, y in zip(p, q)) / (len(a) * 3 * 255)


def current_logo(t):
    # Pillow can't read svg, so sharp draws it
    png = os.path.join(cache_dir(), f"current_{t['league']}_{t['id']}.png")
    if not os.path.exists(png):
        svg = os.path.abspath(os.path.join(ROOT, 'public', 'logos', 'leagues', t['logo']))
        script = ("require('sharp')(process.argv[1], { density: 150 }).resize(300, 300, { fit: 'contain', "
                  "background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(process.argv[2])")
        subprocess.run(['node', '-e', script, svg, png], cwd=os.path.join(ROOT, 'api'), check=True)
    return Image.open(png)


def thumb_signature(lid, thumb):
    return signature(Image.open(io.BytesIO(fetch(thumb, url_name('thumb', thumb), binary=True))))


def candidates(teams):
    pages = team_pages(teams)
    out = []
    for t in teams:
        logos, current = [], []
        for pid in pages[(t['league'], t['id'])]:
            html = fetch(f'{SITE}/logos/list_by_team/{pid}/x/', f'team_{pid}.html')
            for view, lid, era_name, start, end, thumb in LOGO_RE.findall(html):
                if not end.isdigit():
                    # today's logo, from sportslogos' own thumbnail
                    current.append(thumb_signature(lid, thumb))
                    continue
                if int(end) < OLDEST_END:
                    continue
                logos.append({'id': lid, 'league': t['league'], 'team': t['id'], 'teamName': t['name'],
                              'eraName': era_name.strip(), 'start': int(start), 'end': int(end),
                              'view': view, 'thumb': thumb})
        # one entry per logo, newest first
        logos = sorted({l['id']: l for l in logos}.values(), key=lambda l: -l['end'])
        # skip anything that looks like today's logo (sportslogos' and the game's) or one already picked
        picked, sigs = [], current + [signature(current_logo(t))]
        for l in logos:
            if excluded(t, l['start']):
                continue
            sig = thumb_signature(l['id'], l['thumb'])
            l['diff'] = round(min(difference(sig, s) for s in sigs), 3)
            if l['diff'] < MIN_DIFF:
                continue
            picked.append(l)
            sigs.append(sig)
            if len(picked) == PER_TEAM:
                break
        out += picked
    return out


def contact_sheet(logos, path):
    cols, w, h = 8, 170, 110
    sheet = Image.new('RGB', (cols * w, ((len(logos) + cols - 1) // cols) * h), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, l in enumerate(logos):
        im = Image.open(io.BytesIO(fetch(l['thumb'], url_name('thumb', l['thumb']), binary=True))).convert('RGBA')
        im.thumbnail((150, 70))
        x, y = i % cols * w, i // cols * h
        sheet.paste(im, (x + 10, y + 5), im)
        draw.text((x + 4, y + 78), f"{l['eraName'][:24]}", fill='black')
        draw.text((x + 4, y + 92), f"{l['league']}:{l['team']} {l['start']}-{l['end']} d{l.get('diff', '')}", fill='gray')
    sheet.save(path)


def full_image(l):
    html = fetch(SITE + l['view'], url_name('view', l['view']))
    # decode &amp; (Texas A&M)
    urls = sorted({html_lib.unescape(u) for u in re.findall(r'https://content\.sportslogos\.net/logos/\d+/\d+/full/[^"\' ]+\.(?:png|gif|jpg)', html)})
    if len(urls) != 1:
        raise SystemExit(f"expected one full image for {l['eraName']} {l['id']}, found {urls}")
    return Image.open(io.BytesIO(fetch(urls[0], url_name('full', urls[0]), binary=True)))


def clean(im):
    # remove white backgrounds from the corners in
    opaque = im.mode in ('RGB', 'P', 'L') and 'transparency' not in im.info
    im = im.convert('RGBA')
    if opaque:
        w, h = im.size
        for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            if im.getpixel(xy)[:3] >= (235, 235, 235):
                ImageDraw.floodfill(im, xy, (255, 255, 255, 0), thresh=40)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    # keep full size, the game zooms in
    im.thumbnail((1000, 1000), Image.LANCZOS)
    return im


parser = argparse.ArgumentParser()
parser.add_argument('--review', action='store_true', help='only list candidates and make a contact sheet')
args = parser.parse_args()

with open(TEAMS_JSON) as f:
    teams = json.load(f)

print('── Finding old logos ──')
logos = candidates(teams)
print(f'  {len(logos)} candidates')

if args.review:
    sheet = os.path.join(cache_dir(), 'review.png')
    contact_sheet(logos, sheet)
    print(f'  contact sheet: {sheet}')
    raise SystemExit

print('── Downloading ──')
os.makedirs(OUT_LOGOS, exist_ok=True)
rows = []
for n, l in enumerate(logos):
    name = f"{l['league']}-{l['team']}-{l['start']}"
    path = os.path.join(OUT_LOGOS, name + '.webp')
    if not os.path.exists(path):
        clean(full_image(l)).save(path, 'WEBP', quality=90)
    rows.append({'league': l['league'], 'team': l['team'], 'eraName': l['eraName'],
                 'start': l['start'], 'end': l['end'], 'logo': f'old/{name}.webp'})
    if n % 25 == 0:
        print(f'  {n}/{len(logos)}', flush=True)

with open(OUT_JSON, 'w') as f:
    json.dump(rows, f, indent=1)
print(f'  {len(rows)} old logos, wrote {os.path.relpath(OUT_JSON)}')

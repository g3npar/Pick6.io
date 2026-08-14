"""
Loads all NFL player and season data into RDS PostgreSQL.
Handles schema migration, player data, season stats, and all award/metadata
in a single pass — no separate helper scripts needed.

Run:
  python3 scripts/load_data.py
"""

import os
import nfl_data_py as nfl
import nflreadpy
import polars as pl
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
import pandas as pd

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in .env")

conn = psycopg2.connect(DATABASE_URL)
cur  = conn.cursor()

# ════════════════════════════════════════════════════════════════════════════════
# 1 — Schema migration  (safe to re-run)
# ════════════════════════════════════════════════════════════════════════════════
print("── 1. Schema migration ──")
for stmt in [
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS college      TEXT",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS draft_year   SMALLINT",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS draft_round  SMALLINT",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS draft_number SMALLINT",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS heisman_year SMALLINT",
    # player_seasons (existing cols are harmless to retry)
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS sacks             SMALLINT",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS def_ints          SMALLINT",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS super_bowl_winner BOOLEAN DEFAULT FALSE",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS ap_mvp            BOOLEAN DEFAULT FALSE",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS ap_allpro_first   BOOLEAN DEFAULT FALSE",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS passing_yards     INTEGER",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS passing_tds       SMALLINT",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS passing_ints      SMALLINT",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS receiving_yards   INTEGER",
    "ALTER TABLE player_seasons ADD COLUMN IF NOT EXISTS pro_bowl          BOOLEAN DEFAULT FALSE",
]:
    cur.execute(stmt)
cur.execute("""
    CREATE TABLE IF NOT EXISTS player_awards (
        id          SERIAL PRIMARY KEY,
        player_id   INTEGER  NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        season_year SMALLINT NOT NULL,
        award_type  TEXT     NOT NULL,
        UNIQUE (player_id, season_year, award_type)
    )
""")
cur.execute("CREATE INDEX IF NOT EXISTS idx_player_awards_player ON player_awards (player_id)")
conn.commit()
print("  Done")

# ════════════════════════════════════════════════════════════════════════════════
# 2 — Fetch source data
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 2. Fetching source data ──")

print("  Seasonal stats 1980–2025...")
stats_old = nfl.import_seasonal_data(list(range(1980, 2025)))

print("  Player info...")
players_df = nfl.import_players()

print("  2025 weekly stats (nflreadpy)...")
weekly_2025 = nflreadpy.load_player_stats(seasons=[2025])
_2025_cols  = weekly_2025.columns
seasonal_2025 = (
    weekly_2025
    .filter(pl.col("season_type") == "REG")
    .group_by(["player_id", "player_display_name", "position"])
    .agg([
        pl.lit(2025).alias("season"),
        pl.col("team").mode().first().alias("recent_team"),
        pl.sum("fantasy_points_ppr").alias("fantasy_points_ppr"),
        pl.sum("rushing_yards").alias("rushing_yards"),
        pl.sum("receiving_tds").alias("receiving_tds"),
        *([ pl.sum("sacks").alias("sacks") ] if "sacks" in _2025_cols else []),
    ])
    .to_pandas()
)
if "sacks" not in seasonal_2025.columns:
    seasonal_2025["sacks"] = None

# Build a gsis_id → college/draft lookup from players_df
META_COLS  = ['gsis_id', 'college_name', 'draft_year', 'draft_round', 'draft_number']
meta_avail = [c for c in META_COLS if c in players_df.columns]
player_meta = {}
for _, r in players_df[meta_avail].dropna(subset=['gsis_id']).iterrows():
    entry = {}
    if 'college_name'  in meta_avail and pd.notna(r.get('college_name')) and str(r['college_name']).strip():
        entry['college']      = str(r['college_name']).strip()
    if 'draft_year'    in meta_avail and pd.notna(r.get('draft_year')):
        entry['draft_year']   = int(r['draft_year'])
    if 'draft_round'   in meta_avail and pd.notna(r.get('draft_round')):
        entry['draft_round']  = int(r['draft_round'])
    if 'draft_number'  in meta_avail and pd.notna(r.get('draft_number')):
        entry['draft_number'] = int(r['draft_number'])
    if entry:
        player_meta[str(r['gsis_id'])] = entry

has_pro_bowl = 'pro_bowl' in stats_old.columns
print(f"  pro_bowl column in seasonal data: {has_pro_bowl}")

# ════════════════════════════════════════════════════════════════════════════════
# 3 — Players upsert  (includes college + draft in same pass)
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 3. Inserting players ──")
merged_old = stats_old.merge(
    players_df[["gsis_id", "display_name", "position", "birth_date"]],
    left_on="player_id", right_on="gsis_id", how="left"
)
unique_old = (
    merged_old[["player_id", "display_name", "position", "birth_date"]]
    .drop_duplicates(subset="player_id")
    .dropna(subset=["display_name"])
)

existing_ids = set(unique_old["player_id"])
new_2025 = seasonal_2025[~seasonal_2025["player_id"].isin(existing_ids)][
    ["player_id", "player_display_name", "position"]
].drop_duplicates(subset="player_id")
new_2025 = new_2025.rename(columns={"player_display_name": "display_name"})
new_2025["birth_date"] = None

all_players = pd.concat([unique_old, new_2025], ignore_index=True).dropna(subset=["display_name"])

player_id_map = {}
player_rows   = []
for _, row in all_players.iterrows():
    birth_year = None
    if row["birth_date"] and str(row["birth_date"]) != "nan":
        try:
            birth_year = int(str(row["birth_date"])[:4])
        except Exception:
            pass
    meta = player_meta.get(str(row["player_id"]), {})
    player_rows.append((
        row["player_id"], row["display_name"], row.get("position"), birth_year,
        meta.get("college"), meta.get("draft_year"),
        meta.get("draft_round"), meta.get("draft_number"),
    ))

results = execute_values(cur, """
    INSERT INTO players (nfl_id, name, position, birth_year, college, draft_year, draft_round, draft_number)
    VALUES %s
    ON CONFLICT (nfl_id) DO UPDATE
      SET name         = EXCLUDED.name,
          position     = EXCLUDED.position,
          birth_year   = EXCLUDED.birth_year,
          college      = COALESCE(EXCLUDED.college,      players.college),
          draft_year   = COALESCE(EXCLUDED.draft_year,   players.draft_year),
          draft_round  = COALESCE(EXCLUDED.draft_round,  players.draft_round),
          draft_number = COALESCE(EXCLUDED.draft_number, players.draft_number)
    RETURNING id, nfl_id
""", player_rows, fetch=True)
for db_id, nfl_id in results:
    player_id_map[nfl_id] = db_id
conn.commit()
print(f"  {len(player_id_map)} players upserted")

# ════════════════════════════════════════════════════════════════════════════════
# 4 — Season rows 1980–2025  (includes passing / receiving / pro_bowl)
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 4. Inserting player seasons (1980–2025) ──")
print("  Building team map from weekly data...")
weekly   = nfl.import_weekly_data(list(range(1980, 2025)), columns=['player_id', 'season', 'recent_team'])
team_map = (
    weekly.groupby(['player_id', 'season'])['recent_team']
    .agg(lambda x: x.mode().iloc[0] if len(x) > 0 else None)
    .reset_index()
    .set_index(['player_id', 'season'])['recent_team']
    .to_dict()
)

def safe_int(row, col):
    v = row.get(col)
    return int(v) if pd.notna(v) and v else None

season_rows = []
for _, row in stats_old.iterrows():
    db_id = player_id_map.get(row["player_id"])
    if not db_id:
        continue
    yr   = int(row["season"])
    team = team_map.get((row["player_id"], yr))
    season_rows.append((
        db_id, str(team) if team else None, yr,
        round(float(row.get("fantasy_points_ppr") or 0), 1),
        safe_int(row, "rushing_yards"),
        safe_int(row, "receiving_tds"),
        safe_int(row, "sacks"),
        safe_int(row, "passing_yards"),
        safe_int(row, "passing_tds"),
        safe_int(row, "interceptions"),   # stored as passing_ints
        safe_int(row, "receiving_yards"),
        bool(row["pro_bowl"]) if has_pro_bowl and pd.notna(row.get("pro_bowl")) else False,
    ))

execute_values(cur, """
    INSERT INTO player_seasons
      (player_id, team, season_year, fpts,
       rush_yards, rec_tds, sacks,
       passing_yards, passing_tds, passing_ints, receiving_yards, pro_bowl)
    VALUES %s
    ON CONFLICT (player_id, season_year) DO UPDATE
      SET team            = EXCLUDED.team,
          fpts            = EXCLUDED.fpts,
          rush_yards      = EXCLUDED.rush_yards,
          rec_tds         = EXCLUDED.rec_tds,
          sacks           = EXCLUDED.sacks,
          passing_yards   = EXCLUDED.passing_yards,
          passing_tds     = EXCLUDED.passing_tds,
          passing_ints    = EXCLUDED.passing_ints,
          receiving_yards = EXCLUDED.receiving_yards,
          pro_bowl        = EXCLUDED.pro_bowl
""", season_rows)
conn.commit()
print(f"  {len(season_rows)} rows upserted")

# ════════════════════════════════════════════════════════════════════════════════
# 5 — Season rows 2025
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 5. Inserting player seasons (2025) ──")
season_rows_2025 = []
for _, row in seasonal_2025.iterrows():
    db_id = player_id_map.get(row["player_id"])
    if not db_id:
        continue
    season_rows_2025.append((
        db_id, str(row.get("recent_team")) if row.get("recent_team") else None, 2025,
        round(float(row["fantasy_points_ppr"] or 0), 1),
        safe_int(row, "rushing_yards"),
        safe_int(row, "receiving_tds"),
        safe_int(row, "sacks"),
        None, None, None, None, False,  # passing/receiving not in nflreadpy weekly agg
    ))

execute_values(cur, """
    INSERT INTO player_seasons
      (player_id, team, season_year, fpts,
       rush_yards, rec_tds, sacks,
       passing_yards, passing_tds, passing_ints, receiving_yards, pro_bowl)
    VALUES %s
    ON CONFLICT (player_id, season_year) DO UPDATE
      SET team       = EXCLUDED.team,
          fpts       = EXCLUDED.fpts,
          rush_yards = EXCLUDED.rush_yards,
          rec_tds    = EXCLUDED.rec_tds,
          sacks      = EXCLUDED.sacks
""", season_rows_2025)
conn.commit()
print(f"  {len(season_rows_2025)} rows upserted")

# ════════════════════════════════════════════════════════════════════════════════
# 6 — PFR defensive stats  (2018–2025)
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 6. PFR defensive stats ──")
pfr_def = nflreadpy.load_pfr_advstats(seasons=True, stat_type='def', summary_level='season').to_pandas()

pfr_to_gsis = (
    players_df[['gsis_id', 'pfr_id']]
    .dropna(subset=['pfr_id'])
    .drop_duplicates('pfr_id')
    .set_index('pfr_id')['gsis_id']
    .to_dict()
)
pfr_def['gsis_id'] = pfr_def['pfr_id'].map(pfr_to_gsis)
pfr_def_known = pfr_def.dropna(subset=['gsis_id']).copy()

def_player_tuples = [
    (
        row['gsis_id'], row['player'], row['pos'], None,
        player_meta.get(str(row['gsis_id']), {}).get('college'),
        player_meta.get(str(row['gsis_id']), {}).get('draft_year'),
        player_meta.get(str(row['gsis_id']), {}).get('draft_round'),
        player_meta.get(str(row['gsis_id']), {}).get('draft_number'),
    )
    for _, row in pfr_def_known[['gsis_id', 'player', 'pos']].drop_duplicates('gsis_id').iterrows()
]
def_results = execute_values(cur, """
    INSERT INTO players (nfl_id, name, position, birth_year, college, draft_year, draft_round, draft_number)
    VALUES %s
    ON CONFLICT (nfl_id) DO UPDATE
      SET name         = EXCLUDED.name,
          position     = EXCLUDED.position,
          college      = COALESCE(EXCLUDED.college,      players.college),
          draft_year   = COALESCE(EXCLUDED.draft_year,   players.draft_year),
          draft_round  = COALESCE(EXCLUDED.draft_round,  players.draft_round),
          draft_number = COALESCE(EXCLUDED.draft_number, players.draft_number)
    RETURNING id, nfl_id
""", def_player_tuples, fetch=True)
for db_id, nfl_id in def_results:
    player_id_map[nfl_id] = db_id
conn.commit()

def_season_agg = (
    pfr_def_known
    .groupby(['gsis_id', 'season'])
    .agg(tm=('tm', 'last'), sk=('sk', 'sum'), int_=('int', 'sum'))
    .reset_index()
)
def_season_rows = []
for _, row in def_season_agg.iterrows():
    db_id = player_id_map.get(row['gsis_id'])
    if not db_id:
        continue
    def_season_rows.append((
        db_id, str(row['tm']) if pd.notna(row.get('tm')) else None, int(row['season']),
        0.0, None, None,
        int(row['sk'])   if pd.notna(row.get('sk'))   else None,
        None, None, None, None, False,
        int(row['int_']) if pd.notna(row.get('int_')) else None,
    ))

execute_values(cur, """
    INSERT INTO player_seasons
      (player_id, team, season_year, fpts,
       rush_yards, rec_tds, sacks,
       passing_yards, passing_tds, passing_ints, receiving_yards, pro_bowl,
       def_ints)
    VALUES %s
    ON CONFLICT (player_id, season_year) DO UPDATE
      SET team     = EXCLUDED.team,
          sacks    = EXCLUDED.sacks,
          def_ints = EXCLUDED.def_ints
""", def_season_rows)
conn.commit()
print(f"  {len(def_season_rows)} defensive season rows upserted")

# ════════════════════════════════════════════════════════════════════════════════
# 7 — Super Bowl winners
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 7. Super Bowl winners ──")
# Pre-1999 winners hardcoded (import_schedules only supports 1999+)
SB_WINNERS_PRE1999 = {
    1980: 'OAK', 1981: 'SF',  1982: 'WAS', 1983: 'RAI', 1984: 'SF',
    1985: 'CHI', 1986: 'NYG', 1987: 'WAS', 1988: 'SF',  1989: 'SF',
    1990: 'NYG', 1991: 'WAS', 1992: 'DAL', 1993: 'DAL', 1994: 'SF',
    1995: 'DAL', 1996: 'GB',  1997: 'DEN', 1998: 'DEN',
}
schedules  = nfl.import_schedules(list(range(1999, 2026)))
sb_games   = schedules[schedules["game_type"] == "SB"][
    ["season", "home_team", "away_team", "home_score", "away_score"]
]
sb_winners = dict(SB_WINNERS_PRE1999)
for _, g in sb_games.iterrows():
    winner = g["home_team"] if g["home_score"] > g["away_score"] else g["away_team"]
    sb_winners[int(g["season"])] = winner
print(f"  {len(sb_winners)} SB seasons found")

cur.execute("UPDATE player_seasons SET super_bowl_winner = false")

# Pass 1 — team-column match (works for all players with a team value)
for season, team in sb_winners.items():
    cur.execute("""
        UPDATE player_seasons ps SET super_bowl_winner = true
        FROM players p
        WHERE ps.player_id = p.id
          AND ps.season_year = %s AND ps.team = %s
    """, (season, team))

# Pass 2 — roster-based match for 1999+ (catches defenders/ST with NULL team)
roster_years = sorted(yr for yr in sb_winners if yr >= 1999)
if roster_years:
    print(f"  Loading seasonal rosters for {len(roster_years)} SB seasons (1999+)…")
    rosters = nfl.import_seasonal_rosters(roster_years)
    for yr in roster_years:
        team = sb_winners[yr]
        gsis_ids = (
            rosters[(rosters['season'] == yr) & (rosters['team'] == team)]['player_id']
            .dropna().tolist()
        )
        if not gsis_ids:
            continue
        cur.execute("SELECT id FROM players WHERE nfl_id = ANY(%s)", (gsis_ids,))
        db_ids = [r[0] for r in cur.fetchall()]
        if db_ids:
            cur.execute("""
                UPDATE player_seasons SET super_bowl_winner = true
                WHERE player_id = ANY(%s) AND season_year = %s
            """, (db_ids, yr))

# Pass 3 — manual overrides for pre-1999 defenders / known gaps
# Upserts a season row if missing, then sets the flag.
SB_PLAYER_OVERRIDES = [
    # (player_name, season_year, team)
    ("Deion Sanders",   1994, "SF"),   # SF 49ers, SB XXIX
    ("Deion Sanders",   1995, "DAL"),  # DAL Cowboys, SB XXX
    ("Rashid Shaheed",  2025, "NO"),   # Saints, SB LX
]
for name, yr, team in SB_PLAYER_OVERRIDES:
    cur.execute("SELECT id FROM players WHERE name ILIKE %s LIMIT 1", (name,))
    row = cur.fetchone()
    if not row:
        continue
    cur.execute("""
        INSERT INTO player_seasons (player_id, team, season_year, fpts, super_bowl_winner)
        VALUES (%s, %s, %s, 0, true)
        ON CONFLICT (player_id, season_year) DO UPDATE
          SET super_bowl_winner = true,
              team = COALESCE(player_seasons.team, EXCLUDED.team)
    """, (row[0], team, yr))

conn.commit()
print("  super_bowl_winner updated")

# ════════════════════════════════════════════════════════════════════════════════
# 8 — AP NFL MVP
# ════════════════════════════════════════════════════════════════════════════════
AP_MVP = {
    1980: "Brian Sipe",       1981: "Ken Anderson",      1982: "Mark Moseley",
    1983: "Joe Theismann",    1984: "Dan Marino",        1985: "Marcus Allen",
    1986: "Lawrence Taylor",  1987: "John Elway",        1988: "Boomer Esiason",
    1989: "Joe Montana",      1990: "Joe Montana",       1991: "Thurman Thomas",
    1992: "Steve Young",      1993: "Emmitt Smith",      1994: "Steve Young",
    1995: "Brett Favre",      1996: "Brett Favre",       1997: "Barry Sanders",
    1998: "Terrell Davis",
    1999: "Kurt Warner",       2000: "Marshall Faulk",      2001: "Marshall Faulk",
    2002: "Rich Gannon",       2003: "Peyton Manning",      2004: "Peyton Manning",
    2005: "Shaun Alexander",   2006: "LaDainian Tomlinson", 2007: "Tom Brady",
    2008: "Peyton Manning",    2009: "Peyton Manning",      2010: "Tom Brady",
    2011: "Aaron Rodgers",     2012: "Adrian Peterson",     2013: "Peyton Manning",
    2014: "Aaron Rodgers",     2015: "Cam Newton",          2016: "Matt Ryan",
    2017: "Tom Brady",         2018: "Patrick Mahomes",     2019: "Lamar Jackson",
    2020: "Aaron Rodgers",     2021: "Aaron Rodgers",       2022: "Patrick Mahomes",
    2023: "Lamar Jackson",     2024: "Josh Allen",          2025: "Matthew Stafford",
}
AP_MVP_EXTRA = {2003: "Steve McNair", 1997: "Brett Favre"}

print("\n── 8. AP MVP ──")
cur.execute("UPDATE player_seasons SET ap_mvp = false")
for season, name in {**AP_MVP, **AP_MVP_EXTRA}.items():
    cur.execute("""
        UPDATE player_seasons ps SET ap_mvp = true
        FROM players p
        WHERE ps.player_id = p.id
          AND ps.season_year = %s AND p.name ILIKE %s
    """, (season, f"%{name.split()[-1]}%"))
conn.commit()
print("  ap_mvp updated")

# ════════════════════════════════════════════════════════════════════════════════
# 9 — Heisman winners
# ════════════════════════════════════════════════════════════════════════════════
HEISMAN = {
    1998: "Ricky Williams",     1999: "Ron Dayne",
    2000: "Chris Weinke",       2002: "Carson Palmer",
    2004: "Matt Leinart",       2005: "Reggie Bush",
    2007: "Tim Tebow",          2008: "Sam Bradford",
    2009: "Mark Ingram",        2010: "Cam Newton",
    2011: "Robert Griffin III", 2012: "Johnny Manziel",
    2013: "Jameis Winston",     2014: "Marcus Mariota",
    2015: "Derrick Henry",      2016: "Lamar Jackson",
    2017: "Baker Mayfield",     2018: "Kyler Murray",
    2019: "Joe Burrow",         2020: "DeVonta Smith",
    2021: "Bryce Young",        2022: "Caleb Williams",
    2023: "Jayden Daniels",     2024: "Travis Hunter",
    2025: "Fernando Mendoza",
}

print("\n── 9. Heisman winners ──")
count = 0
for year, name in HEISMAN.items():
    cur.execute(
        "UPDATE players SET heisman_year = %s WHERE name ILIKE %s AND heisman_year IS NULL",
        (year, f"%{name.split()[-1]}%")
    )
    count += cur.rowcount
conn.commit()
print(f"  {count} players updated")

# ════════════════════════════════════════════════════════════════════════════════
# 10 — Awards from import_awards()
#      Covers: All-Pro, OPOY, DPOY, OROY, DROY, CPOY, Pro Bowl
#      ap_allpro_first and pro_bowl are written directly onto player_seasons;
#      everything else goes into the player_awards table.
# ════════════════════════════════════════════════════════════════════════════════

# award string → (action, value)
#   action 'season_flag' → UPDATE player_seasons SET <value> = true
#   action 'award_row'   → INSERT into player_awards with award_type = <value>
AWARD_ACTIONS = {
    'First-Team All-Pro':              ('season_flag', 'ap_allpro_first'),
    'AP First-Team All-Pro':           ('season_flag', 'ap_allpro_first'),
    'Pro Bowl':                        ('season_flag', 'pro_bowl'),
    'AP Offensive Player of the Year': ('award_row',   'OPOY'),
    'AP Defensive Player of the Year': ('award_row',   'DPOY'),
    'AP Offensive Rookie of the Year': ('award_row',   'OROY'),
    'AP Defensive Rookie of the Year': ('award_row',   'DROY'),
    'AP Comeback Player of the Year':  ('award_row',   'CPOY'),
    'Offensive Player of the Year':    ('award_row',   'OPOY'),
    'Defensive Player of the Year':    ('award_row',   'DPOY'),
    'Offensive Rookie of the Year':    ('award_row',   'OROY'),
    'Defensive Rookie of the Year':    ('award_row',   'DROY'),
    'Comeback Player of the Year':     ('award_row',   'CPOY'),
}

print("\n── 10. Awards (import_awards) ──")
cur.execute("SELECT id, nfl_id FROM players")
id_map = {nfl_id: db_id for db_id, nfl_id in cur.fetchall()}

cur.execute("UPDATE player_seasons SET ap_allpro_first = false")
if not has_pro_bowl:
    cur.execute("UPDATE player_seasons SET pro_bowl = false")
conn.commit()

try:
    awards_df  = nfl.import_awards(list(range(1980, 2025)))
    award_col  = next((c for c in awards_df.columns if 'award' in c.lower()), None)
    player_col = next((c for c in awards_df.columns if c in ('gsis_id', 'player_id')), None)
    season_col = next((c for c in awards_df.columns if 'season' in c.lower()), None)
    name_col   = next((c for c in awards_df.columns if 'name'   in c.lower()), None)
    print(f"  Columns: {list(awards_df.columns)}")

    award_rows   = []   # for player_awards table
    flag_updates = 0

    for _, row in awards_df.iterrows():
        raw    = str(row.get(award_col, '')).strip()
        action = AWARD_ACTIONS.get(raw)
        if not action:
            continue
        season = int(row[season_col]) if season_col and pd.notna(row.get(season_col)) else None
        if not season:
            continue

        db_id = None
        if player_col and pd.notna(row.get(player_col)):
            db_id = id_map.get(str(row[player_col]))
        if not db_id and name_col and pd.notna(row.get(name_col)):
            last = str(row[name_col]).split()[-1]
            cur.execute("SELECT id FROM players WHERE name ILIKE %s LIMIT 1", (f"%{last}%",))
            r = cur.fetchone()
            if r:
                db_id = r[0]
        if not db_id:
            continue

        kind, value = action
        if kind == 'season_flag':
            cur.execute(f"""
                UPDATE player_seasons SET {value} = true
                WHERE player_id = %s AND season_year = %s
            """, (db_id, season))
            flag_updates += cur.rowcount
        else:
            award_rows.append((db_id, season, value))

    conn.commit()
    print(f"  {flag_updates} season flag rows updated (All-Pro / Pro Bowl)")

    if award_rows:
        execute_values(cur, """
            INSERT INTO player_awards (player_id, season_year, award_type)
            VALUES %s ON CONFLICT DO NOTHING
        """, award_rows)
        conn.commit()
        print(f"  {len(award_rows)} award rows inserted (OPOY/DPOY/etc.)")
    else:
        print("  No OPOY/DPOY/etc. rows found")

except AttributeError:
    print("  import_awards() not available in this nfl_data_py version — skipping")
except Exception as e:
    print(f"  Awards load skipped: {e}")

cur.close()
conn.close()
print("\n════ All done! ════")

"""
Loads NFL player and season data into RDS PostgreSQL: schema migration,
player/roster data, season stats, and Super Bowl/MVP/Heisman metadata.

Award data (All-Pro, Pro Bowl, OPOY/DPOY/OROY/DROY/CPOY, HOF) comes from a
separate script — see scripts/scrape_awards.py — since nfl_data_py has no
working source for it (see the note near the bottom of this file).

Run:
  python3 scripts/load_data.py                    # full load (rare, ~45yr of history)
  python3 scripts/load_data.py --rosters-only     # rosters + jerseys, no stats
  python3 scripts/load_data.py --current-season   # weekly cron: rosters + this season's stats
"""

import os
import sys
import nfl_data_py as nfl
import nflreadpy
import polars as pl
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
import pandas as pd

# ════════════════════════════════════════════════════════════════════════════════
# 0 — Season configuration
# ════════════════════════════════════════════════════════════════════════════════
NFLDATAPY_MAX_SEASON = 2024
CURRENT_SEASON       = 2026
HISTORY_START        = 1980

MODERN_SEASONS = list(range(NFLDATAPY_MAX_SEASON + 1, CURRENT_SEASON + 1))

ROSTERS_ONLY   = "--rosters-only"   in sys.argv
CURRENT_ONLY   = "--current-season" in sys.argv   # weekly cron target
INCREMENTAL    = ROSTERS_ONLY or CURRENT_ONLY

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
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_number SMALLINT",
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
# 1b — Incremental load  (--rosters-only / --current-season)
# ════════════════════════════════════════════════════════════════════════════════.
if INCREMENTAL:
    mode = "current-season" if CURRENT_ONLY else "rosters-only"
    print(f"\n── 1b. Incremental load — {mode} ({CURRENT_SEASON}) ──")
    roster     = nfl.import_seasonal_rosters([CURRENT_SEASON])
    players_df = nfl.import_players()
    print(f"  {len(roster)} roster rows across {roster['team'].nunique()} teams")

    birth = (
        players_df[["gsis_id", "birth_date"]]
        .dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
        .set_index("gsis_id")["birth_date"].to_dict()
    )

    def _birth_year(value):
        text = str(value or "")
        try:
            year = int(text[:4])
        except ValueError:
            return None
        return year if 1920 < year < CURRENT_SEASON else None

    # rookies won't exist in players yet — insert them before their season rows
    entrants = roster[["player_id", "player_name", "position"]].dropna(
        subset=["player_id", "player_name"]).drop_duplicates("player_id")
    execute_values(cur, """
        INSERT INTO players (nfl_id, name, position, birth_year)
        VALUES %s
        ON CONFLICT (nfl_id) DO UPDATE
          SET name       = EXCLUDED.name,
              position   = COALESCE(EXCLUDED.position,   players.position),
              birth_year = COALESCE(EXCLUDED.birth_year, players.birth_year)
    """, [
        (r["player_id"], r["player_name"], r["position"],
         _birth_year(birth.get(r["player_id"])))
        for _, r in entrants.iterrows()
    ])
    conn.commit()

    cur.execute("SELECT nfl_id, id FROM players WHERE nfl_id = ANY(%s)",
                (entrants["player_id"].tolist(),))
    id_map = dict(cur.fetchall())
    print(f"  {len(id_map)} players resolved")

    # NULL stats here must never clobber real numbers from a full load
    execute_values(cur, """
        INSERT INTO player_seasons (player_id, team, season_year)
        VALUES %s
        ON CONFLICT (player_id, season_year) DO UPDATE
          SET team = COALESCE(EXCLUDED.team, player_seasons.team)
    """, [
        (id_map[r["player_id"]], str(r["team"]) if pd.notna(r["team"]) else None, CURRENT_SEASON)
        for _, r in roster.iterrows() if r["player_id"] in id_map
    ])
    conn.commit()

    jerseys = roster[["player_id", "jersey_number"]].dropna().drop_duplicates("player_id")
    jersey_count = 0
    for _, r in jerseys.iterrows():
        db_id = id_map.get(r["player_id"])
        if db_id:
            cur.execute("UPDATE players SET jersey_number = %s WHERE id = %s",
                        (int(r["jersey_number"]), db_id))
            jersey_count += 1
    conn.commit()
    print(f"  {jersey_count} jersey numbers updated")

    if CURRENT_ONLY:
        weekly = nflreadpy.load_player_stats(seasons=[CURRENT_SEASON])
        if not weekly.height:
            print(f"  no {CURRENT_SEASON} stats published yet")
        else:
            cols  = weekly.columns
            stats = (
                weekly
                .filter(pl.col("season_type") == "REG")
                .group_by(["player_id"])
                .agg([
                    pl.col("team").mode().first().alias("recent_team"),
                    pl.sum("fantasy_points_ppr").alias("fpts"),
                    pl.sum("rushing_yards").alias("rush_yards"),
                    pl.sum("receiving_tds").alias("rec_tds"),
                    *([ pl.sum("sacks").alias("sacks") ] if "sacks" in cols else []),
                ])
                .to_pandas()
            )
            if "sacks" not in stats.columns:
                stats["sacks"] = None

            def _num(value, cast):
                return None if pd.isna(value) else cast(value)

            stat_rows = [
                (id_map[r["player_id"]],
                 str(r["recent_team"]) if pd.notna(r["recent_team"]) else None,
                 CURRENT_SEASON,
                 round(float(r["fpts"] or 0), 1),
                 _num(r["rush_yards"], int), _num(r["rec_tds"], int), _num(r["sacks"], int))
                for _, r in stats.iterrows() if r["player_id"] in id_map
            ]
            if stat_rows:
                execute_values(cur, """
                    INSERT INTO player_seasons
                      (player_id, team, season_year, fpts, rush_yards, rec_tds, sacks)
                    VALUES %s
                    ON CONFLICT (player_id, season_year) DO UPDATE
                      SET team       = COALESCE(EXCLUDED.team, player_seasons.team),
                          fpts       = EXCLUDED.fpts,
                          rush_yards = EXCLUDED.rush_yards,
                          rec_tds    = EXCLUDED.rec_tds,
                          sacks      = EXCLUDED.sacks
                """, stat_rows)
                conn.commit()
            print(f"  {len(stat_rows)} stat rows upserted")

    cur.close()
    conn.close()
    print(f"\n════ Incremental load complete — {mode} ({CURRENT_SEASON}) ════")
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════════
# 2 — Fetch source data
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 2. Fetching source data ──")

print(f"  Seasonal stats {HISTORY_START}–{NFLDATAPY_MAX_SEASON}...")
stats_old = nfl.import_seasonal_data(list(range(HISTORY_START, NFLDATAPY_MAX_SEASON + 1)))

print("  Player info...")
players_df = nfl.import_players()

# seasons past nfl_data_py's ceiling
modern_frames = []
for season in MODERN_SEASONS:
    print(f"  {season} weekly stats (nflreadpy)...")
    weekly = nflreadpy.load_player_stats(seasons=[season])
    if not weekly.height:
        print(f"    no rows yet for {season}, skipping")
        continue
    cols  = weekly.columns
    frame = (
        weekly
        .filter(pl.col("season_type") == "REG")
        .group_by(["player_id", "player_display_name", "position"])
        .agg([
            pl.lit(season).alias("season"),
            pl.col("team").mode().first().alias("recent_team"),
            pl.sum("fantasy_points_ppr").alias("fantasy_points_ppr"),
            pl.sum("rushing_yards").alias("rushing_yards"),
            pl.sum("receiving_tds").alias("receiving_tds"),
            *([ pl.sum("sacks").alias("sacks") ] if "sacks" in cols else []),
        ])
        .to_pandas()
    )
    if "sacks" not in frame.columns:
        frame["sacks"] = None
    print(f"    {len(frame)} players")
    modern_frames.append(frame)

seasonal_modern = (
    pd.concat(modern_frames, ignore_index=True) if modern_frames
    else pd.DataFrame(columns=["player_id", "player_display_name", "position", "season",
                               "recent_team", "fantasy_points_ppr", "rushing_yards",
                               "receiving_tds", "sacks"])
)

# Build a gsis_id → college/draft lookup from players_df
# NB: nfl_data_py's import_players() calls the overall-pick column
# "draft_pick", not "draft_number" — that mismatch meant draft_number was
# silently never populated for anyone (all 6,644 players had it NULL).
META_COLS  = ['gsis_id', 'college_name', 'draft_year', 'draft_round', 'draft_pick']
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
    if 'draft_pick'    in meta_avail and pd.notna(r.get('draft_pick')):
        entry['draft_number'] = int(r['draft_pick'])
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
new_modern = seasonal_modern[~seasonal_modern["player_id"].isin(existing_ids)][
    ["player_id", "player_display_name", "position"]
].drop_duplicates(subset="player_id")
new_modern = new_modern.rename(columns={"player_display_name": "display_name"})
# newest season entrants still have a birth date in the players file, pull it in
# instead of leaving it null or their birth year fact never builds
new_modern = new_modern.merge(
    players_df[["gsis_id", "birth_date"]],
    left_on="player_id", right_on="gsis_id", how="left"
).drop(columns=["gsis_id"])

all_players = pd.concat([unique_old, new_modern], ignore_index=True).dropna(subset=["display_name"])

def birth_year_of(value):
    if value is None:
        return None
    text = str(value)
    if not text or text == "nan":
        return None
    try:
        year = int(text[:4])
    except ValueError:
        return None
    # guards against placeholder dates in the source
    return year if 1900 <= year <= 2015 else None


player_id_map = {}
player_rows   = []
for _, row in all_players.iterrows():
    birth_year = birth_year_of(row["birth_date"])
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
          birth_year   = COALESCE(EXCLUDED.birth_year, players.birth_year),
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

# any player the merges missed still has a birth date in the players file, so
# fill the gaps directly rather than leaving their birth year fact unavailable
birth_by_id = {}
for gsis_id, birth_date in zip(players_df["gsis_id"], players_df["birth_date"]):
    year = birth_year_of(birth_date)
    if gsis_id and year:
        birth_by_id[str(gsis_id)] = year

cur.execute("SELECT nfl_id FROM players WHERE birth_year IS NULL AND nfl_id IS NOT NULL")
gaps = [(nfl_id, birth_by_id[str(nfl_id)])
        for (nfl_id,) in cur.fetchall() if str(nfl_id) in birth_by_id]
if gaps:
    execute_values(cur, """
        UPDATE players AS p SET birth_year = v.birth_year
        FROM (VALUES %s) AS v(nfl_id, birth_year)
        WHERE p.nfl_id = v.nfl_id
    """, gaps, template="(%s, %s::int)")
    conn.commit()

cur.execute("SELECT COUNT(*), COUNT(birth_year) FROM players")
total_players, with_birth = cur.fetchone()
print(f"  birth years: {with_birth}/{total_players} ({len(gaps)} backfilled)")

# ════════════════════════════════════════════════════════════════════════════════
# 4 — Season rows HISTORY_START–NFLDATAPY_MAX_SEASON  (passing / receiving / pro_bowl)
# ════════════════════════════════════════════════════════════════════════════════
print(f"\n── 4. Inserting player seasons ({HISTORY_START}–{NFLDATAPY_MAX_SEASON}) ──")
print("  Building team map from weekly data...")
weekly   = nfl.import_weekly_data(list(range(HISTORY_START, NFLDATAPY_MAX_SEASON + 1)), columns=['player_id', 'season', 'recent_team'])
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
# 5 — Season rows past nfl_data_py's ceiling
# ════════════════════════════════════════════════════════════════════════════════
print(f"\n── 5. Inserting player seasons ({'/'.join(map(str, MODERN_SEASONS))}) ──")
season_rows_modern = []
for _, row in seasonal_modern.iterrows():
    db_id = player_id_map.get(row["player_id"])
    if not db_id:
        continue
    season_rows_modern.append((
        db_id, str(row.get("recent_team")) if row.get("recent_team") else None, int(row["season"]),
        round(float(row["fantasy_points_ppr"] or 0), 1),
        safe_int(row, "rushing_yards"),
        safe_int(row, "receiving_tds"),
        safe_int(row, "sacks"),
        None, None, None, None, False,  # passing/receiving not in nflreadpy weekly agg
    ))

if season_rows_modern:
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
    """, season_rows_modern)
    conn.commit()
print(f"  {len(season_rows_modern)} rows upserted")

# ════════════════════════════════════════════════════════════════════════════════
# 6 — PFR defensive stats
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
schedules  = nfl.import_schedules(list(range(1999, CURRENT_SEASON + 1)))
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

# Pass 2 — roster-based match for 1999+ (catches defenders/ST with NULL team,
# and upserts a season row for anyone on the winning roster who doesn't
# already have one for that year — e.g. a player whose only tracked seasons
# are elsewhere in their career).
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
            execute_values(cur, """
                INSERT INTO player_seasons (player_id, team, season_year, super_bowl_winner)
                VALUES %s
                ON CONFLICT (player_id, season_year) DO UPDATE
                  SET super_bowl_winner = true,
                      team = COALESCE(player_seasons.team, EXCLUDED.team)
            """, [(db_id, team, yr, True) for db_id in db_ids])

# Pass 3 — manual overrides for pre-1999 defenders / known gaps
# Upserts a season row if missing, then sets the flag.
SB_PLAYER_OVERRIDES = [
    # (player_name, season_year, team)
    ("Deion Sanders",   1994, "SF"),   # SF 49ers, SB XXIX
    ("Deion Sanders",   1995, "DAL"),  # DAL Cowboys, SB XXX
]
for name, yr, team in SB_PLAYER_OVERRIDES:
    cur.execute("SELECT id FROM players WHERE name ILIKE %s", (name,))
    rows = cur.fetchall()
    if len(rows) != 1:
        if len(rows) > 1:
            print(f"  SKIPPED ambiguous override {name} ({yr}): candidate ids {[r[0] for r in rows]}")
        continue
    row = rows[0]
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
mvp_ambiguous = []
for season, name in {**AP_MVP, **AP_MVP_EXTRA}.items():
    # Exact full-name match — a last-name substring match (the old behavior)
    # would flag every player sharing that surname, not just the real winner.
    # Two real players can still share an exact full name (e.g. two different
    # "Josh Allen"s both had a 2024 season row), so check for that rather than
    # blindly flagging every name match — that already mis-credited a 2024
    # MVP to an unrelated Josh Allen.
    cur.execute("""
        SELECT p.id FROM player_seasons ps
        JOIN players p ON p.id = ps.player_id
        WHERE ps.season_year = %s AND p.name ILIKE %s
    """, (season, name))
    ids = [r[0] for r in cur.fetchall()]
    if len(ids) == 1:
        cur.execute("UPDATE player_seasons SET ap_mvp = true WHERE player_id = %s AND season_year = %s", (ids[0], season))
    elif len(ids) > 1:
        mvp_ambiguous.append((season, name, ids))
conn.commit()
print("  ap_mvp updated")
if mvp_ambiguous:
    print(f"  SKIPPED {len(mvp_ambiguous)} ambiguous name match(es) — resolve manually:")
    for season, name, ids in mvp_ambiguous:
        print(f"    {season} {name}: candidate player ids {ids}")

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
heisman_ambiguous = []
for year, name in HEISMAN.items():
    # Exact full-name match — a last-name substring match (the old behavior)
    # stamped heisman_year onto every player sharing that surname (e.g. every
    # "Williams" got 1998 from Ricky Williams), and its heisman_year IS NULL
    # guard meant the true winner could get locked onto a false year by an
    # earlier, wrongly-matching entry and never self-correct. Two real players
    # can still share an exact full name (two different "Ricky Williams"es,
    # two different "Lamar Jackson"s) — skip and flag those rather than
    # guessing which one actually won.
    cur.execute("SELECT id FROM players WHERE name ILIKE %s AND heisman_year IS NULL", (name,))
    ids = [r[0] for r in cur.fetchall()]
    if len(ids) == 1:
        cur.execute("UPDATE players SET heisman_year = %s WHERE id = %s", (year, ids[0]))
        count += 1
    elif len(ids) > 1:
        heisman_ambiguous.append((year, name, ids))
conn.commit()
print(f"  {count} players updated")
if heisman_ambiguous:
    print(f"  SKIPPED {len(heisman_ambiguous)} ambiguous name match(es) — resolve manually:")
    for year, name, ids in heisman_ambiguous:
        print(f"    {year} {name}: candidate player ids {ids}")

# ════════════════════════════════════════════════════════════════════════════════
# 10. Jersey numbers (most recent season on record)
# ════════════════════════════════════════════════════════════════════════════════
print("\n── 10. Jersey numbers ──")
current_roster = nfl.import_seasonal_rosters([CURRENT_SEASON])
jersey_rows = (
    current_roster[["player_id", "jersey_number"]]
    .dropna()
    .drop_duplicates("player_id")
)
jersey_count = 0
for _, row in jersey_rows.iterrows():
    db_id = player_id_map.get(row["player_id"])
    if not db_id:
        continue
    cur.execute("UPDATE players SET jersey_number = %s WHERE id = %s", (int(row["jersey_number"]), db_id))
    jersey_count += 1
conn.commit()
print(f"  {jersey_count} players updated")

# ════════════════════════════════════════════════════════════════════════════════
# 11 — (removed) Awards from import_awards()
#      nfl_data_py.import_awards() doesn't exist in the pinned version (0.3.2)
#      and never has across any version checked — this always hit an
#      AttributeError and silently no-opped, so player_seasons.ap_allpro_first
#      and .pro_bowl are permanently stuck at their false default, and
#      player_awards never gets OPOY/DPOY/OROY/DROY/CPOY rows either.
#      All of that data now comes from public/awards.csv instead — see
#      scripts/scrape_awards.py (footballdb.com for those awards, Wikipedia
#      for Pro Bowl) and api/puzzle.js's lookupAwards().
# ════════════════════════════════════════════════════════════════════════════════

cur.close()
conn.close()
print("\n════ All done! ════")

"""
Backfills players.headshot_url from nfl_data_py, matched on gsis_id (players.nfl_id).
Only revealed to the client after a puzzle is submitted — see api/index.js withReveal().

Run:
  python3 scripts/load_headshots.py
"""

import os
import nfl_data_py as nfl
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in .env")

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("── Schema migration ──")
cur.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS headshot_url TEXT")
conn.commit()
print("  Done")

print("\n── Fetching headshots from nfl_data_py ──")
df = nfl.import_players()
df = df[df["gsis_id"].notna() & df["headshot"].notna()]
pairs = list(zip(df["gsis_id"], df["headshot"]))
print(f"  {len(pairs)} players with a headshot URL available")

print("\n── Updating players table ──")
execute_values(cur, """
    UPDATE players AS p SET headshot_url = data.headshot_url
    FROM (VALUES %s) AS data(nfl_id, headshot_url)
    WHERE p.nfl_id = data.nfl_id
""", pairs)
conn.commit()

cur.execute("SELECT COUNT(*) FROM players WHERE headshot_url IS NOT NULL")
print(f"  {cur.fetchone()[0]} players now have a headshot_url")

cur.close()
conn.close()

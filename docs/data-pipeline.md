# Data

## Tables

- `players` - one row per player (name, position, college, draft info, jersey, headshot)
- `player_seasons` - one row per player per season (team + stats)
- `daily_puzzles` - the saved puzzle for each day
- `users` - accounts
- `user_results` - everyone's scores
- `puzzle_progress` - lie guesses for a puzzle you haven't finished yet

Film Room has its own three tables too (see [filmroom.md](filmroom.md)), and Logo Lineup has two (see [lineup.md](lineup.md)).

The API creates everything except `players` and `player_seasons` itself when it starts. Those two were made by hand, so there's no script in the repo that creates them.

## Where the data comes from

- **Stats up to 2024:** `nfl_data_py`
- **Stats from 2025 on:** `nflreadpy`. `nfl_data_py` stopped working after 2024 (404 errors).
- **Awards** (Pro Bowl, All-Pro, OPOY, Hall of Fame, etc): `scripts/scrape_awards.py` scrapes these into `public/awards.csv`
- **MVP and Heisman:** typed out by hand in `load_data.py`
- **Headshots:** `scripts/load_headshots.py`
- **Film Room answers:** `scripts/build_team_seasons.py` makes `api/data/team_seasons.json`. This one isn't in the database and doesn't need updating every week.
- **Logo Lineup logos:** `scripts/build_logo_teams.py` and `scripts/build_old_logos.py` make `api/data/logo_teams.json` and `api/data/old_logos.json` and download the images. Same deal, not in the database, only rerun when teams change logos.

## load_data.py

There are three ways to run it:

```bash
python3 scripts/load_data.py                    # full reload, takes a while
python3 scripts/load_data.py --rosters-only     # just this season's rosters
python3 scripts/load_data.py --current-season   # rosters + this season's stats
```

- **Full reload** - once a year after the season ends.
- **`--rosters-only`** - at the start of a new season. The puzzle only picks players from the newest season in the database. If I only loaded stats after week 1, only the ~67 guys who had played would count.
- **`--current-season`** - every week. The cron job does this automatically (Tuesdays 12:00 UTC).

The current season is set by `CURRENT_SEASON` at the top of `load_data.py`.

## Yearly checklist

**Start of the season (September)**

1. Change `CURRENT_SEASON` in `scripts/load_data.py` and `LATEST_SEASON` in `api/puzzle.js`
2. Run `--rosters-only`
3. Run `load_headshots.py` so rookies have pictures

**During the season**

Nothing, the cron job does it.

**After the Super Bowl (February)**

1. Add the new MVP and Heisman winner in `load_data.py`
2. Update `END` in `scrape_awards.py`, run it, commit the csv, and redeploy the API
3. Run the full `load_data.py`
4. Run `load_headshots.py`
5. Bump `LAST_SEASON` in `scripts/build_team_seasons.py`, run it, and commit `api/data/team_seasons.json` so the season that just ended can be a Film Room answer

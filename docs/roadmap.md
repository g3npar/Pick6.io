# Roadmap

## Features I want to add

### Yearbook (new game mode)

**Status:** planned, not started

**Idea:** Pick 6 is hard if you don't know a lot of players, so this mode is for more casual fans. You guess an NFL team **and** a season (like "2015 Seahawks") from clues that get easier as you go:

1. Record and point differential
2. How far they got in the playoffs
3. Head coach
4. Starting QB
5. Team colors

**Scoring:** 3 points for the team and 3 for the year (2 if you're 1 year off, 1 if you're 2 years off).

**Data:** all of it comes from `nfl_data_py.import_schedules()`, which I already use. It goes back to 1999.

**Things to figure out:**

- Which seasons to use as answers. Playoff teams + 12 win teams gives about 300 seasons, which is around 10 months of daily puzzles.
- Use the QB who started most of the regular season, not the playoff one. Otherwise the 2014 Cardinals answer is Ryan Lindley.
- Teams that moved (St. Louis Rams, San Diego Chargers, Oakland Raiders) need their old names, and I only have current logos.
- How to show Washington's old name.
- How the "fewer clues = more points" idea fits with the 3 + 3 scoring.

**Before I can build it:**

- Add a `mode` column to `user_results` and `puzzle_progress`. Right now there can only be one result per user per day, and the leaderboard adds everything together.
- Rename "Daily" in the nav to "Pick 6".

### New feature template

```markdown
### Feature name

**Status:**
**Idea:**
**How it works:**
**Things to figure out:**
```

## Known bugs / stuff to clean up

- **2025+ stats are incomplete.** For seasons that come from `nflreadpy`, the loader never saves passing yards, passing TDs, or receiving yards. The weekly job also looks for a `sacks` column that's actually called `def_sacks`, so it saves sacks as empty every week.
- **Old API routes leak answers.** `/puzzle/today`, `/puzzle/generate`, `/puzzle/player`, and `?fresh` send back the answers. The site doesn't use them, so delete them.
- **New players don't get headshots automatically.** The cron job doesn't run `load_headshots.py`.
- **No script to create `players` / `player_seasons`**, so I can't rebuild the database from scratch.
- **`render.yaml` is outdated** and Render ignores it anyway.
- **The season year is hardcoded in three places**: `load_data.py`, `api/puzzle.js`, and `scrape_awards.py`.

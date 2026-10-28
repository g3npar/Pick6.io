# Architecture

There are basically four parts:

- **Frontend** (`src/`) - React + Vite, hosted on Vercel. There's no router, `App.jsx` just keeps track of which screen you're on.
- **API** (`api/`) - Express server on Render.
  - `index.js` has all the routes
  - `puzzle.js` has the puzzle logic and the database connection
  - `auth.js` handles Google sign in and sessions
  - `filmroom.js` is everything for Film Room, the second game (see [filmroom.md](filmroom.md))
  - `lineup.js` is everything for Logo Lineup, the third game (see [lineup.md](lineup.md))
  - `percentile.js` is the "Top X%" for each day (see below)
  - `bugs.js` saves bug reports
- **Database** - Postgres on AWS RDS.
- **Scripts** (`scripts/`) - Python scripts that pull NFL data into the database. One of them runs every week on a Render cron job.

## How the daily puzzle works

This is for Pick 6. Film Room and Logo Lineup work the same way but load their own puzzles (`/filmroom/today` and `/lineup/day`), so they still work even if Pick 6 doesn't load.

1. The site calls `GET /puzzle/today/current`.
2. The API checks if it already has today's puzzle in memory. If not, it checks the `daily_puzzles` table.
3. If there's nothing in the table yet, it generates the puzzle and saves it. After that the puzzle for that day never changes.
4. Before sending it back, `withReveal()` strips out the answer (player name, which fact is the lie, headshot, etc.) so you can't just look at the network tab.
5. The answer only gets sent once you finish that part of the puzzle.

"Today" is based on Eastern time, so a new puzzle comes out at midnight ET.

## Signed in vs not signed in

- **Not signed in:** you can play, but your result isn't saved (just your score for the percentile, see below). After you finish it asks you to sign in once.
- **Signed in:** your guesses are tracked on the server (so refreshing doesn't reset your attempts), and your result is saved to your profile.

Either way, your in-progress game is saved in `sessionStorage` so a refresh doesn't wipe it.

## Top X% instead of a leaderboard

There's no leaderboard anymore. An all-time total just rewarded whoever played the most (or binged the archive), so now each results screen says something like "Top 12% today, out of 340 players", and your profile's per day stats show it too (the share text doesn't).

- Every finished game goes in the `day_scores` table, signed in or not, but **only if you finished it on the puzzle's own day**. Archive plays don't count, though you still see where you would have placed.
- Signed out players are counted by a random ID their browser makes (`pick6_anon_id` in localStorage), so refreshing doesn't count you twice. Clearing your browser or switching devices would, which is fine.
- Ties share the best spot. Top % is `(people who beat you + 1) / (everyone including you)`, so if 3 people played and you tied for first you're Top 33%.
- When the API starts it copies in old signed in results that were finished on their own day, so days from before this still have numbers.
- It's live, so your top % can change during the day as more people play.

## Getting people to the other games

- On phones the header nav is hidden, so there's a row of three game tabs (Pick 6 | Logo Lineup | Film Room) under the header. Archive and the rest are still in the ▾ menu by the logo.
- Today's results screen in each game has an "Up next" button (`src/components/UpNext.jsx`) pointing at a game you haven't finished today, in the order Pick 6 → Logo Lineup → Film Room. Which games you've finished is kept in localStorage (`pick6_played_today`), so it's per browser. Once you've done all three it says so instead. Archive days don't show it.

## Bug reports

The footer has a "Report a bug" link that opens a little form (which game, what happened, and an optional email if you're signed out). Reports go in the `bug_reports` table and show up at the bottom of the Admin page.

## Keeping the first load fast

A puzzle used to take about 1.4 seconds to show up, mostly from things happening one after another. Now it's about 0.9 (measured with a fake 300ms API on a normal connection).

- **Fonts are ours.** Inter and Anton live in `public/fonts/` with the `@font-face` rules at the top of `src/index.css`. Google Fonts' stylesheet used to hold up the app's JavaScript (browsers wait for stylesheets before running scripts), which pushed back every puzzle request.
- **The API requests start early.** A small plugin in `vite.config.js` adds a `preconnect` to the API and preloads `/puzzle/today/current` and `/auth/me` in `index.html`, so they run while the JavaScript downloads. The app's own fetches reuse them, which only works if they match exactly, so if you change how `App.jsx` fetches those two (like dropping `credentials: 'include'`), change the plugin too. It uses `VITE_API_URL`, same as the app.

## Heads up

- The "Share Result" text for all three games comes from `src/utils/share.js` (title, one line per part with squares for attempts, total, link), so if you change the format, change it there and all three stay matching.

- There are two "epoch" dates. `EPOCH` in `api/puzzle.js` is used to generate puzzles, so **don't change it** or every future puzzle changes. `PUZZLE_EPOCH` in `GameBoard.jsx` is just for the "Pick 6 #N" number, and `PICK6_START` in `api/index.js` has to match it (it's the first day the archive and API allow). All three games launched with #1 on 2026-10-22.
- `public/awards.csv` only gets read when the API starts, so redeploy after updating it.
- The database pool in `api/puzzle.js` needs its `pool.on('error')` handler. RDS sometimes drops idle connections, and without it that crashes the whole API, which shows up in the browser as "Failed to fetch". Logo Lineup's requests also retry once if they can't reach the server.

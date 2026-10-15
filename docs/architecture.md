# Architecture

There are basically four parts:

- **Frontend** (`src/`) - React + Vite, hosted on Vercel. There's no router, `App.jsx` just keeps track of which screen you're on.
- **API** (`api/`) - Express server on Render.
  - `index.js` has all the routes
  - `puzzle.js` has the puzzle logic and the database connection
  - `auth.js` handles Google sign in and sessions
  - `filmroom.js` is everything for Film Room, the second game (see [filmroom.md](filmroom.md))
  - `lineup.js` is everything for Logo Lineup, the third game (see [lineup.md](lineup.md))
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

- **Not signed in:** you can play, but your result isn't saved. After you finish it asks you to sign in once.
- **Signed in:** your guesses are tracked on the server (so refreshing doesn't reset your attempts), and your result is saved for the leaderboard.

Either way, your in-progress game is saved in `sessionStorage` so a refresh doesn't wipe it.

## Keeping the first load fast

A puzzle used to take about 1.4 seconds to show up, mostly from things happening one after another. Now it's about 0.9 (measured with a fake 300ms API on a normal connection).

- **Fonts are ours.** Inter and Anton live in `public/fonts/` with the `@font-face` rules at the top of `src/index.css`. Google Fonts' stylesheet used to hold up the app's JavaScript (browsers wait for stylesheets before running scripts), which pushed back every puzzle request.
- **The API requests start early.** A small plugin in `vite.config.js` adds a `preconnect` to the API and preloads `/puzzle/today/current` and `/auth/me` in `index.html`, so they run while the JavaScript downloads. The app's own fetches reuse them, which only works if they match exactly, so if you change how `App.jsx` fetches those two (like dropping `credentials: 'include'`), change the plugin too. It uses `VITE_API_URL`, same as the app.

## Heads up

- There are two "epoch" dates. `EPOCH` in `api/puzzle.js` is used to generate puzzles, so **don't change it** or every future puzzle changes. `PUZZLE_EPOCH` in `GameBoard.jsx` is just for the "Pick 6 #N" number.
- `public/awards.csv` only gets read when the API starts, so redeploy after updating it.

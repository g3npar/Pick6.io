# Architecture

There are basically four parts:

- **Frontend** (`src/`) - React + Vite, hosted on Vercel. There's no router, `App.jsx` just keeps track of which screen you're on.
- **API** (`api/`) - Express server on Render.
  - `index.js` has all the routes
  - `puzzle.js` has the puzzle logic and the database connection
  - `auth.js` handles Google sign in and sessions
- **Database** - Postgres on AWS RDS.
- **Scripts** (`scripts/`) - Python scripts that pull NFL data into the database. One of them runs every week on a Render cron job.

## How the daily puzzle works

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

## Heads up

- There are two "epoch" dates. `EPOCH` in `api/puzzle.js` is used to generate puzzles, so **don't change it** or every future puzzle changes. `PUZZLE_EPOCH` in `GameBoard.jsx` is just for the "Daily #N" number.
- `public/awards.csv` only gets read when the API starts, so redeploy after updating it.

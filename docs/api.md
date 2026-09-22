# API

All the routes are in `api/index.js`. Logging in sets a `session` cookie.

## Puzzle stuff

| Route | What it does |
|---|---|
| `GET /puzzle/today/current` | Today's puzzle (without the answers) |
| `GET /puzzle/date/:date` | A past puzzle from the archive |
| `POST /puzzle/guess-lie` | Checks your guess for the lie |
| `POST /puzzle/result` | Submits your player guess and gets your score. The server calculates the score itself so you can't fake it. |
| `GET /puzzle/archive` | List of past puzzles and whether you've done them |
| `GET /puzzle/portrait/:token` | The player's headshot for the reveal |
| `GET /players/search?q=` | Player name autocomplete |
| `GET /leaderboard` | Top 50 players by total score |

## Account stuff

| Route | What it does |
|---|---|
| `POST /auth/google` | Sign in with Google |
| `POST /auth/logout` | Sign out |
| `GET /auth/me` | Who's signed in |
| `PUT /auth/username` | Change your username |
| `DELETE /auth/account` | Delete your account and all your results |

## Admin stuff

Only works if your email is in `ADMIN_EMAILS`.

| Route | What it does |
|---|---|
| `GET /admin/puzzles` | Shows the puzzles for the next 14 days |
| `POST /admin/preview` | Makes a new puzzle to look at (doesn't save it) |
| `POST /admin/preview/lie` | Changes which fact is the lie |
| `POST /admin/preview/regenerate` | New set of facts for the same player |
| `POST /admin/preview/alternatives` | Gets other facts you could swap in |
| `POST /admin/preview/swap` | Swaps a fact |
| `POST /admin/set` | Saves a puzzle for a future date |

## Old routes (should delete)

`/puzzle/today`, `/puzzle/generate`, `/puzzle/player`, and `/puzzle/today/current?fresh` are left over from an older version. The site doesn't use them, and they send back the answers, so I should get rid of them.

Rate limiting is only on in production (60 requests/min overall, stricter for login and puzzle generation).

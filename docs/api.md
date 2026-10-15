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
| `GET /leaderboard` | Top 50 Pick 6 players by total score |

## Film Room stuff

| Route | What it does |
|---|---|
| `GET /filmroom/today` | Today's Film Room puzzle (hidden clues stay hidden) |
| `GET /filmroom/date/:date` | A past Film Room puzzle from the archive |
| `GET /filmroom/archive` | Every past Film Room day, with your score if you played it |
| `POST /filmroom/guess-team` | Checks your team guess and flips the next clue if you miss |
| `POST /filmroom/result` | Submits your year guess and gets your score |
| `GET /filmroom/leaderboard` | Top 50 Film Room players by total score |

## Logo Lineup stuff

| Route | What it does |
|---|---|
| `POST /lineup/day` | Today's logos, or an archive day if you send a date. Signed out players send the progress their browser kept. |
| `POST /lineup/guess` | Checks a guess on one logo and zooms out if you miss, or gives up on just that logo |
| `GET /lineup/archive` | Every past Logo Lineup day, with your score if you finished it |
| `GET /lineup/leaderboard` | Top 50 Logo Lineup players by total score |

## Account stuff

| Route | What it does |
|---|---|
| `POST /auth/google` | Sign in with Google |
| `POST /auth/logout` | Sign out |
| `GET /auth/me` | Who's signed in |
| `PUT /auth/username` | Change your username |
| `GET /auth/history?end=&days=` | Your finished games from all three, grouped by day, for the "Per day stats" on your profile. Comes 14 days at a time ending on `end` (today by default), with each game's first day so days before a game launched don't show it. Paging stops at Pick 6 #1 |
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

`GET /health` just returns `{ ok: true }` so Render can check the server is up.

Rate limiting is only on in production (60 requests/min overall, stricter for login).

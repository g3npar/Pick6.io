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

## Film Room stuff

| Route | What it does |
|---|---|
| `GET /filmroom/today` | Today's Film Room puzzle (hidden clues stay hidden) |
| `GET /filmroom/date/:date` | A past Film Room puzzle from the archive |
| `GET /filmroom/archive` | Every past Film Room day, with your score if you played it |
| `POST /filmroom/guess-team` | Checks your team guess and flips the next clue if you miss |
| `POST /filmroom/result` | Submits your year guess and gets your score |
| `POST /filmroom/claim` | Saves a game you played signed out to your account after you sign in (only if you have nothing for that day) |

## Logo Lineup stuff

| Route | What it does |
|---|---|
| `POST /lineup/day` | Today's logos, or an archive day if you send a date. Signed out players send the progress their browser kept, and if you just signed in with nothing saved for the day, that game gets saved to your account. |
| `POST /lineup/guess` | Checks a guess on one logo and zooms out if you miss, or gives up on just that logo |
| `GET /lineup/archive` | Every past Logo Lineup day, with your score if you finished it |

## Percentiles and bug reports

| Route | What it does |
|---|---|
| `GET /percentile?game=&date=&score=&anonId=` | Where a score places among everyone who finished that game on its day: `{ top, players }`, so `top: 12` means "Top 12%". `top` is `null` if nobody else has played yet. You're left out of the count (by your account, or `anonId` if you're signed out) |
| `POST /bugs` | Sends a bug report from the "Report a bug" page: `{ game, message, contact? }`. Uses the stricter login rate limit so it can't be spammed |

## Account stuff

| Route | What it does |
|---|---|
| `POST /auth/google` | Sign in with Google |
| `POST /auth/logout` | Sign out |
| `GET /auth/me` | Who's signed in |
| `PUT /auth/username` | Change your username |
| `GET /auth/history?end=&days=` | Your finished games from all three, grouped by day, each with your top % for that day, for the "Per day stats" on your profile. Comes 14 days at a time ending on `end` (today by default), with each game's first day so days before a game launched don't show it. Paging stops at Pick 6 #1 |
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
| `POST /admin/shuffle-week` | Picks new random players for the next 7 Pick 6 days and saves them right away (no repeats, today never changes). The "Shuffle next 7 days" button on the Admin page |
| `GET /admin/bugs` | The newest 100 bug reports |
| `GET /admin/stats` | Today's players and average score per game, finishes per hour, the last 7 days, and account and bug report counts (all from `day_scores`) |

`GET /health` just returns `{ ok: true }` so Render can check the server is up.

Rate limiting is only on in production (60 requests/min overall, stricter for login and bug reports). It counts by the player's real IP from the `CF-Connecting-IP` header, because Render's edge is Cloudflare and `req.ip` can be a Cloudflare server that lots of players share.

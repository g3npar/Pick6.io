# Film Room

The second daily game. You get six clues about one team's season and have to guess the team and the year (like "2010 Giants"). It's meant for more casual fans, since you don't need to know a bunch of players. The name is because you're basically breaking down old game film.

All the code is in `api/filmroom.js` and `src/components/FilmRoomBoard.jsx`.

## How it plays

The board looks like a coach's play call sheet. It has six clue rows, hardest to easiest, and the middle row is where you guess:

1. record, plus where they finished in their division and conference
2. how far they got in the playoffs
3. top receiver
4. top rusher
5. head coach
6. starting QB

Rows 1-3 sit above the middle row and 4-6 below it. Only the record and playoffs start face up. I used to show the receiver and rusher too, but those two names pointed to exactly one team 99% of the time, so it was way too easy.

- **Round 1, the team:** you get 3 attempts. The first miss flips the top receiver, the second flips the top rusher. Getting it on the 1st attempt is 3 points, 2nd is 2, 3rd is 1. Guessing a team you already missed doesn't use up an attempt. The coach and QB never show during this round.
- **Round 2, the year:** every clue is showing now, no matter how round 1 went (otherwise you could miss on purpose to see more clues). The exact year is 3 points, 1 year off is 1. 2 years off used to get a point too, but just guessing the middle of a QB's time with the team was getting people almost 2 points without really knowing.

Max is 6, same as Pick 6. Score 0 and it's a Pick 6, the result box says so like it does in Pick 6.

You pick the team from a grid of all 32 teams laid out by division, and the year from a grid of every season, so there's no scrolling. Teams are franchises, so "Rams" counts for a St. Louis Rams season. During the year round the team shows up under its current name, because the old name would give away the year ("St. Louis Rams" means 2015 or earlier). The real name for that season only shows at the end.

## The final screen

The middle row shows what you guessed, with a green ✓ after the year and the team name if you got them right and a red ✗ if you didn't, same as Pick 6. A right team gets the logo it actually used that season (so the 2005 Chargers get the old San Diego bolt).

If you got the team or the year wrong, it says "You guessed" above it. Your guessed team is the last one you picked. Then a "Show Correct Answer" button next to the score table swaps in the real answer and its era logo. If you gave up there's no guess to show, so it goes straight to the answer.

Washington before 2020 doesn't get a logo, same reason as the name.

## Which seasons can be the answer

Seasons from 2002 to 2025 that people actually remember:

- teams that made the playoffs
- teams that won 10+ games but still missed
- teams that won 2 or fewer (the 0-16 Lions, 0-16 Browns, etc)

That's 337 seasons, so about 11 months before anything repeats. The rule is `isNotable` in `api/filmroom.js`. It starts at 2002 because that's when the NFL went to 32 teams and the current 8 divisions, so every season matches the team picker, and it's where nflverse's standings data starts.

Washington shows as just "Washington" before 2020, "Washington Football Team" for 2020-21, and "Washington Commanders" after that.

## The data

It's all in `api/data/team_seasons.json`, made by `scripts/build_team_seasons.py` from `nfl_data_py` schedules and weekly stats (2025 on comes from `nflreadpy`, same as Pick 6's loader). It's history so it doesn't change, I only need to rerun the script to add a new season. The API figures out the year range from the file. It's not in the database.

- The coach and QB are whoever had the most regular season games. That way an interim coach or a backup QB who started one playoff game doesn't end up as the clue.
- The division and conference finish come from nflverse's standings file, so they use the NFL's real tiebreakers. The clue says "1st in division", not "1st in AFC West", since naming the division would narrow the team down to 4. Conference finish is the playoff seed, so teams that missed the playoffs only get their division finish.
- If two players tie for the most yards (it happens, Barkley and Booker both had 593 in 2021), the one with fewer games wins since he was the one actually getting the ball.
- Each season also has a `logo`, the file name of that era's logo in `public/logos/nfl/eras/` (like `LAC-2002.webp`). I downloaded the 70 logos from sportslogos.net. Which logo goes with which years is the `LOGO_ERAS` list in the build script, each year there is the first season a logo was used. When a team gets a new logo, add the year there and drop the image in that folder.
- The weekly stats use current team abbreviations even for old seasons (the 2001 Rams show up as `LA`), so the script matches everything by franchise.

## How the daily answer gets picked

It goes through every answer once in a shuffled order before repeating, and the same team never shows up two days in a row. The first time someone opens Film Room each day, that day's puzzle gets saved in `filmroom_puzzles` and doesn't change after that.

The shuffle is based on `FILMROOM_SECRET` (or `JWT_SECRET` if that isn't set). The repo is public, so without a secret anyone could run the code and see every future answer. Changing the secret changes future puzzles, but not ones that were already played.

`FILMROOM_EPOCH` in `api/filmroom.js` is the first day, which is Film Room #1.

## Generate puzzle button

For testing there's a "Generate puzzle" button that loads a random practice puzzle. It only exists in the dev build, it's not in the real site at all, and the `/filmroom/practice` route is turned off in production. Practice games are never saved. The puzzle comes with an encrypted token instead of the answer, so the network tab doesn't give it away.

## Archive, leaderboard and rules

Pick 6 and Film Room are both tabs in the nav. Archive and Leaderboard are one tab each with a Pick 6 / Film Room switch at the top, and they open on whichever game you were last on. There's no How to Play page anymore, each game has an "i" button next to its puzzle number that pops up its rules (both games' rules are in `src/components/HowToPlay.jsx`). The Film Room board is `GET /filmroom/leaderboard`, same top 50 by total score as Pick 6, just reading `filmroom_results`.

The Film Room archive lists every day from #1 up to yesterday. Since the answer for any day comes from the shuffle, old days don't need to have been saved ahead of time, the puzzle gets saved the first time someone opens it. You can play any past day as long as it's not before #1 or in the future, and signed in results save under that day. Signed out games are kept in the browser per day, so playing an old one doesn't wipe today's.

## Tables

- `filmroom_puzzles` - the saved puzzle for each day
- `filmroom_results` - everyone's Film Room scores, plus the teams they missed so the final screen still shows them after a refresh
- `filmroom_progress` - team guesses for a game you haven't finished yet

These are separate from the Pick 6 tables, so nothing about Pick 6 had to change. They get deleted along with a user's account.

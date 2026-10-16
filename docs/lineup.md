# Logo Lineup

The third daily game, for really casual fans. You get six logos zoomed way in and have to name the teams. You don't need to know any players, just logos.

All the code is in `api/lineup.js` and `src/components/LineupBoard.jsx`.

## How it plays

Every day has six logos:

1. an NFL team
2. an NBA team
3. an MLB team
4. an NHL team
5. a college team (Power 4 conferences plus Notre Dame, 68 schools)
6. an old logo from any of those, like the old Seahawks or the San Diego Chargers bolt

The first five are always the team's current logo. You see each one zoomed in 5x, and you type the team into a search box that only has that league's teams. You get 3 attempts per logo. Each miss zooms out (5x, then 3x, then the whole logo on your last attempt), and after the third miss it shows the answer. Guessing a team you already missed on that logo doesn't use an attempt.

You can play the logos in any order with the tabs at the top. Each logo is worth 1 point, minus 0.25 for every miss before you get it (1, 0.75 or 0.5), and 0 if you don't get it. So the max is still 6 like the other games, scores can be things like 4.75, and 0 is a Pick 6. Scores show without trailing zeros (5.5, not 5.50), and `lineup_games.score` is a `NUMERIC(4,2)` instead of a whole number. Games saved under the old whole-logo scoring get rescored from their attempts when the API starts. Give Up (next to the search box) only gives up on the logo you're looking at, it shows the answer and the other logos stay playable.

For the old logo, the answer is the team today, so an old Oakland Raiders logo is just the Raiders. The reveal shows the old name and years too.

## Keeping the answer hidden

The browser never gets a full logo until that logo is done. The server cuts the zoomed crop itself (with `sharp`) and sends it as an image inside the response, and it only sends the zoom level you've earned. The full logo files are public, but the browser only learns which file it is once you're done with that logo.

Where the crop is centered is picked per day from the parts of the logo that aren't transparent, so it never lands on empty space.

Cutting the crops is slow, about a second per logo on Render, so the first person to open a day used to wait 5-6 seconds (and again after every deploy, since the crops only lived in memory). Now every crop gets saved in `lineup_crops` the first time it's cut, and `warmLineup()` cuts today's and tomorrow's ahead of time when the API starts and every 30 minutes after, then fills in any archive days that are missing some. So opening a puzzle is just reading saved images. If you ever delete a day from `lineup_puzzles`, delete its `lineup_crops` rows too, or the old crops stick around for the new puzzle.

Current logos are SVGs, so the server draws them at 1600px before cutting the crop and even 5x stays sharp. Most official SVGs have a ™ or ® in a corner, which would show up in a crop, so the server erases small shapes that sit on their own along the bottom of the logo first (`eraseMarks` in `api/lineup.js`). The full logo you see at the end still has them. Old logos only exist as pictures (around 900px), so they don't zoom in past the point where the picture would get stretched and blurry.

## How the daily logos get picked

Same idea as Film Room. Each league goes through all its teams in a shuffled order before any repeat, and the shuffle is keyed off `LINEUP_SECRET` (or `JWT_SECRET`) so the public repo doesn't give away future answers. The old logo rotates through the leagues so each one gets it once every five days. Otherwise it'd be college over a third of the time, since college has the most old logos and they're the most obscure. It also can't be the same team as that day's logo from the same league. The first time someone opens a day, it gets saved in `lineup_puzzles` so it never changes after that, even if the logo lists get rebuilt.

`LINEUP_EPOCH` in `api/lineup.js` is the first day, which is Logo Lineup #1.

## The logos

Both lists are JSON files in `api/data/`, and the images are in `public/logos/leagues/`.

- **Modern logos:** `scripts/build_logo_teams.py` gets every team's name from ESPN's public team lists and the logo as an SVG from each league's own site (nfl.com, nba.com, mlbstatic.com, nhle.com, ncaa.com), and writes `logo_teams.json`. ESPN only has PNGs, and a 500px PNG zoomed 5x is a blur. Each site names teams differently, so the script has a few mappings (NBA team ids, NFL codes, college slugs like "ohio-st"). The game shows logos on a light grey card so navy and black still show up.
- **Old logos:** `scripts/build_old_logos.py` gets them from sportslogos.net and writes `old_logos.json`. For each team it keeps the two most recent primary logos that aren't the current one, were still used in 1980 or later, and actually look different from today's logo. A lot of "old" logos are just small redraws (the Cowboys star, the Saints fleur-de-lis), and those would make the old logo free. The script compares tiny thumbnails to catch those, which misses a few, so the rest are in `EXCLUDE` by hand (the Raiders shield, the Browns helmet, the Maple Leafs leaf). That leaves about 200 old logos. It includes old cities with the same nickname (Oakland Raiders, New Jersey Nets) but not different nicknames (Seattle SuperSonics, Hartford Whalers), since casual fans wouldn't connect those. Retired names like the Redskins and Indians are never used, and neither are Native American caricatures (the old Braves face, Chief Illiniwek). Anything that shouldn't be in the game goes in `EXCLUDE` as the team and the logo's first season.

Neither list updates on its own, so a team's new logo (or one that just got retired) isn't in the game until the lists get rebuilt.

## Tables

- `lineup_puzzles` - the saved puzzle for each day
- `lineup_crops` - every zoomed crop that's been cut, 18 a day (6 logos, 3 zoom levels), about 7 KB each
- `lineup_games` - one row per player per day, with every logo's attempts and misses, the score, and whether it's finished. Unlike Film Room, progress and the result are the same row, and `completed` flips when all six logos are done.

Signed out games are kept in the browser per day, and the browser sends that back when it loads so the server knows which zoom level to send. If you sign in after playing, the first time you load that day signed in the server saves the browser's game to your account, as long as the account has nothing for that day yet. A logo only counts as solved if the browser sends the team it got and it's the real answer, so you can't just send yourself a 6.

Each saved crop remembers its zoom, so if `ZOOMS` ever changes, old crops get redrawn instead of reused.

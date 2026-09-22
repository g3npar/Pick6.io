# How puzzles are made

All of this is in `api/puzzle.js`.

## Picking the player

A player can show up if:

- they're on a roster this season
- they're not an offensive lineman, kicker, punter, or long snapper
- they've had at least one decent season (like 500+ rushing yards, 2000+ passing yards, 5+ sacks) or made a Pro Bowl

The daily pick is random, but it's seeded by the date so the same day always gives the same player. It also skips anyone who was the answer in the last 4 weeks.

## Picking the facts

The code builds a list of every fact it can find for that player (college, draft pick, jersey number, birth year, teams, Pro Bowls, Super Bowls, awards, best stat seasons, etc). Then it picks 6:

- usually 1 stat fact and 5 non-stat facts, so it's not all numbers
- if the player doesn't have 6 facts, they get skipped

Stat facts always use the player's **best** season, not their most recent one.

## Making the lie

One of the 6 facts gets changed into a lie. The lie is supposed to be believable, not obviously wrong. Some examples:

- **stats** - same number, but a different season
- **draft** - wrong round or wrong year
- **college** - a different big school
- **birth year** - off by 1-3 years
- **Pro Bowls / All-Pro** - a slightly different count
- **teams** - swaps one team for a team they never played for
- **initials** - initials of a real player at the same position

## Scoring

- **Finding the lie:** 3 points on your first try, 2 on your second, 1 on your third, 0 if you miss all 3.
- **Naming the player:** 3 points.

Max is 6.

For the name, the check ignores capitals, periods, extra spaces, and suffixes like Jr., Sr., II, and III. So "antoine winfield jr" counts for "Antoine Winfield Jr." This logic is in two places, `_normName` in `api/puzzle.js` and `src/utils/normalizePlayerName.js`, so if I change one I have to change the other.

## Admin page

On the admin page I can:

- see the next 14 days of puzzles
- shuffle to a different player, or search for a specific one
- hit New Facts to get a different set of 6 facts for the same player
- click a fact to make it the lie (click again to get a different lie)
- swap out a fact
- play test the puzzle
- save it for that day

You can only change future days, not today or the past.

**Heads up:** if I don't save a future puzzle, it can change after the weekly data update. Save it if I want to keep it.

## Adding a new kind of fact

1. Write a function in `puzzle.js` that returns the fact text and a `makeLie` function.
2. Add it to `buildFactPool()`.
3. Add a regex for it in `src/utils/factDisplay.js` so the wheel displays it nicely.

Don't reword old facts, because saved puzzles still use the old wording and the display regex won't match anymore.

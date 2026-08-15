# 🏈 Pick Six

A daily NFL trivia puzzle game. Each puzzle shows six facts about a mystery player, however one of them is a lie. Spot the lie, name the player, and score points. Whiff on both and it's a Pick Six.

## How it works

- One puzzle per day, featuring a currently active NFL player
- Facts are drawn from career stats, awards, college, draft position, and teams
- **+3 pts** for naming the correct player · **+3 pts** for spotting the lie (drops by 1 per wrong attempt, min +1)
- Max score: **6 points** · miss both and it's a Pick Six

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| API | Node.js / Express |
| Database | PostgreSQL (AWS RDS) |
| Awards data | `public/awards.csv` — scraped from Wikipedia |
| Deployment | Vercel (frontend) · Render (API) |

## Project structure

```
├── src/                  # React frontend
│   ├── components/       # GameBoard, Header, HowToPlay, ...
│   ├── utils/            # factDisplay, teamLogo, collegeLogo
│   └── App.jsx
├── api/                  # Express API server
│   ├── index.js          # Routes + security middleware
│   └── puzzle.js         # Puzzle generation logic
├── public/
│   ├── awards.csv        # HOF, Pro Bowl, All-Pro, MVP, OPOY, DPOY, ROY, CPOY (1957–2025)
│   └── logos/            # NFL team + college logos
├── scripts/              # Data loading + scraping scripts (Python)
├── render.yaml           # Render deployment config (API)
└── vercel.json           # Vercel deployment config (frontend)
```

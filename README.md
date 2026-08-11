# 🏈 NFL Gridlock

A daily NFL trivia puzzle game. Each puzzle shows five facts about a mystery player, however one of them is a lie. Spot the lie, name the player, and score points.

## How it works

- 3 puzzles per set, one from each era (1980–1995 · 1996–2010 · 2011–present)
- Facts are drawn from career stats, awards, college, draft position, and teams
- **+4 pts** for naming the correct player · **+6 pts** for spotting the lie (only awarded if the player is also correct)
- Max score: **30 points** per set

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

## Local development

### Prerequisites
- Node.js 18+
- Python 3.10+ (for data scripts)
- PostgreSQL database

### Setup

```bash
# Install frontend deps
npm install

# Install API deps
cd api && npm install && cd ..

# Copy and fill in environment variables
cp .env.example .env
```

### Environment variables

| Variable | Where | Description |
|----------|-------|-------------|
| `DATABASE_URL` | API | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | API | Comma-separated allowed CORS origins |
| `VITE_API_URL` | Frontend build | URL of the deployed API |

### Run locally

```bash
# Start API (port 3001)
cd api && node index.js

# Start frontend dev server (port 5173)
npm run dev
```

### Load data

```bash
cd scripts
pip install -r requirements.txt
python load_data.py       # Populates players, seasons, awards tables
```

## Deployment

Push to `main` — Render rebuilds the API, Vercel rebuilds the frontend automatically.

See [render.yaml](render.yaml) and [vercel.json](vercel.json) for configuration details.

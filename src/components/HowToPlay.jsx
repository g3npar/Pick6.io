import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

// the rules live behind an "i" button in each game instead of their own page

function Pick6Rules() {
  return (
    <>
        <div className="htp-steps">

          <div className="htp-step">
            <div className="htp-step-num">1</div>
            <div className="htp-step-body">
              <h3>Read the 6 facts</h3>
              <p>Each puzzle shows six facts about a mystery NFL player: college, draft, career stats, awards, and teams. <strong>One of the six is a lie.</strong></p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">2</div>
            <div className="htp-step-body">
              <h3>Mark the lie</h3>
              <p>Tap the fact you think is false. It will be highlighted in red. Tap again to deselect.</p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">3</div>
            <div className="htp-step-body">
              <h3>Guess the player</h3>
              <p>Type a player's name in the centre search box. Results will appear as you type. Select the correct player from the dropdown.</p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">4</div>
            <div className="htp-step-body">
              <h3>Lock in your answer</h3>
              <p>Once you've marked a lie and entered a name, hit <strong>LOCK IN →</strong> to submit. All six facts will reveal true/false, and your score is tallied.</p>
            </div>
          </div>

        </div>

        <div className="htp-scoring">
          <h2 className="htp-section-title">Scoring</h2>
          <div className="htp-score-grid">
            <div className="htp-score-chip htp-chip-player">
              <span className="htp-chip-val">+3</span>
              <span className="htp-chip-lbl">Correct player</span>
            </div>
            <div className="htp-score-chip htp-chip-lie">
              <span className="htp-chip-val">+3</span>
              <span className="htp-chip-lbl">Spotted the lie*</span>
            </div>
            <div className="htp-score-chip htp-chip-max">
              <span className="htp-chip-val">6</span>
              <span className="htp-chip-lbl">Max score per puzzle</span>
            </div>
          </div>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'8px'}}>* Full +3 on your first attempt; it drops by 1 for each wrong attempt, down to a minimum of +1. Miss the lie and the player both, and it's a Pick 6.</p>
        </div>

        <div className="htp-tips">
          <h2 className="htp-section-title">Tips</h2>
          <ul className="htp-tip-list">
            <li>You get 3 attempts to mark the lie, each wrong attempt reveals that fact is true.</li>
            <li>The lie is always plausible, a stat lie keeps the real number and swaps the year instead.</li>
          </ul>
        </div>
    </>
  )
}

function FilmRoomRules() {
  return (
    <>
        <div className="htp-steps">

          <div className="htp-step">
            <div className="htp-step-num">1</div>
            <div className="htp-step-body">
              <h3>Read the clues</h3>
              <p>Each puzzle is one team's season since 2002. You start with their record and how far they got in the playoffs. <strong>The other four clues are hidden.</strong></p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">2</div>
            <div className="htp-step-body">
              <h3>Guess the team</h3>
              <p>Pick a team and hit <strong>GUESS TEAM →</strong>. You get 3 attempts. Your first miss shows the top receiver, your second shows the top rusher.</p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">3</div>
            <div className="htp-step-body">
              <h3>Guess the year</h3>
              <p>Every clue shows now, including the head coach and starting QB. Pick the season and hit <strong>LOCK IN →</strong>.</p>
            </div>
          </div>

        </div>

        <div className="htp-scoring">
          <h2 className="htp-section-title">Scoring</h2>
          <div className="htp-score-grid">
            <div className="htp-score-chip htp-chip-player">
              <span className="htp-chip-val">+3</span>
              <span className="htp-chip-lbl">Correct team*</span>
            </div>
            <div className="htp-score-chip htp-chip-lie">
              <span className="htp-chip-val">+3</span>
              <span className="htp-chip-lbl">Exact year</span>
            </div>
            <div className="htp-score-chip htp-chip-max">
              <span className="htp-chip-val">6</span>
              <span className="htp-chip-lbl">Max score per puzzle</span>
            </div>
          </div>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'8px'}}>* Full +3 on your first attempt, +2 on the second, +1 on the third. Being 1 year off still gets you +1. Score 0 and it's a Pick 6.</p>
        </div>

        <div className="htp-tips">
          <h2 className="htp-section-title">Tips</h2>
          <ul className="htp-tip-list">
            <li>Teams count by franchise, so a St. Louis Rams season is just the Rams.</li>
            <li>The answer is always a season people remember: a playoff team, a 10+ win team, or a really bad one.</li>
          </ul>
        </div>
    </>
  )
}

function LineupRules() {
  return (
    <>
        <div className="htp-steps">

          <div className="htp-step">
            <div className="htp-step-num">1</div>
            <div className="htp-step-body">
              <h3>Six logos, zoomed way in</h3>
              <p>Every day there's one logo each from the NFL, NBA, MLB, NHL and college, plus <strong>one old logo</strong> from any of them. You only see a small piece of each one.</p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">2</div>
            <div className="htp-step-body">
              <h3>Name the team</h3>
              <p>Start typing and pick the team from the list. You get 3 attempts per logo, and every miss zooms out so you can see more.</p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">3</div>
            <div className="htp-step-body">
              <h3>Go in any order</h3>
              <p>Tap the tabs at the top to jump between logos. Your score is how many of the six you get.</p>
            </div>
          </div>

        </div>

        <div className="htp-tips">
          <h2 className="htp-section-title">Tips</h2>
          <ul className="htp-tip-list">
            <li>The old logo's answer is the team today, so an old Oakland Raiders logo is just the Raiders.</li>
            <li>College is the Power 4 conferences plus Notre Dame.</li>
            <li>Miss all six and it's a Pick 6.</li>
          </ul>
        </div>
    </>
  )
}

const RULES = {
  pick6:    { title: 'How to play Pick 6',    Body: Pick6Rules },
  filmroom: { title: 'How to play Film Room', Body: FilmRoomRules },
  lineup:   { title: 'How to play Logo Lineup', Body: LineupRules },
}

export default function RulesButton({ game }) {
  const [open, setOpen] = useState(false)
  const { title, Body } = RULES[game]

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button className="rules-btn" onClick={() => setOpen(true)} aria-label={title} title={title}>i</button>
      {/* portal to <body>, inside the game it got stuck under the Pick 6 wheel */}
      {open && createPortal(
        <div className="results-overlay" onClick={() => setOpen(false)}>
          <div className="htp-card rules-card" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
            <div className="rules-head">
              <h2 className="rules-title">{title}</h2>
              <button className="rules-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <Body />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

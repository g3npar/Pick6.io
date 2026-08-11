export default function HowToPlay() {
  return (
    <div className="htp-page">
      <div className="htp-card">

        <div className="htp-hero">
          <span className="htp-icon">🏈</span>
          <h1 className="htp-title">How to Play</h1>
          <p className="htp-subtitle">Spot the lie. Name the player. Score big.</p>
        </div>

        <div className="htp-steps">

          <div className="htp-step">
            <div className="htp-step-num">1</div>
            <div className="htp-step-body">
              <h3>Read the 5 wedge facts</h3>
              <p>Each puzzle shows five facts about a mystery NFL player — college, draft, career stats, awards, and teams. <strong>One of the five is a lie.</strong></p>
            </div>
          </div>

          <div className="htp-step">
            <div className="htp-step-num">2</div>
            <div className="htp-step-body">
              <h3>Mark the lie</h3>
              <p>Tap the wedge you think contains the false fact. It will be highlighted in red. Tap again to deselect.</p>
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
              <p>Once you've marked a lie and entered a name, hit <strong>LOCK IN →</strong> to submit. All five wedges will reveal true/false, and your score is tallied.</p>
            </div>
          </div>

        </div>

        <div className="htp-scoring">
          <h2 className="htp-section-title">Scoring</h2>
          <div className="htp-score-grid">
            <div className="htp-score-chip htp-chip-player">
              <span className="htp-chip-val">+4</span>
              <span className="htp-chip-lbl">Correct player</span>
            </div>
            <div className="htp-score-chip htp-chip-lie">
              <span className="htp-chip-val">+6</span>
              <span className="htp-chip-lbl">Spotted the lie*</span>
            </div>
            <div className="htp-score-chip htp-chip-max">
              <span className="htp-chip-val">30</span>
              <span className="htp-chip-lbl">Max score (3 puzzles)</span>
            </div>
          </div>
          <p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'8px'}}>* Lie points only awarded when the player is also correct.</p>
        </div>

        <div className="htp-tips">
          <h2 className="htp-section-title">Tips</h2>
          <ul className="htp-tip-list">
            <li>Use arrow keys <kbd>←</kbd> <kbd>→</kbd> to navigate between puzzles.</li>
            <li>Each puzzle set spans three eras: 1980–1995, 1996–2010, and 2011–present.</li>
            <li>The lie is always plausible as it tweaks a real stat or award by a small amount.</li>
          </ul>
        </div>

      </div>
    </div>
  )
}

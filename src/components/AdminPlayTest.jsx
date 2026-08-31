import { useState } from 'react'
import GameBoard from './GameBoard'

// plays a puzzle for real using GameBoard, but entirely in local state.
// guessing the lie and submitting a player never hit the server, so
// finishing this can never write a result or touch puzzle progress.
export default function AdminPlayTest({ puzzle, date, onClose }) {
  const [state, setState] = useState({})
  const update = u => setState(prev => ({ ...prev, ...u }))

  const selectedLieId    = state.lieId ?? null
  const selectedPlayer   = state.player ?? ''
  const selectedHeadshot = state.headshot ?? null
  const lieFound         = state.lieFound ?? false
  const lieAttempts      = state.lieAttempts ?? 0
  const confirmedTrueIds = state.confirmedTrueIds ?? []
  const submitted        = state.submitted ?? false
  const playerCorrect    = submitted && (state.playerCorrect ?? false)
  const gaveUp           = state.gaveUp ?? false
  const liePhaseComplete = lieFound || lieAttempts >= 3 || submitted

  const norm = s => String(s || '').trim().toLowerCase()

  const onGuessLie = () => {
    if (!selectedLieId || liePhaseComplete) return
    const correct = selectedLieId === puzzle.falseFactId
    update({
      lieFound: correct,
      lieAttempts: correct ? lieAttempts : lieAttempts + 1,
      confirmedTrueIds: correct || confirmedTrueIds.includes(selectedLieId)
        ? confirmedTrueIds : [...confirmedTrueIds, selectedLieId],
      lieId: correct ? selectedLieId : null,
    })
  }

  const onSubmit = () => {
    if (!selectedPlayer.trim() || !liePhaseComplete || submitted) return
    update({ submitted: true, playerCorrect: norm(selectedPlayer) === norm(puzzle.playerName) })
  }

  const onGiveUp = () => {
    update({
      gaveUp: true,
      player: '',
      lieAttempts: lieFound ? lieAttempts : 3,
      submitted: true,
      playerCorrect: false,
    })
  }

  const lieScore    = submitted ? (lieFound ? Math.max(1, 3 - lieAttempts) : 0) : 0
  const playerScore = submitted && playerCorrect ? 3 : 0
  const currentScore = lieScore + playerScore

  return (
    <div>
      <button className="header-icon-btn" onClick={onClose} style={{ marginBottom: 12 }}>← Back</button>
      <GameBoard
        puzzle={{ ...puzzle, date }}
        totalPuzzles={1}
        selectedLieId={selectedLieId}
        selectedPlayer={selectedPlayer}
        selectedHeadshot={selectedHeadshot}
        lieFound={lieFound}
        lieAttempts={lieAttempts}
        confirmedTrueIds={confirmedTrueIds}
        liePhaseComplete={liePhaseComplete}
        submitted={submitted}
        playerCorrect={playerCorrect}
        gaveUp={gaveUp}
        onSelectLie={id => !liePhaseComplete && update({ lieId: id })}
        onSelectPlayer={(name, headshot) => !submitted && update({ player: name, headshot: headshot ?? null })}
        onGuessLie={onGuessLie}
        onSubmit={onSubmit}
        onGiveUp={onGiveUp}
        currentScore={currentScore}
      />
    </div>
  )
}

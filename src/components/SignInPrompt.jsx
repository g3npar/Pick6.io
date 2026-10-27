import SignInButton from './SignInButton'

function SignInPrompt({ onSignedIn, onDismiss }) {
  return (
    <div className="results-overlay" onClick={onDismiss}>
      <div className="results-card" onClick={e => e.stopPropagation()}>
        <p className="results-headline">Save this score?</p>
        <p className="results-reveal">Sign in to save your results and see how you did each day.</p>
        <SignInButton onSignedIn={onSignedIn} />
        <button className="header-icon-btn" onClick={onDismiss}>Not now</button>
      </div>
    </div>
  )
}

export default SignInPrompt

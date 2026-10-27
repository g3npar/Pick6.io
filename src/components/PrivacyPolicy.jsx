export default function PrivacyPolicy() {
  return (
    <div className="htp-page">
      <div className="htp-card">

        <p className="legal-meta">Last updated: October 15, 2026</p>

        <div className="legal-section">
          <h2 className="htp-section-title">Overview</h2>
          <p>Pick6.io is a small, independently-run collection of daily sports trivia games. This policy explains what data we collect when you use it, why, and what say you have over it. We keep this short on purpose. If a section doesn't apply to how you use the site (for example, you haven't created an account), it simply doesn't apply to you.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Playing without an account</h2>
          <p>You can play every game without signing up for anything. Your in-progress games are kept in your browser. Each guess is sent to our server so it can be checked. When you finish a game on its day, we save your score with a random ID your browser makes up (not tied to you in any way) so we can show everyone where they placed that day. Nothing else about your game is saved there. Like most web services, our hosting providers keep short-lived technical logs (e.g. IP address, request time) for security and abuse prevention. We don't use these for tracking or advertising, and we don't run any analytics or ad scripts on this site.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">If you create an account</h2>
          <p>Signing in with Google lets you save your results across devices and shows them on your profile. Creating an account means we store:</p>
          <ul>
            <li>Your email address and a display name.</li>
            <li>If you sign in with Google, the account identifier Google gives us, not your Google password, which we never see.</li>
            <li>Your results in each daily game. For Pick 6: whether you found the lie, how many attempts it took, the player you guessed, and your score. For Film Room: the teams you guessed, the year you guessed, and your score. For Logo Lineup: the teams you guessed and the attempts you used on each logo, and your score.</li>
            <li>Your progress in a game you've started but not finished, so you can pick it up on another device.</li>
            <li>A session cookie that keeps you signed in.</li>
          </ul>
          <p>That's the complete list. We don't collect payment information, location data, or anything beyond what's needed to save your progress and show where you placed each day.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">How we use it</h2>
          <p>Solely to run the features you'd expect: signing you in, saving your results, showing your per day stats on your profile, and counting your score (with no name attached) when we show players where they placed that day. We don't sell data, share it with advertisers, or use it for anything beyond operating Pick6.io.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Who else sees it</h2>
          <p>Our infrastructure providers process data on our behalf to keep the site running: currently a hosting provider for the site itself, a hosting provider for the API, and a database provider. If you sign in with Google, Google processes the authentication itself under its own privacy policy. None of these providers use your data for their own purposes.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Your rights</h2>
          <p>You can delete your account and all associated data at any time from your profile settings, or by emailing us. Deleting your account removes your saved results.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Children's privacy</h2>
          <p>Pick6.io isn't directed at children under 13, and we don't knowingly collect data from anyone under that age.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Changes to this policy</h2>
          <p>If this policy changes in a meaningful way, we'll update the date at the top of this page.</p>
        </div>

        <div className="legal-section">
          <h2 className="htp-section-title">Contact</h2>
          <p>Questions about this policy or your data: <a href="mailto:contact@pick6.io">contact@pick6.io</a></p>
        </div>

      </div>
    </div>
  )
}

function Footer({ onNav }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-links">
        <button onClick={() => onNav('privacy')}>Privacy Policy</button>
        <button onClick={() => onNav('terms')}>Terms of Service</button>
        <button onClick={() => onNav('bug')}>Report a bug</button>
      </div>
      <p className="site-footer-copy">Pick6.io is an independent project and isn't affiliated with the NFL or any other league.</p>
    </footer>
  )
}

export default Footer

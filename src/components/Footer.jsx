function Footer({ onNav }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-links">
        <button onClick={() => onNav('privacy')}>Privacy Policy</button>
        <button onClick={() => onNav('terms')}>Terms of Service</button>
      </div>
      <p className="site-footer-copy">Pick Six is an independent project and isn't affiliated with the NFL.</p>
    </footer>
  )
}

export default Footer

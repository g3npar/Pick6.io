export default function ComingSoon({ title }) {
  return (
    <div className="coming-soon-page">
      <div className="coming-soon-inner">
        <span className="coming-soon-icon">🚧</span>
        <h2 className="coming-soon-title">{title}</h2>
        <p className="coming-soon-sub">Coming soon</p>
      </div>
    </div>
  )
}

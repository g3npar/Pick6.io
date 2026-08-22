// Miniature version of the puzzle wheel's 6-wedge layout, spinning as a loading indicator.
const R = 46, CX = 50, CY = 50, N = 6, DEG = 360 / N

function wedgePath(i) {
  const toRad = d => d * Math.PI / 180
  const start = -90 + i * DEG
  const end   = start + DEG
  const x1 = CX + R * Math.cos(toRad(start))
  const y1 = CY + R * Math.sin(toRad(start))
  const x2 = CX + R * Math.cos(toRad(end))
  const y2 = CY + R * Math.sin(toRad(end))
  return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

const WEDGE_PATHS  = Array.from({ length: N }, (_, i) => wedgePath(i))
const WEDGE_COLORS = ['#ff2244', '#161a2e', '#ff2244', '#161a2e', '#ff2244', '#161a2e']

function WheelSpinner({ size = 64 }) {
  return (
    <svg
      className="wheel-spinner"
      style={{ width: size, height: size }}
      viewBox="0 0 100 100"
      role="status"
      aria-label="Loading"
    >
      {WEDGE_PATHS.map((d, i) => (
        <path key={i} d={d} fill={WEDGE_COLORS[i]} stroke="#0d0d0d" strokeWidth="1.5" strokeLinejoin="round" />
      ))}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#2e2e2e" strokeWidth="1" />
      <circle cx={CX} cy={CY} r="14" fill="#0d0d14" stroke="#2e2e2e" strokeWidth="1" />
    </svg>
  )
}

export default WheelSpinner

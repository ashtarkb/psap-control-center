interface GpuDonutChartProps {
  used: number
  total: number
  size?: number
  strokeWidth?: number
}

export default function GpuDonutChart({ used, total, size = 80, strokeWidth = 8 }: GpuDonutChartProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const percent = total > 0 ? Math.round((used / total) * 100) : 0
  const filled = total > 0 ? (used / total) * circumference : 0

  const color =
    percent >= 90 ? '#ef4444' :   // red
    percent >= 70 ? '#f59e0b' :   // amber
    percent > 0   ? '#8b5cf6' :   // purple
                    '#d1d5db'     // gray (0%)

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
      {/* Center text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-gray-900 font-bold"
        style={{ fontSize: size * 0.22 }}
      >
        {percent}%
      </text>
    </svg>
  )
}

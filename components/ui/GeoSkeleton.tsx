'use client'

/**
 * GEOMATIK Skeleton — shimmer loading states
 *
 * Uses the .geo-skeleton class from globals.css for the shimmer animation.
 * Provides pre-built variants for common patterns.
 */

interface GeoSkeletonProps {
  width?: number | string
  height?: number | string
  borderRadius?: number
  style?: React.CSSProperties
}

/** Base shimmer rect */
export function GeoSkeleton({ width, height = 16, borderRadius = 4, style }: GeoSkeletonProps) {
  return (
    <div
      className="geo-skeleton"
      style={{ width, height, borderRadius, ...style }}
    />
  )
}

/** 3 lines of text with varied widths */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ['100%', '85%', '60%', '90%', '70%']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="geo-skeleton"
          style={{ height: 12, borderRadius: 3, width: widths[i % widths.length] }}
        />
      ))}
    </div>
  )
}

/** Card skeleton: header bar + 2 text lines */
export function SkeletonCard() {
  return (
    <div style={{
      background: '#0a0a0a',
      border: '0.5px solid #1a1a1a',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Header band */}
      <div className="geo-skeleton" style={{ height: 36, borderRadius: 0 }} />
      {/* Body */}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="geo-skeleton" style={{ height: 14, borderRadius: 3, width: '70%' }} />
        <div className="geo-skeleton" style={{ height: 12, borderRadius: 3, width: '45%' }} />
      </div>
    </div>
  )
}

/** Chart skeleton: tall rect with faux bar chart lines */
export function SkeletonChart({ height = 160 }: { height?: number }) {
  return (
    <div style={{
      background: '#0a0a0a',
      border: '0.5px solid #1a1a1a',
      borderRadius: 6,
      height,
      padding: 16,
      display: 'flex',
      alignItems: 'flex-end',
      gap: 6,
    }}>
      {[40, 65, 30, 80, 55, 45, 70, 35].map((h, i) => (
        <div
          key={i}
          className="geo-skeleton"
          style={{
            flex: 1,
            height: `${h}%`,
            borderRadius: 2,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}

/** Map placeholder: large rect with subtle hex grid */
export function SkeletonMap({ height = 300 }: { height?: number }) {
  return (
    <div style={{
      position: 'relative',
      background: '#0a0a0a',
      border: '0.5px solid #1a1a1a',
      borderRadius: 6,
      height,
      overflow: 'hidden',
    }}>
      {/* Shimmer base */}
      <div className="geo-skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
      {/* Hex grid overlay */}
      <svg
        width="100%" height="100%"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, opacity: 0.04 }}
      >
        {Array.from({ length: 5 }, (_, row) =>
          Array.from({ length: 5 }, (_, col) => {
            const x = col * 42 + (row % 2 ? 21 : 0)
            const y = row * 36
            return (
              <polygon
                key={`${row}-${col}`}
                points={hexPts(x + 21, y + 18, 18)}
                fill="none" stroke="#f0f0f0" strokeWidth="0.5"
              />
            )
          })
        )}
      </svg>
    </div>
  )
}

function hexPts(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')
}

'use client'

import { useEffect, useRef } from 'react'

interface GeoConfettiProps {
  trigger: boolean
}

const COLORS = ['#4ecdc4', '#4ecdc4', '#4ecdc4', '#3dbdb5', '#f0f0f0', '#f0f0f0']
const COUNT = 35
const DURATION = 2000

/** Hexagon points for a tiny SVG polygon */
function hexPath(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')
}

export function GeoConfetti({ trigger }: GeoConfettiProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastTrigger = useRef(false)

  useEffect(() => {
    // Only fire on rising edge (false -> true)
    if (!trigger || lastTrigger.current) {
      lastTrigger.current = trigger
      return
    }
    lastTrigger.current = true

    const container = containerRef.current
    if (!container) return

    // Create particle elements
    const particles: HTMLDivElement[] = []

    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement('div')
      const size = 4 + Math.random() * 6
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const angle = Math.random() * Math.PI * 2
      const velocity = 60 + Math.random() * 120
      const dx = Math.cos(angle) * velocity
      const dy = Math.sin(angle) * velocity - 40 // upward bias
      const rotation = Math.random() * 360
      const delay = Math.random() * 150

      // Create inline SVG hexagon
      el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 10 10"><polygon points="${hexPath(5, 5, 4.5)}" fill="${color}" opacity="0.85"/></svg>`
      el.style.cssText = `
        position: absolute;
        left: 50%; top: 50%;
        width: ${size}px; height: ${size}px;
        pointer-events: none;
        animation: geo-confetti-fly ${DURATION}ms ease-out ${delay}ms forwards;
        --dx: ${dx}px;
        --dy: ${dy}px;
        --rot: ${rotation}deg;
      `
      container.appendChild(el)
      particles.push(el)
    }

    // Cleanup after animation
    const timer = setTimeout(() => {
      particles.forEach(p => p.remove())
    }, DURATION + 200)

    return () => {
      clearTimeout(timer)
      particles.forEach(p => p.remove())
    }
  }, [trigger])

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9998,
          overflow: 'hidden',
        }}
      />
      <style>{`
        @keyframes geo-confetti-fly {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) scale(1);
            opacity: 0.9;
          }
          60% {
            opacity: 0.7;
          }
          100% {
            transform: translate(
              calc(-50% + var(--dx)),
              calc(-50% + var(--dy) + 180px)
            ) rotate(var(--rot)) scale(0.3);
            opacity: 0;
          }
        }
      `}</style>
    </>
  )
}

'use client'

import type { ReactNode } from 'react'

interface PageTransitionProps {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  return (
    <div
      style={{
        animation: 'page-enter 0.3s ease-out',
      }}
    >
      {children}

      <style>{`
        @keyframes page-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="page-enter"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

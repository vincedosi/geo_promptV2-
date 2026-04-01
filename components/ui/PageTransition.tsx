'use client'

import type { ReactNode } from 'react'

interface PageTransitionProps {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  return (
    <div className="page-transition-enter">
      {children}
    </div>
  )
}

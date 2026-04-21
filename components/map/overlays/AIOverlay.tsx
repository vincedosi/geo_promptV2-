'use client';
import type { ReactNode } from 'react';

export interface AIOverlayProps {
  chatSlot: ReactNode;
}

export function AIOverlay({ chatSlot }: AIOverlayProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {chatSlot}
    </div>
  );
}

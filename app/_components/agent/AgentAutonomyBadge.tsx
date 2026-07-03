'use client';

import { AUTONOMY_LABELS, type AutonomyLevel } from '@/lib/agent/types';

const fMono = "'JetBrains Mono', monospace";

const COLORS: Record<AutonomyLevel, string> = {
  0: '#a0a0a0',
  1: '#5b9bd5',
  2: '#f7b731',
  3: '#ff8a4c',
  4: '#3dffa0',
};

export function AgentAutonomyBadge({ level }: { level: AutonomyLevel }) {
  return (
    <span
      title={`Niveau d'autonomie : ${AUTONOMY_LABELS[level]}`}
      style={{
        fontFamily: fMono, fontSize: 9, padding: '2px 6px', borderRadius: 4,
        background: 'rgba(255,255,255,0.03)',
        border: `0.5px solid ${COLORS[level]}40`,
        color: COLORS[level],
        whiteSpace: 'nowrap',
      }}
    >
      L{level} {AUTONOMY_LABELS[level]}
    </span>
  );
}

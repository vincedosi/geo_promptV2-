'use client';

/**
 * GeoBot — GEOMATIK pixel art mascot for geo.prompt
 *
 * Pure SVG + CSS animations. Zero external libraries.
 * Status-driven: idle | thinking | speaking | done
 */

export type GeoBotStatus = 'idle' | 'thinking' | 'speaking' | 'done';

interface GeoBotProps {
  status?: GeoBotStatus;
  size?: number;
  show?: boolean;
}

export default function GeoBot({ status = 'idle', size = 36, show = true }: GeoBotProps) {
  if (!show) return null;

  const h = size * (36 / 32);
  const t = status === 'thinking';
  const s = status === 'speaking';
  const d = status === 'done';
  const active = t || s;

  // Head stroke color: teal when active
  const headStroke = active || d ? '#4ecdc4' : '#262626';
  // Chest indicator color
  const chestColor = d ? '#3dffa0' : '#4ecdc4';
  const chestOpacity = s ? 1 : t ? undefined : d ? 0.6 : 0.4;

  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 32 36"
      fill="none"
      style={{ imageRendering: 'pixelated', flexShrink: 0 }}
      aria-hidden="true"
    >
      <style>{`
        /* ── Idle ─────────────────────────────────── */
        @keyframes geobot-blink {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes geobot-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.5px); }
        }

        /* ── Thinking ─────────────────────────────── */
        @keyframes geobot-look {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(1px); }
          75% { transform: translateX(-1px); }
        }
        @keyframes geobot-dot1 {
          0%, 100% { opacity: 0.2; }
          33% { opacity: 1; }
        }
        @keyframes geobot-dot2 {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 1; }
        }
        @keyframes geobot-dot3 {
          0%, 100% { opacity: 0.2; }
          66% { opacity: 1; }
        }
        @keyframes geobot-head-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes geobot-antenna-pulse {
          0%, 100% { fill: #4ecdc4; }
          50% { fill: #3dbdb5; }
        }
        @keyframes geobot-chest-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }

        /* ── Speaking ─────────────────────────────── */
        @keyframes geobot-talk {
          0%, 100% { transform: scaleY(1); }
          30% { transform: scaleY(2); }
          60% { transform: scaleY(0.8); }
          80% { transform: scaleY(1.6); }
        }
        @keyframes geobot-eq1 {
          0%, 100% { height: 3px; opacity: 0.3; }
          50% { height: 6px; opacity: 0.6; }
        }
        @keyframes geobot-eq2 {
          0%, 100% { height: 5px; opacity: 0.4; }
          40% { height: 2px; opacity: 0.3; }
          70% { height: 7px; opacity: 0.6; }
        }
        @keyframes geobot-eq3 {
          0%, 100% { height: 4px; opacity: 0.35; }
          60% { height: 6px; opacity: 0.55; }
        }
        @keyframes geobot-eye-bright {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }

        /* ── Done ─────────────────────────────────── */
        @keyframes geobot-bounce {
          0% { transform: translateY(0); }
          30% { transform: translateY(-1.5px); }
          60% { transform: translateY(0.3px); }
          80% { transform: translateY(-0.5px); }
          100% { transform: translateY(0); }
        }

        .geobot-body {
          animation: geobot-bob 3s ease-in-out infinite;
        }
        .geobot-body--done {
          animation: geobot-bounce 0.6s ease both;
        }
      `}</style>

      {/* ── Main group (bob / bounce) ─────────────── */}
      <g className={d ? 'geobot-body--done' : 'geobot-body'}>

        {/* Antenne */}
        <rect x="15" y="1" width="2" height="5" rx="1"
          fill="#4ecdc4"
          style={t ? { animation: 'geobot-antenna-pulse 1.5s ease-in-out infinite' } : undefined}
        />
        <rect x="14" y="5" width="4" height="2" rx="0.5" fill="#1a1a1a" />

        {/* Head */}
        <rect x="8" y="7" width="16" height="14" rx="2"
          fill="#111111" stroke={headStroke} strokeWidth="0.5"
          style={t ? { animation: 'geobot-head-pulse 1.5s ease-in-out infinite' } : undefined}
        />

        {/* Visor */}
        <rect x="10" y="10" width="12" height="5" rx="1" fill="#0a0a0a" />

        {/* Eyes */}
        <g style={
          t ? { animation: 'geobot-look 2s ease-in-out infinite', transformOrigin: '16px 12px' }
          : s ? { animation: 'geobot-eye-bright 1s ease-in-out infinite' }
          : { animation: 'geobot-blink 4s ease-in-out infinite', transformOrigin: '16px 12px' }
        }>
          <rect x="11" y="11" width="3" height="3" rx="0.5" fill="#4ecdc4" />
          <rect x="18" y="11" width="3" height="3" rx="0.5" fill="#4ecdc4" />
          {/* Pupils */}
          <rect x="12.5" y="12" width="1" height="1" fill="#050505" />
          <rect x="19.5" y="12" width="1" height="1" fill="#050505" />
        </g>

        {/* Mouth area */}
        {t ? (
          /* Thinking: 3 pulsing dots */
          <g>
            <rect x="12" y="17" width="1.5" height="1.5" rx="0.75" fill="#4ecdc4"
              style={{ animation: 'geobot-dot1 1.2s ease-in-out infinite' }} />
            <rect x="15.25" y="17" width="1.5" height="1.5" rx="0.75" fill="#4ecdc4"
              style={{ animation: 'geobot-dot2 1.2s ease-in-out 0.2s infinite' }} />
            <rect x="18.5" y="17" width="1.5" height="1.5" rx="0.75" fill="#4ecdc4"
              style={{ animation: 'geobot-dot3 1.2s ease-in-out 0.4s infinite' }} />
          </g>
        ) : d ? (
          /* Done: smile arc */
          <path d="M13 17 Q16 19.5 19 17" stroke="#4ecdc4" strokeWidth="1" fill="none" strokeLinecap="round" />
        ) : s ? (
          /* Speaking: oscillating mouth */
          <rect x="13" y="16.5" width="6" height="1.5" rx="0.5" fill="#4ecdc4"
            style={{ animation: 'geobot-talk 0.4s ease-in-out infinite', transformOrigin: '16px 17.25px' }} />
        ) : (
          /* Idle: neutral mouth */
          <rect x="13" y="17" width="6" height="1.5" rx="0.5" fill="#333333" />
        )}

        {/* Body */}
        <rect x="10" y="22" width="12" height="8" rx="1"
          fill="#111111" stroke="#262626" strokeWidth="0.5"
        />

        {/* Chest indicator */}
        <rect x="14" y="24" width="4" height="2" rx="0.5"
          fill={chestColor}
          opacity={chestOpacity}
          style={t ? { animation: 'geobot-chest-pulse 1.5s ease-in-out infinite' } : undefined}
        />

        {/* Arms */}
        <rect x="6" y="23" width="3" height="7" rx="1" fill="#1a1a1a"
          style={s ? { transform: 'translateY(-1px)' } : undefined}
        />
        <rect x="23" y="23" width="3" height="7" rx="1" fill="#1a1a1a" />

        {/* Legs */}
        <rect x="11" y="30" width="4" height="3" rx="1" fill="#1a1a1a" />
        <rect x="17" y="30" width="4" height="3" rx="1" fill="#1a1a1a" />

        {/* Feet */}
        <rect x="10" y="33" width="5" height="2" rx="0.5" fill="#262626" />
        <rect x="17" y="33" width="5" height="2" rx="0.5" fill="#262626" />

        {/* Speaking: equalizer bars */}
        {s && (
          <g>
            <rect x="26" y="10" width="1.5" rx="0.5" fill="#4ecdc4"
              style={{ animation: 'geobot-eq1 0.5s ease-in-out infinite', height: 3 }} />
            <rect x="28" y="9" width="1.5" rx="0.5" fill="#4ecdc4"
              style={{ animation: 'geobot-eq2 0.6s ease-in-out 0.1s infinite', height: 5 }} />
            <rect x="30" y="10" width="1.5" rx="0.5" fill="#4ecdc4"
              style={{ animation: 'geobot-eq3 0.55s ease-in-out 0.2s infinite', height: 4 }} />
          </g>
        )}

      </g>
    </svg>
  );
}

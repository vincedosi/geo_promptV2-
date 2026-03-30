'use client';

import { useState, useRef, useEffect, memo } from 'react';
import { useSession, useSignOut } from '@/lib/auth-client';

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

export const SessionBadge = memo(function SessionBadge() {
  const { session, isLoading } = useSession();
  const { signOut }            = useSignOut();
  const [open, setOpen]        = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Don't render when no session (login page, loading done)
  if (!isLoading && !session) return null;

  const email      = session?.user.email ?? '';
  const role       = session?.user.role  ?? 'authenticated';
  const orgId      = session?.user.organizationId ?? null;
  const displayEmail = email.length > 25 ? email.slice(0, 22) + '…' : email;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* ── Trigger ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          animation: 'sbEntrance 0.3s ease-out',
        }}
        onMouseEnter={e => {
          e.currentTarget.querySelectorAll<HTMLElement>('[data-hover]').forEach(el => {
            el.style.color = '#f0f0f0';
          });
        }}
        onMouseLeave={e => {
          e.currentTarget.querySelectorAll<HTMLElement>('[data-hover]').forEach(el => {
            el.style.color = el.dataset.hoverColor ?? '#a0a0a0';
          });
        }}
      >
        {/* Logo GEOMATIK */}
        <img src="/geomatik-icon.svg" width={20} height={20} alt="" style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontWeight: 700, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap' }}>
          <span style={{ color: '#f0f0f0' }}>GEOM</span><span style={{ color: '#4ecdc4' }}>ATIK</span>
        </span>

        {/* Séparateur vertical */}
        <div style={{ width: '0.5px', height: 18, background: '#262626', flexShrink: 0, margin: '0 6px' }} />

        {/* Status dot */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: isLoading ? '#f7b731' : '#3dffa0',
          animation: isLoading ? 'sbPulse 1s ease-in-out infinite' : 'none',
        }} />

        {/* Email + org */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span
            data-hover=""
            data-hover-color="#a0a0a0"
            style={{
              fontFamily: fInter, fontWeight: 400, fontSize: 11, color: '#a0a0a0',
              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'block', transition: 'color 0.2s ease',
            }}
          >
            {isLoading ? '…' : displayEmail}
          </span>
          {orgId && (
            <span
              data-hover=""
              data-hover-color="#666666"
              style={{
                fontFamily: fMono, fontWeight: 400, fontSize: 9, color: '#666666',
                maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'block', transition: 'color 0.2s ease',
              }}
            >
              {orgId.slice(0, 8)}…
            </span>
          )}
        </div>
      </button>

      {/* ── Dropdown ────────────────────────────────────────────────── */}
      {open && session && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: '#0a0a0a',
          border: '0.5px solid #1a1a1a',
          borderRadius: 8,
          padding: 12,
          width: 240,
          zIndex: 20000,
          display: 'flex', flexDirection: 'column', gap: 8,
          animation: 'sbFadeIn 0.2s ease',
        }}>
          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: fInter, fontSize: 10, color: '#666666' }}>Email</span>
            <span style={{ fontFamily: fInter, fontSize: 12, color: '#a0a0a0', wordBreak: 'break-all' }}>
              {email}
            </span>
          </div>

          {/* Rôle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: fInter, fontSize: 10, color: '#666666' }}>Rôle</span>
            <span style={{ fontFamily: fInter, fontSize: 12, color: '#a0a0a0' }}>
              {role}
            </span>
          </div>

          {/* Organisation */}
          {orgId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: fInter, fontSize: 10, color: '#666666' }}>Organisation</span>
              <span style={{ fontFamily: fMono, fontSize: 10, color: '#a0a0a0', wordBreak: 'break-all' }}>
                {orgId}
              </span>
            </div>
          )}

          {/* Separator */}
          <div style={{ height: '0.5px', background: '#1a1a1a' }} />

          {/* Déconnexion */}
          <button
            onClick={async () => { setOpen(false); await signOut(); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: fInter, fontSize: 12, color: '#666666',
              textAlign: 'left', padding: '4px 0',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ff5757'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#666666'; }}
          >
            Déconnexion
          </button>
        </div>
      )}

      <style>{`
        @keyframes sbPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes sbFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes sbEntrance {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0s !important; transition-duration: 0s !important; }
        }
      `}</style>
    </div>
  );
});

"use client";

import { useSession, useSignOut } from "@/lib/auth-client";
import Link from "next/link";

const C = {
  bg:         '#050505',
  bgElevated: '#0d0d0d',
  bgSurface:  '#111118',
  border:     '#261a35',
  borderLight:'rgba(168,85,247,0.2)',
  accent:     '#a855f7',
  accentDim:  'rgba(168,85,247,0.12)',
  text:       '#e2e8f0',
  textDim:    '#94a3b8',
  textSec:    '#6b7280',
  muted:      '#4b5563',
  green:      '#3dffa0',
  red:        '#f87171',
};
const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

export default function DashboardPage() {
  const { session, isLoading } = useSession();
  const { signOut } = useSignOut();

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <div style={{ fontFamily: fontMono, color: C.textDim, fontSize: 11, letterSpacing: '0.1em' }}>LOADING...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Link href="/login" style={{ fontFamily: fontMono, color: C.accent, fontSize: 11 }}>→ /login</Link>
      </div>
    );
  }

  const navLinks = [
    { href: '/map',      label: 'geo.prompt', sub: 'Carte + IA media planning', accent: true  },
    { href: '/admin/ooh-import', label: 'OOH Import', sub: 'Data lake',       accent: false },
    { href: '/admin/import',          label: 'Import POI',      sub: 'Établissements',    accent: false },
    { href: '/admin/filosofi-import', label: 'Filosofi Import', sub: 'Carreaux .parquet', accent: false },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fontInter, color: C.text }}>

      {/* Header */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span style={{ fontFamily: fontOrbitron, fontSize: 14, fontWeight: 700, letterSpacing: '0.1em' }}>
            <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span>prompt</span>
          </span>
          <span style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.14em', marginLeft: 4 }}>DASHBOARD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
            {session.user.email}
          </span>
          <button
            onClick={() => signOut()}
            style={{ background: 'rgba(248,113,113,0.08)', border: `1px solid rgba(248,113,113,0.25)`, borderRadius: 2, padding: '5px 12px', color: C.red, cursor: 'pointer', fontSize: 9, fontFamily: fontMichroma, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>

        {/* Titre section */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 8 }}>SYSTEM</div>
          <h1 style={{ fontFamily: fontOrbitron, fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: '0.08em', margin: 0 }}>
            {session.user.name || session.user.email?.split('@')[0]}
          </h1>
          <div style={{ width: 32, height: 2, background: C.accent, marginTop: 10, borderRadius: 1 }} />
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 40 }}>

          {/* Profil */}
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20 }}>
            <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.14em', marginBottom: 14 }}>PROFIL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { k: 'EMAIL', v: session.user.email },
                { k: 'NOM',   v: session.user.name || '—' },
                { k: 'ROLE',  v: session.user.role || 'user' },
                { k: 'VERIF', v: session.user.emailVerified ? 'OUI' : 'NON' },
              ].map(({ k, v }) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.1em', flexShrink: 0 }}>{k}</span>
                  <span style={{ fontFamily: fontMono, fontSize: 10, color: C.text, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Organisation */}
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20 }}>
            <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.14em', marginBottom: 14 }}>ORGANISATION</div>
            {session.user.organizationId ? (
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, wordBreak: 'break-all' }}>
                {session.user.organizationId}
              </div>
            ) : (
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>// Aucune organisation</div>
            )}
          </div>

          {/* Session */}
          <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20 }}>
            <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.14em', marginBottom: 14 }}>SESSION</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.1em', marginBottom: 2 }}>ID</div>
                <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim, wordBreak: 'break-all' }}>{session.id?.slice(0, 24)}…</div>
              </div>
              <div>
                <div style={{ fontFamily: fontMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.1em', marginBottom: 2 }}>EXPIRE</div>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.text }}>{new Date(session.expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          </div>

        </div>

        {/* Navigation */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.18em', marginBottom: 14 }}>NAVIGATION</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {navLinks.map(({ href, label, sub, accent }) => (
              <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: accent ? C.accentDim : C.bgElevated,
                  border: `1px solid ${accent ? C.borderLight : C.border}`,
                  borderRadius: 2,
                  padding: '12px 16px',
                  transition: 'all 0.15s',
                  cursor: 'pointer',
                }}>
                  <div style={{ fontFamily: fontOrbitron, fontSize: 11, fontWeight: 700, color: accent ? C.accent : C.text, letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim }}>{sub}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

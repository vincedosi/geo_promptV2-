"use client";

import { useSession } from "@/lib/auth-client";
import Link from "next/link";

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

// ── Design tokens (Dark Minimal) ──────────────────────────────────────────────
const C = {
  bg:      '#050505',
  bgCard:  '#0a0a0a',
  bgBand:  '#111111',
  border:  '#1a1a1a',
  teal:    '#4ecdc4',
  green:   '#3dffa0',
  text:    '#f0f0f0',
  textSec: '#a0a0a0',
  textDim: '#666666',
};

// ── Card header bandeau (DESIGN_SYSTEM section header pattern) ────────────────
function CardHeader({ label }: { label: string }) {
  return (
    <div style={{
      background: C.bgBand, borderBottom: `0.5px solid ${C.border}`,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>Chargement…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Link href="/login" style={{ fontFamily: fInter, fontSize: 13, color: C.teal, textDecoration: 'none' }}>
          → Connexion
        </Link>
      </div>
    );
  }

  const navLinks = [
    { href: '/admin/ooh-import',      label: 'OOH Import',       sub: 'Data lake'         },
    { href: '/admin/import',          label: 'Import POI',        sub: 'Établissements'    },
    { href: '/admin/filosofi-import', label: 'Filosofi Import',   sub: 'Carreaux .parquet' },
    { href: '/admin/carreaux-import', label: 'Carreaux Import',   sub: 'GeoJSON/Shapefile' },
    { href: '/admin/profiles',        label: 'Scoring Profiles',  sub: 'Profils OOH'       },
    { href: '/admin/sources',         label: 'Sources Data.gouv', sub: 'Crawl & import'    },
  ];

  const displayName = session.user.name || session.user.email?.split('@')[0] || '—';

  return (
    <div style={{ fontFamily: fInter, color: C.text, maxWidth: 960, margin: '0 auto' }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: fInter, fontWeight: 500, fontSize: 18, color: C.text, margin: '0 0 4px' }}>
          Dashboard
        </h1>
        <p style={{ fontFamily: fInter, fontWeight: 400, fontSize: 13, color: C.textDim, margin: 0 }}>
          {displayName}
        </p>
      </div>

      {/* ── Info cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>

        {/* Profil */}
        <div style={{ background: C.bgCard, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <CardHeader label="Profil" />
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Email',        value: session.user.email       },
              { label: 'Nom',          value: session.user.name || '—' },
              { label: 'Rôle',         value: session.user.role || 'user' },
              { label: 'Vérifié',      value: session.user.emailVerified ? 'Oui' : 'Non' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontFamily: fInter, fontWeight: 400, fontSize: 12, color: C.textDim, marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{
                  fontFamily: fInter, fontWeight: 400, fontSize: 13, color: C.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Organisation */}
        <div style={{ background: C.bgCard, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <CardHeader label="Organisation" />
          <div style={{ padding: '12px 14px' }}>
            {session.user.organizationId ? (
              <div>
                <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, marginBottom: 2 }}>ID</div>
                <div style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, wordBreak: 'break-all' }}>
                  {session.user.organizationId}
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Aucune organisation</div>
            )}
          </div>
        </div>

        {/* Session */}
        <div style={{ background: C.bgCard, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <CardHeader label="Session" />
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, marginBottom: 2 }}>Identifiant</div>
              <div style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, wordBreak: 'break-all' }}>
                {session.id?.slice(0, 24)}…
              </div>
            </div>
            <div>
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, marginBottom: 2 }}>Expire</div>
              <div style={{ fontFamily: fInter, fontSize: 13, color: C.text }}>
                {new Date(session.expiresAt).toLocaleDateString('fr-FR', {
                  day: '2-digit', month: '2-digit', year: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Navigation cards ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {navLinks.map(({ href, label, sub }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div
              style={{
                background: C.bgCard,
                border: `0.5px solid ${C.border}`,
                borderRadius: 2,
                padding: '14px 16px',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(78,205,196,0.3)';
                (e.currentTarget as HTMLDivElement).style.background = '#111111';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = C.border;
                (e.currentTarget as HTMLDivElement).style.background = C.bgCard;
              }}
            >
              <div style={{ fontFamily: fInter, fontWeight: 500, fontSize: 14, color: C.text, marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontFamily: fInter, fontWeight: 400, fontSize: 12, color: C.textDim }}>
                {sub}
              </div>
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}

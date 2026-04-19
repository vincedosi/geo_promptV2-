'use client';

const fInter = "'Inter', system-ui, sans-serif";

export function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: fInter, textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ color: 'var(--text-tertiary)' }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>
        Pas encore de zone personnalisee
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.8, maxWidth: 320 }}>
        Sauvegardez vos premieres zones depuis le module radio, les isochrones, la selection d'IRIS ou le dessin libre.
      </div>
    </div>
  );
}

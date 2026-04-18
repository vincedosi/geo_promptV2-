'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--danger)' }}>Erreur critique</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>{error.message || 'Erreur inattendue'}</p>
        <button
          onClick={reset}
          style={{ padding: '8px 20px', background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}

'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--danger)' }}>Erreur</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>{error.message || 'Une erreur est survenue'}</p>
      <button
        onClick={reset}
        style={{ padding: '8px 20px', background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
      >
        Réessayer
      </button>
    </div>
  );
}

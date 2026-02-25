'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#ef4444' }}>Erreur</h2>
      <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16 }}>{error.message || 'Une erreur est survenue'}</p>
      <button
        onClick={reset}
        style={{ padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
      >
        Réessayer
      </button>
    </div>
  );
}

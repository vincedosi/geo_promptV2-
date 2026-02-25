import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: 48, fontWeight: 800, marginBottom: 4, color: '#6366f1' }}>404</h2>
      <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 20 }}>Page introuvable</p>
      <Link
        href="/"
        style={{ padding: '8px 20px', background: '#6366f1', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}

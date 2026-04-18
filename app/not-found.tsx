import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: 48, fontWeight: 800, marginBottom: 4, color: 'var(--brand-teal)' }}>404</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Page introuvable</p>
      <Link
        href="/"
        style={{ padding: '8px 20px', background: 'var(--text-primary)', color: 'var(--bg-primary)', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}

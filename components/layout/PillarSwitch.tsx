'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function PillarSwitch() {
  const pathname = usePathname() ?? '';
  const onMap = pathname.startsWith('/map');
  const seg = (active: boolean) => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 500, textDecoration: 'none', borderRadius: 5,
    color: active ? 'var(--background)' : 'var(--text-secondary)',
    background: active ? 'var(--brand-teal)' : 'transparent',
  } as const);
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)' }}>
      <Link href="/campaigns" style={seg(!onMap)}>Campagnes</Link>
      <Link href="/map" style={seg(onMap)}>Carte</Link>
    </div>
  );
}

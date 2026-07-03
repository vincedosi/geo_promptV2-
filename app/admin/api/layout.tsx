'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PROVIDERS, C, fInter } from './_lib/constants';

const TABS = [
  ...PROVIDERS.map((p) => ({ href: `/admin/api/${p.key}`, label: p.label })),
  { href: '/admin/api/logs', label: 'Logs' },
];

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ padding: '20px 24px 0' }}>
        <h1 style={{ fontFamily: fInter, fontWeight: 500, fontSize: 18, margin: 0 }}>
          Connexions API
        </h1>
        <p style={{ fontFamily: fInter, fontSize: 13, color: C.textSec, marginTop: 4 }}>
          Connecter les plateformes DSP pour le reporting et le custom bidding.
        </p>
      </div>

      <nav style={{ display: 'flex', gap: 4, padding: '16px 24px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                fontFamily: fInter, fontSize: 13, fontWeight: 500,
                padding: '8px 12px', textDecoration: 'none',
                color: active ? C.text : C.textDim,
                borderBottom: active ? `2px solid ${C.teal}` : '2px solid transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}

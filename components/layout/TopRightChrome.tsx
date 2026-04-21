'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

export function TopRightChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/map')) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
      }}
    >
      <ThemeToggle />
      <SessionBadge />
    </div>
  );
}

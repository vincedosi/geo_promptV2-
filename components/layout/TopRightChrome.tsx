'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PillarSwitch } from '@/components/layout/PillarSwitch';

export function TopRightChrome() {
  const pathname = usePathname();
  const onMap = pathname?.startsWith('/map');
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
      }}
    >
      <PillarSwitch />
      {!onMap && <ThemeToggle />}
      {!onMap && <SessionBadge />}
    </div>
  );
}

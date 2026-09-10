'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

export function TopRightChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/map')) return null;   // le chrome vit dans le banner de la carte
  // /reset-password s'adresse a quelqu'un qui n'est pas encore entre dans
  // l'application : ni selecteur d'organisation, ni menu utilisateur. Le badge
  // y produisait d'ailleurs deux 406 (il interrogeait `profiles` avec l'id de
  // la session precedente, que la RLS refuse).
  if (pathname?.startsWith('/reset-password')) return null;
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
      }}
    >
      <ThemeToggle />
      <SessionBadge />
    </div>
  );
}

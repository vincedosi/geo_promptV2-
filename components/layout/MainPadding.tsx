'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function MainPadding({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMap = pathname?.startsWith('/map');
  return (
    <main className={isMap ? 'min-h-screen' : 'md:pl-[240px] min-h-screen'}>
      <div className={isMap ? '' : 'p-8'}>
        {children}
      </div>
    </main>
  );
}

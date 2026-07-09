'use client';

/**
 * Lit /map?campaign=<id>&tab=<tab>, ouvre l'overlay MAGELIAN pré-positionné,
 * puis nettoie l'URL. Aucun fetch : la liste des campagnes est chargée par l'overlay.
 */
import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseMagelianParams } from './deep-link';
import { useMagelianOverlay } from './MagelianOverlayContext';

function MagelianDeepLinkInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openOverlay } = useMagelianOverlay();
  const lastHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (pathname !== '/map') {
      lastHandledRef.current = null;
      return;
    }
    const qs = searchParams.toString();
    if (!qs || qs === lastHandledRef.current) return;
    const req = parseMagelianParams(new URLSearchParams(qs));
    if (!req) return;
    lastHandledRef.current = qs;
    openOverlay(req);
    router.replace('/map', { scroll: false });
  }, [pathname, searchParams, openOverlay, router]);

  return null;
}

export function MagelianDeepLink() {
  return (
    <Suspense fallback={null}>
      <MagelianDeepLinkInner />
    </Suspense>
  );
}

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
  const handledRef = useRef(false);

  useEffect(() => {
    if (pathname !== '/map') {
      handledRef.current = false;
      return;
    }
    if (handledRef.current) return;
    const req = parseMagelianParams(new URLSearchParams(searchParams.toString()));
    if (!req) return;
    handledRef.current = true;
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

'use client';

/**
 * MAGELIAN — panneau de detail IRIS de la carte.
 *
 * Regroupe l'etat et les 2 effets qui vivaient dans app/map/page.tsx
 * (refactor du 31/08/2026) : branchement du clic sur la couche `iris-fill`
 * et chargement du detail socio-demo de l'IRIS selectionne.
 *
 * ⛔ A appeler APRES useMapInit : le hook a besoin de `mapRef` et `mapReady`.
 *
 * Le fetch cible /api/iris/detail (une seule zone a la fois) : ne jamais le
 * transformer en prefetch de plusieurs IRIS, la contrainte I/O Nano l'interdit.
 */
import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { IrisDetailData } from '@/app/map/_components/IrisDetailPanel';

export function useIrisDetail(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
) {
  const [selectedIrisCode,   setSelectedIrisCode]   = useState<string | null>(null);
  const [selectedIrisData,   setSelectedIrisData]   = useState<IrisDetailData | null>(null);
  const [irisDetailLoading,  setIrisDetailLoading]  = useState(false);
  const irisClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);


  // ── IRIS detail — click handler ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const LAYER = 'iris-fill';

    // Remove previous handler if any
    if (irisClickHandlerRef.current) {
      try { map.off('click', LAYER, irisClickHandlerRef.current); } catch { /* ok */ }
    }

    const handler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const code = feat.properties?.code_iris as string | undefined;
      if (!code) return;
      e.preventDefault?.();
      setSelectedIrisCode(code);
    };

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    irisClickHandlerRef.current = handler;
    map.on('click', LAYER, handler);
    map.on('mouseenter', LAYER, onEnter);
    map.on('mouseleave', LAYER, onLeave);

    return () => {
      try { map.off('click', LAYER, handler); } catch { /* ok */ }
      try { map.off('mouseenter', LAYER, onEnter); } catch { /* ok */ }
      try { map.off('mouseleave', LAYER, onLeave); } catch { /* ok */ }
    };
  }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── IRIS detail — fetch on code change ─────────────────────────────────────
  useEffect(() => {
    if (!selectedIrisCode) return;
    setIrisDetailLoading(true);
    setSelectedIrisData(prev => prev?.code_iris === selectedIrisCode ? prev : null);
    fetch(`/api/iris/detail?code_iris=${encodeURIComponent(selectedIrisCode)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: IrisDetailData) => { setSelectedIrisData(d); setIrisDetailLoading(false); })
      .catch(() => { setIrisDetailLoading(false); });
  }, [selectedIrisCode]);

  return { selectedIrisCode, setSelectedIrisCode, selectedIrisData, setSelectedIrisData, irisDetailLoading };
}

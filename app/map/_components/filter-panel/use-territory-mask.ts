/**
 * @file filter-panel/use-territory-mask.ts — masque hors-territoire MapLibre
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Assombrit tout sauf le territoire
 * selectionne : l'utilisateur voit exactement ce qui sera capture.
 *
 * Trois points a ne pas "simplifier" :
 *   - le ring monde est en sens antihoraire a lat 84.999 — aller a 90 produit
 *     des artefacts de projection Mercator ;
 *   - le masque est reordonne sous le premier layer `symbol` a chaque
 *     `styledata` ET `sourcedata` : sans ca, toute couche ajoutee apres lui
 *     (carreaux, IRIS, POI) passerait au-dessus et ne serait plus clippee,
 *     tandis que les labels de villes doivent rester lisibles au-dessus ;
 *   - la geometrie est mise en cache par (scale, codes) dans un ref : sans lui,
 *     chaque toggle du masque relance un POST territory-mask (budget I/O).
 */
import { useEffect, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import type { AdminScale } from './use-admin-scope-layer';

export interface TerritoryMask {
  territoryMaskEnabled: boolean;
  setTerritoryMaskEnabled: (v: boolean) => void;
}

export function useTerritoryMask(
  mainMapRef: React.MutableRefObject<MaplibreMap | null> | undefined,
  adminScale: AdminScale,
  adminCodes: string[],
): TerritoryMask {
  // ── Mode "Afficher uniquement le territoire filtre" ─────────────────────
  // Toggle qui ajoute un layer mask sur la carte : assombrit tout sauf le
  // territoire selectionne. L'user voit exactement ce qui sera capture.
  const [territoryMaskEnabled, setTerritoryMaskEnabled] = useState(false);
  const territoryMaskCacheRef = useRef<{ key: string; geom: GeoJSON.MultiPolygon | null } | null>(null);

  useEffect(() => {
    const map = mainMapRef?.current;
    if (!map) return;

    const cleanup = () => {
      try {
        if (map.getLayer('territory-mask-fill')) map.removeLayer('territory-mask-fill');
        if (map.getLayer('territory-mask-border')) map.removeLayer('territory-mask-border');
        if (map.getSource('territory-mask')) map.removeSource('territory-mask');
      } catch { /* noop */ }
    };

    if (!territoryMaskEnabled || !adminScale || adminCodes.length === 0) {
      cleanup();
      return;
    }

    const cacheKey = `${adminScale}::${adminCodes.slice().sort().join(',')}`;
    let cancelled = false;

    // Reorder : place le mask juste sous le premier layer de type symbol (labels).
    // Resultat : mask au-dessus des data layers (carreaux/POI/voronoi/IRIS) →
    // ils sont clippes visuellement par le mask hors-territoire. Mais reste sous
    // les labels villes/pays → labels lisibles.
    const reorderMask = () => {
      try {
        const layers = map.getStyle()?.layers ?? [];
        const firstSymbol = layers.find(l =>
          l.type === 'symbol' && l.id !== 'territory-mask-fill' && l.id !== 'territory-mask-border'
        );
        const beforeId = firstSymbol?.id;
        if (map.getLayer('territory-mask-fill')) {
          map.moveLayer('territory-mask-fill', beforeId);
        }
        if (map.getLayer('territory-mask-border')) {
          map.moveLayer('territory-mask-border', beforeId);
        }
      } catch { /* race condition pendant style swap, ignorer */ }
    };

    const applyMask = (territoryGeom: GeoJSON.MultiPolygon) => {
      if (cancelled) return;
      cleanup();
      // Ring monde : sens antihoraire (CCW) lat 84.999 pour eviter artefacts Mercator.
      const worldRing: number[][] = [
        [-180, 84.999], [180, 84.999], [180, -84.999], [-180, -84.999], [-180, 84.999],
      ];
      const holes: number[][][] = territoryGeom.coordinates.map(polygon => polygon[0]);
      const maskFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [worldRing, ...holes] },
      };
      const territoryFeature: GeoJSON.Feature<GeoJSON.MultiPolygon> = {
        type: 'Feature', properties: {}, geometry: territoryGeom,
      };
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection', features: [maskFeature, territoryFeature],
      };
      try {
        map.addSource('territory-mask', { type: 'geojson', data: fc });
        map.addLayer({
          id: 'territory-mask-fill',
          type: 'fill',
          source: 'territory-mask',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#000000', 'fill-opacity': 0.75 },
        });
        map.addLayer({
          id: 'territory-mask-border',
          type: 'line',
          source: 'territory-mask',
          filter: ['==', ['geometry-type'], 'MultiPolygon'],
          paint: { 'line-color': '#4ecdc4', 'line-width': 3 },
        });
        reorderMask();
      } catch (err) {
        console.warn('[territory-mask] add layer failed', err);
      }
    };

    // Re-reorder a chaque ajout de layer (carreaux, IRIS, etc.) qui passerait
    // automatiquement au-dessus du mask sinon. styledata = trigger MapLibre
    // pour tout changement structurel du style. sourcedata = trigger pour
    // chaque tuile MVT chargee tardivement dans une source existante.
    map.on('styledata',  reorderMask);
    map.on('sourcedata', reorderMask);

    // Cache hit : re-applique direct
    if (territoryMaskCacheRef.current && territoryMaskCacheRef.current.key === cacheKey) {
      const cached = territoryMaskCacheRef.current.geom;
      if (cached) applyMask(cached);
      return () => {
        cancelled = true;
        try { map.off('styledata',  reorderMask); } catch { /* noop */ }
        try { map.off('sourcedata', reorderMask); } catch { /* noop */ }
        cleanup();
      };
    }

    // Sinon fetch
    adminFetch('/api/map/territory-mask', {
      method: 'POST',
      body: JSON.stringify({ scale: adminScale, codes: adminCodes }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { geometry: GeoJSON.MultiPolygon | null } | null) => {
        if (cancelled) return;
        const geom = data?.geometry ?? null;
        territoryMaskCacheRef.current = { key: cacheKey, geom };
        if (geom) applyMask(geom);
      })
      .catch(() => { /* silent */ });

    return () => {
      cancelled = true;
      try { map.off('styledata',  reorderMask); } catch { /* noop */ }
      try { map.off('sourcedata', reorderMask); } catch { /* noop */ }
      cleanup();
    };
  }, [territoryMaskEnabled, adminScale, adminCodes, mainMapRef]);

  return { territoryMaskEnabled, setTerritoryMaskEnabled };
}

'use client';

/**
 * MAGELIAN — marqueurs POI de la carte et cadrage associe.
 *
 * Regroupe l'effet unique qui vivait dans app/map/page.tsx (refactor du
 * 31/08/2026) : pose des marqueurs de la zone courante, popups, couleur de
 * heatmap dynamique, marqueur ville, puis fitBounds / flyTo.
 *
 * ⛔ A appeler APRES useMapInit : le hook a besoin de `mapRef`, `markersRef`
 * et `mapReady`.
 *
 * Trois rendus coexistent volontairement selon le volume de POI :
 *   - > 500 POI (ou mode densite force) -> heatmap `pois-heat`
 *   - > 300 POI                         -> couches MapLibre (pas de DOM)
 *   - sinon                             -> marqueurs DOM + popups
 * Pas d'opacite conditionnee au zoom sur /map : les requetes nationales des
 * panneaux (PanneauFiltre, PanneauCalques) cadrent la France (z ~5-6) et
 * masqueraient tous les marqueurs.
 */
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { circleGeoJSON, getCatColor } from '@/app/copilote/_lib/constants';
import type { ZoneData } from '@/types/spatial';
import type { SelectedBillboard } from '@/types/map';
import type { POIStylesMap } from '@/app/map/_components/filter-panel/poi-style';
// L'echappement etait defini localement ici ; il vit desormais dans lib/map,
// partage par les treize popups du projet — et il couvre l'apostrophe, que la
// version locale omettait.
import { echapperHtml as esc } from '@/lib/map/echapper-html';


/**
 * Resout une couleur CSS en composantes RVB.
 *
 * Accepte un hex (#rgb ou #rrggbb), un rgb()/rgba(), ou un token du design
 * system (`var(--brand-teal)`) — ce dernier est lu sur `:root`, jamais code
 * en dur. Renvoie null si la valeur est illisible : l'appelant laisse alors
 * la couleur definie dans le style MapLibre plutot que d'en inventer une.
 */
export function resolveCssRgb(color: string): { r: number; g: number; b: number } | null {
  let value = color.trim();

  const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (token) {
    if (typeof document === 'undefined') return null;
    value = getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim();
  }

  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
    };
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return {
      r: parseInt(value[1] + value[1], 16),
      g: parseInt(value[2] + value[2], 16),
      b: parseInt(value[3] + value[3], 16),
    };
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const [r, g, b] = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ([r, g, b].every(n => Number.isFinite(n))) return { r, g, b };
  }

  return null;
}

export function useMapMarkers(
  mapRef: React.RefObject<maplibregl.Map | null>,
  markersRef: React.MutableRefObject<maplibregl.Marker[]>,
  mapReady: boolean,
  zoneData: ZoneData | null,
  densityMode: boolean,
  poiStyles: POIStylesMap,
  setSelectedBillboard: React.Dispatch<React.SetStateAction<SelectedBillboard | null>>,
) {
  // ── Markers + flyTo ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !zoneData || !zoneData.coordonnees) return;
    const { lat, lng } = zoneData.coordonnees;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const DENSITY_THRESHOLD = 500;
    const useDensity = densityMode || zoneData.pois.length > DENSITY_THRESHOLD;
    const useLayers  = !useDensity && zoneData.pois.length > 300;

    const heatSrc = map.getSource('pois-heat') as maplibregl.GeoJSONSource | undefined;
    if (heatSrc) {
      heatSrc.setData({
        type: 'FeatureCollection',
        features: zoneData.pois.map(p => {
          const ps = poiStyles[p.categorie];
          const color = ps?.color ?? zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: { id: p.id, categorie: p.categorie, nom: p.nom ?? '', color, lat: p.lat, lng: p.lng },
          };
        }),
      });
    }
    try { map.setLayoutProperty('pois-heatmap', 'visibility', useDensity ? 'visible' : 'none'); } catch { /* */ }
    try { map.setLayoutProperty('pois-circles', 'visibility', (useLayers || useDensity) ? 'visible' : 'none'); } catch { /* */ }

    // ── Couleur heatmap dynamique ──────────────────────────────────────────
    if (useDensity) {
      // Couleur de la catégorie affichée (1ère catégorie des POIs), sinon accent de marque.
      // La valeur peut être un token du design system : la parser comme un hex
      // donnerait rgba(10,NaN,-11,0) et MapLibre rejetterait toute l'expression.
      const firstCat = zoneData.pois[0]?.categorie;
      const color = (firstCat && poiStyles[firstCat]?.color) ?? zoneData.couleur_overrides?.[firstCat ?? ''] ?? 'var(--brand-teal)';
      const rgb = resolveCssRgb(color);
      if (rgb) {
        const { r, g, b } = rgb;
        try {
          map.setPaintProperty('pois-heatmap', 'heatmap-color', [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    `rgba(${r},${g},${b},0)`,
            0.15, `rgba(${r},${g},${b},0.25)`,
            0.4,  `rgba(${r},${g},${b},0.55)`,
            0.7,  `rgba(${r},${g},${b},0.82)`,
            1,    `rgba(${r},${g},${b},1)`,
          ]);
        } catch { /* */ }
      }
    }

    (map.getSource('zone-circle') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: zoneData.rayon_metres ? [circleGeoJSON(lng, lat, zoneData.rayon_metres)] : [],
    });
    map.triggerRepaint();

    const PIN_SIZE_PX: Record<string, number> = { Petite: 8, Standard: 12, Grosse: 16, Large: 22 };
    if (!useDensity && !useLayers) {
      zoneData.pois.forEach(p => {
        const ps = poiStyles[p.categorie];
        const color = ps?.color ?? zoneData.couleur_overrides?.[p.categorie] ?? getCatColor(p.categorie);
        const sizePx = PIN_SIZE_PX[ps?.size ?? 'Standard'] ?? 12;
        const rankVal = p.rank;
        const el = document.createElement('div');
        if (rankVal) {
          el.style.cssText = `width:22px;height:22px;background:${color};border:2px solid rgba(255,255,255,0.95);border-radius:50%;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;font-family:system-ui,sans-serif`;
          el.textContent = String(rankVal);
        } else {
          el.style.cssText = `width:${sizePx}px;height:${sizePx}px;background:${color};border:2px solid rgba(255,255,255,0.9);border-radius:50%;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)`;
        }
        const nom = esc(p.nom || 'POI');
        const audienceVal = p.audience;
        const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<div style="font-size:12px;padding:6px 8px;color:var(--text-secondary)">` +
          (rankVal ? `<span style="color:#f59e0b;font-weight:700;font-size:13px">#${rankVal}</span> ` : '') +
          `<strong style="color:var(--text-primary);font-size:13px">${nom}</strong><br/>` +
          `<span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase">${esc(p.categorie)}</span>` +
          (p.sous_categorie ? ` <span style="color:var(--text-tertiary);font-size:11px">· ${esc(p.sous_categorie)}</span>` : '') +
          (audienceVal != null ? `<br/><span style="color:var(--success);font-size:12px;font-weight:600">+${Number(audienceVal).toLocaleString('fr-FR')} pers.</span>` : '') +
          (p.adresse ? `<br/><span style="color:var(--text-tertiary);font-size:11px">${esc(p.adresse)}</span>` : '') +
          `</div>`
        );
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);

        if (p.categorie === 'panneaux' || p.categorie === 'top_ooh') {
          el.addEventListener('click', () => {
            setSelectedBillboard({ id: p.id, nom: p.nom ?? 'Panneau', lat: p.lat, lng: p.lng,
              format: p.sous_categorie ?? undefined, score: p.score_ooh ?? null,
              audience: p.audience ?? null, rank: p.rank ?? null, regie: p.adresse ?? undefined });
          });
        }
      });
    }

    // Marqueur ville
    const cityEl = document.createElement('div');
    cityEl.style.cssText = 'width:10px;height:10px;background:var(--brand-teal);border:2px solid #fff;border-radius:2px';
    markersRef.current.push(new maplibregl.Marker({ element: cityEl, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));

    if (zoneData.pois.length > 1) {
      const lats = zoneData.pois.map(p => p.lat);
      const lngs = zoneData.pois.map(p => p.lng);
      map.fitBounds(
        new maplibregl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
        { padding: 40, maxZoom: useLayers ? 7 : 14, duration: 1200 }
      );
      return;
    }
    const r = zoneData.rayon_metres, rPoi = zoneData.rayon_poi_metres;
    let zoom = 12;
    if (rPoi) zoom = rPoi < 300 ? 15 : rPoi < 800 ? 14 : rPoi < 2000 ? 13 : 12;
    else if (r) zoom = r < 1500 ? 14 : r < 4000 ? 13 : 11;
    map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
  }, [zoneData, mapReady, densityMode, poiStyles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: no zoom-based opacity hiding on /map page — markers stay visible at all zoom levels.
  // (the panels send national queries that fitBounds to France zoom ~5-6, hiding markers at z<10)
}

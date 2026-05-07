'use client';

/**
 * WeightingMiniMap
 *
 * Mini-carte du wizard Step 2 (pondération).
 *   • Charge les CPs (polygones GeoJSON) dans le bbox de la zone via /api/digital/codes-postaux
 *   • Calcule le multiplier de chaque CP CLIENT-SIDE via lib/strategy-wizard/multiplier
 *     → repaint instantané sur chaque drag de slider, ZÉRO appel réseau supplémentaire
 *   • Trace l'outline de chaque sous-zone native (ex: 4 CIRFA pour Cirfa Bretagne)
 *   • Tooltip hover : "75001 — Premium urbain — ×2.0 (+100%)"
 *   • Légende gradient en bas
 *
 * Plein écran via le bouton Maximize de l'OverlayPanel parent (l'aside garde son scroll).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { adminFetch } from '@/lib/admin-fetch';
import {
  computeMultiplier, inferTier, colorForMultiplier, plainFrenchForMultiplier,
  TIER_LABELS_FR, MULTIPLIER_COLOR_SCALE,
  type InZoneWeights, type OutZoneWeights, type SubzoneInput,
} from '@/lib/strategy-wizard/multiplier';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

// Couleurs de bordure pour les sous-zones (max 8 — au-delà on cycle)
const SUBZONE_COLORS = [
  '#4ecdc4', '#f7b731', '#e879f9', '#60a5fa',
  '#fb923c', '#34d399', '#f472b6', '#a78bfa',
];

export interface SubzoneNative {
  id: string;
  name: string;
  cp_count: number;
  iris_count: number;
  /** Multiplier courant (controlé par le parent — slider). */
  multiplier: number;
}

interface Props {
  /** Bbox [minLng, minLat, maxLng, maxLat] de la zone parente (sinon France métro). */
  bbox?: [number, number, number, number] | null;
  /** Liste des CPs in-zone (issue de /api/custom-geo/[id]/codes ou de la geom résolue). */
  inZoneCps: Set<string>;
  /** Mapping CP → subzone_id (issu de /api/custom-geo/[id]). Permet override par sous-zone. */
  cpToSubzone?: Map<string, string>;
  /** Liste des sous-zones natives avec leur multiplier courant — utilisé pour override. */
  subzones?: SubzoneNative[];
  inZoneWeights: InZoneWeights;
  outZoneWeights: OutZoneWeights;
  /** Sous-zones manuelles (mode by_subzone non-natif). */
  manualSubzones?: SubzoneInput[];
  /** Valeurs INSEE par CP (mode by_insee_variable). */
  inseeValues?: Record<string, number>;
  /** Si true, charge tous les CPs de France métro (mode national + by_insee_variable).
   *  Sinon, charge uniquement les CPs dans le bbox de la zone. */
  fullFranceMode?: boolean;
  /** Hauteur (px). Default 280. */
  height?: number;
}

interface CpFeatureProps {
  code_postal: string;
  [k: string]: unknown;
}

const FRANCE_BBOX: [number, number, number, number] = [-5.5, 41.0, 10.0, 51.5];
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export function WeightingMiniMap({
  bbox, inZoneCps, cpToSubzone, subzones,
  inZoneWeights, outZoneWeights, manualSubzones,
  inseeValues, fullFranceMode = false,
  height = 280,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Garde-fou : le bbox vient d'une API et peut être malformé (null, type
  // inattendu, valeurs hors-range). On retombe sur la France métro plutôt
  // que de crasher.
  const effectiveBbox: [number, number, number, number] = useMemo(() => {
    if (fullFranceMode) return FRANCE_BBOX;
    if (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every(n => typeof n === 'number' && Number.isFinite(n))
    ) {
      return bbox as [number, number, number, number];
    }
    return FRANCE_BBOX;
  }, [bbox, fullFranceMode]);
  const bboxKey = effectiveBbox.join(',');

  // Multiplier par sous-zone native (pour override rapide via cpToSubzone)
  const subzoneMultMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const sz of subzones ?? []) m.set(sz.id, sz.multiplier);
    return m;
  }, [subzones]);

  // ─── Init MapLibre ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds: effectiveBbox,
      fitBoundsOptions: { padding: 16, animate: false },
      attributionControl: false,
      interactive: true,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.on('load', () => setReady(true));
    mapRef.current = m;
    return () => { m.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit bounds quand le bbox change (zone change)
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    mapRef.current.fitBounds(effectiveBbox, { padding: 16, animate: true, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, ready]);

  // ─── Fetch CPs en bbox ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminFetch(`/api/digital/codes-postaux?bbox=${bboxKey}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        setGeojson(j);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [bboxKey]);

  // ─── Enrichit le GeoJSON avec multiplier par CP ──────────────────────────
  const enrichedGeoJSON = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!geojson) return null;
    // En mode INSEE+France entière, tous les CPs sont considérés "in-zone"
    // (la pondération vient de la courbe sur la variable, pas d'un découpage géo).
    const treatAllAsInZone = fullFranceMode;
    return {
      type: 'FeatureCollection',
      features: geojson.features.map(f => {
        const props = (f.properties ?? {}) as CpFeatureProps;
        const cp = String(props.code_postal ?? '');
        const isIn = treatAllAsInZone || inZoneCps.has(cp);

        // Override par sous-zone native si applicable
        let m: number;
        const szId = cpToSubzone?.get(cp);
        if (isIn && szId && subzoneMultMap.has(szId)) {
          m = subzoneMultMap.get(szId) ?? 1.0;
        } else {
          m = computeMultiplier(isIn, cp, inZoneWeights, outZoneWeights, manualSubzones, inseeValues);
        }

        return {
          ...f,
          properties: {
            ...props,
            __m: m,
            __color: colorForMultiplier(m),
            __in_zone: isIn,
            __tier: inferTier(cp),
            __insee_value: inseeValues?.[cp] ?? null,
          },
        };
      }),
    };
  }, [geojson, inZoneCps, cpToSubzone, subzoneMultMap, inZoneWeights, outZoneWeights, manualSubzones, inseeValues, fullFranceMode]);

  // ─── Layer choroplèthe ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enrichedGeoJSON) return;

    const SOURCE = 'cps';
    const FILL = 'cps-fill';
    const LINE = 'cps-line';

    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: enrichedGeoJSON });
      map.addLayer({
        id: FILL,
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': ['get', '__color'],
          'fill-opacity': [
            'case',
            ['get', '__in_zone'], 0.7,
            0.3,
          ],
        },
      });
      map.addLayer({
        id: LINE,
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': '#ffffff',
          'line-width': 0.3,
          'line-opacity': 0.4,
        },
      });

      // Hover tooltip
      map.on('mousemove', FILL, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        const cp = String(p.code_postal ?? '');
        const m = Number(p.__m ?? 1);
        const tier = String(p.__tier ?? 'rural');
        const inZone = Boolean(p.__in_zone);
        const inseeVal = p.__insee_value;
        if (popupRef.current) popupRef.current.remove();
        const inseeLine = (inseeVal !== null && inseeVal !== undefined && inseeVal !== '')
          ? `<div style="font-family: ${fMono}; color: #f7b731; font-size: 10px;">📊 ${Number(inseeVal).toFixed(1)}</div>`
          : '';
        popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family: ${fInter}; font-size: 11px; color: #f0f0f0; line-height: 1.5;">
              <div style="font-weight: 500;">${cp}</div>
              <div style="color: #a0a0a0; font-size: 10px;">${TIER_LABELS_FR[tier as keyof typeof TIER_LABELS_FR] ?? tier}${inZone ? '' : ' · hors zone'}</div>
              ${inseeLine}
              <div style="font-family: ${fMono}; color: #4ecdc4; margin-top: 2px;">×${m.toFixed(2)} — ${plainFrenchForMultiplier(m)}</div>
            </div>
          `)
          .addTo(map);
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', FILL, () => {
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        map.getCanvas().style.cursor = '';
      });
    } else {
      const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource;
      src.setData(enrichedGeoJSON);
    }
  }, [enrichedGeoJSON, ready]);

  // ─── Légende multiplier ──────────────────────────────────────────────────
  const legendStops = MULTIPLIER_COLOR_SCALE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          borderRadius: 6,
          overflow: 'hidden',
          border: '0.5px solid var(--border-subtle)',
          background: 'var(--bg-level-1)',
        }}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {(loading || error) && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(10,10,10,0.6)', color: 'var(--text-tertiary)',
            fontFamily: fMono, fontSize: 11, padding: 12, textAlign: 'center',
          }}>
            {error ? `Erreur : ${error}` : 'Chargement de la carte…'}
          </div>
        )}
      </div>

      {/* Légende */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, height: 6, borderRadius: 3, overflow: 'hidden' }}>
        {legendStops.map((s, i) => (
          <div
            key={i}
            title={`< ×${Number.isFinite(s.ltMax) ? s.ltMax : '∞'} — ${s.label}`}
            style={{ flex: 1, background: s.color }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
        <span>×0 exclu</span>
        <span>×1 neutre</span>
        <span>×5 max</span>
      </div>

      {/* Légende des sous-zones natives (si présentes) */}
      {subzones && subzones.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {subzones.map((sz, i) => (
            <span
              key={sz.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontFamily: fInter, color: 'var(--text-secondary)',
                padding: '2px 6px', borderRadius: 4,
                background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
              }}
              title={`${sz.cp_count} CPs · ${sz.iris_count} IRIS`}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SUBZONE_COLORS[i % SUBZONE_COLORS.length] }} />
              {sz.name} <span style={{ fontFamily: fMono, color: 'var(--text-tertiary)' }}>×{sz.multiplier.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

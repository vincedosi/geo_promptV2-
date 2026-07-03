'use client';

/**
 * PollenMapLayer — carte des allergènes : choroplèthe de l'indice pollen
 * par département (échantillonnage : 1 commune représentative par dept,
 * données Atmo France mises en cache 24h côté serveur).
 *
 * Mécanique :
 *   • visible=true : fetch polygones départements (/api/meteo-geo/zones,
 *     cache CDN 1 sem.) + stream NDJSON /api/civic-indicators/pollen-map ;
 *     la source est re-peinte au fil du stream (progression visible).
 *   • visible=false : nettoie source/layers/popup.
 *   • Clic : popup indice global + 6 espèces + mention ODbL obligatoire.
 *
 * Couleurs : tokens CSS --pollen-level-N lus au runtime (getComputedStyle)
 * — MapLibre ne résout pas var(), et on respecte le thème actif.
 * Ne rend rien dans le DOM React.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import type { PollenIndicator, PollenLevel, PollenSpecies } from '@/lib/civic-health/types';

export const POLLEN_SOURCE_ID = 'pollen-zones';
const FILL_ID = 'pollen-zones-fill';
const LINE_ID = 'pollen-zones-line';

const SPECIES_LABELS: Array<[PollenSpecies, string]> = [
  ['ambroisie', 'Ambroisie'],
  ['armoise', 'Armoise'],
  ['aulne', 'Aulne'],
  ['bouleau', 'Bouleau'],
  ['graminees', 'Graminées'],
  ['olivier', 'Olivier'],
];

interface DeptPollenLine {
  type: 'meta' | 'dept' | 'done';
  total?: number;
  code_dept?: string;
  nom_dept?: string;
  pollen?: PollenIndicator | null;
  stale?: boolean;
}

/** Lit les couleurs pollen du thème actif (tokens CSS → hex utilisables par MapLibre). */
function readPollenColors(): Record<PollenLevel, string> {
  const style = getComputedStyle(document.documentElement);
  const colors = {} as Record<PollenLevel, string>;
  for (let lvl = 0 as PollenLevel; lvl <= 6; lvl++) {
    colors[lvl as PollenLevel] = style.getPropertyValue(`--pollen-level-${lvl}`).trim() || '#555555';
  }
  return colors;
}

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  visible: boolean;
  /** Progression du stream (départements traités / total) — pour le panel. */
  onProgress?: (done: number, total: number) => void;
  opacity?: number;
}

export function PollenMapLayer({ mapRef, visible, onProgress, opacity = 0.55 }: Props) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const pollenByDeptRef = useRef<Map<string, { pollen: PollenIndicator; stale: boolean; nom: string }>>(new Map());

  const cleanup = (map: maplibregl.Map) => {
    if (clickRef.current) map.off('click', FILL_ID, clickRef.current);
    clickRef.current = null;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(POLLEN_SOURCE_ID)) map.removeSource(POLLEN_SOURCE_ID);
    pollenByDeptRef.current.clear();
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!visible) {
      cleanup(map);
      return;
    }

    let cancelled = false;
    const colors = readPollenColors();

    (async () => {
      try {
        // 1. Polygones départements (géo stable, cache navigateur/CDN)
        const zonesRes = await adminFetch('/api/meteo-geo/zones?scale=departement');
        if (!zonesRes.ok) throw new Error(`zones HTTP ${zonesRes.status}`);
        const zones = await zonesRes.json() as GeoJSON.FeatureCollection;
        if (cancelled) return;
        const m = mapRef.current;
        if (!m) return;

        cleanup(m);
        m.addSource(POLLEN_SOURCE_ID, { type: 'geojson', data: zones });

        // Peinture par niveau (match sur property indice, -1 = pas encore chargé)
        const matchExpr: maplibregl.ExpressionSpecification = [
          'match', ['coalesce', ['get', 'indice'], -1],
          0, colors[0], 1, colors[1], 2, colors[2], 3, colors[3],
          4, colors[4], 5, colors[5], 6, colors[6],
          'rgba(0,0,0,0)', // départements sans donnée : transparents
        ] as maplibregl.ExpressionSpecification;

        m.addLayer({
          id: FILL_ID, type: 'fill', source: POLLEN_SOURCE_ID,
          paint: { 'fill-color': matchExpr, 'fill-opacity': opacity },
        });
        m.addLayer({
          id: LINE_ID, type: 'line', source: POLLEN_SOURCE_ID,
          paint: { 'line-color': colors[0], 'line-width': 0.4, 'line-opacity': 0.5 },
        });

        const applyPollen = () => {
          const src = m.getSource(POLLEN_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (!src) return;
          const merged: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: zones.features.map(f => {
              const code = String(f.properties?.code ?? '');
              const entry = pollenByDeptRef.current.get(code);
              return {
                ...f,
                properties: {
                  ...f.properties,
                  indice: entry ? entry.pollen.indice_global : null,
                  stale: entry?.stale ?? false,
                },
              };
            }),
          };
          src.setData(merged);
        };

        // Popup clic : indice global + détail 6 espèces + mention ODbL
        const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const code = String(f.properties?.code ?? '');
          const entry = pollenByDeptRef.current.get(code);
          if (popupRef.current) popupRef.current.remove();
          const rows = entry
            ? SPECIES_LABELS.map(([key, label]) => {
                const lvl = entry.pollen.especes[key];
                return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-secondary);">
                  <span>${label}</span>
                  <span style="font-family:'JetBrains Mono',monospace;color:${colors[lvl]};">${lvl} — ${POLLEN_LEVEL_LABELS[lvl]}</span>
                </div>`;
              }).join('')
            : '<div style="font-size:11px;color:var(--text-tertiary);">Donnée indisponible</div>';
          popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:'Inter',system-ui,sans-serif;line-height:1.5;padding:4px 2px;">
                <div style="font-size:12px;color:var(--text-primary);font-weight:500;margin-bottom:4px;">
                  ${String(f.properties?.nom ?? code)} (${code})
                </div>
                ${entry ? `
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${colors[entry.pollen.indice_global]};display:inline-block;"></span>
                    <span style="font-size:12px;color:var(--text-primary);">Indice pollen ${entry.pollen.indice_global}/6 — ${POLLEN_LEVEL_LABELS[entry.pollen.indice_global]}${entry.stale ? ' (donnée de la veille)' : ''}</span>
                  </div>` : ''}
                ${rows}
                <div style="font-size:9px;color:var(--text-tertiary);margin-top:8px;">Source : Atmo France et les AASQA (ODbL) — échantillon : 1 commune par département</div>
              </div>
            `)
            .addTo(m);
        };
        m.on('click', FILL_ID, onClick);
        clickRef.current = onClick;

        // 2. Stream NDJSON pollen — repeint tous les 10 départements
        const res = await adminFetch('/api/civic-indicators/pollen-map');
        if (!res.ok || !res.body) throw new Error(`pollen-map HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let total = 0;
        let done = 0;
        let sinceRepaint = 0;

        for (;;) {
          const { value, done: eof } = await reader.read();
          if (cancelled) { reader.cancel().catch(() => {}); return; }
          if (eof) break;
          buffer += decoder.decode(value, { stream: true });
          const nlLines = buffer.split('\n');
          buffer = nlLines.pop() ?? '';
          for (const raw of nlLines) {
            if (!raw.trim()) continue;
            let line: DeptPollenLine;
            try { line = JSON.parse(raw) as DeptPollenLine; } catch { continue; }
            if (line.type === 'meta') { total = line.total ?? 0; continue; }
            if (line.type === 'dept' && line.code_dept) {
              done++;
              if (line.pollen) {
                pollenByDeptRef.current.set(line.code_dept, {
                  pollen: line.pollen,
                  stale: line.stale ?? false,
                  nom: line.nom_dept ?? line.code_dept,
                });
              }
              sinceRepaint++;
              if (sinceRepaint >= 10) { applyPollen(); sinceRepaint = 0; }
              onProgress?.(done, total);
            }
          }
        }
        applyPollen();
        onProgress?.(done, total || done);
      } catch (err) {
        if (!cancelled) console.error('[PollenMapLayer]', err);
      }
    })();

    return () => {
      cancelled = true;
      const m = mapRef.current;
      if (m) cleanup(m);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, opacity]);

  return null;
}

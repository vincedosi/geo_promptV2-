'use client';

/**
 * PollenMapLayer — carte des allergènes : choroplèthe de l'indice pollen.
 *
 * Deux échelles :
 *   • departement — échantillonnage 1 commune représentative/dept, stream
 *     NDJSON /api/civic-indicators/pollen-map (progression visible) ;
 *   • cp — lecture pollen_map_daily (ingestion bulk nationale), niveaux max
 *     des communes du code postal. Filtre SQL côté serveur.
 *
 * Filtres (seuil minimum + espèce) : appliqués au repaint sans refetch —
 * les données chargées restent en ref, seule la propriété `indice` des
 * features est recalculée. En dessous du seuil : transparent.
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

export type PollenScale = 'departement' | 'cp';
export type PollenEspece = 'global' | PollenSpecies;

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

interface CpPollenRow {
  code_postal: string;
  indice_global: PollenLevel;
  ambroisie: PollenLevel;
  armoise: PollenLevel;
  aulne: PollenLevel;
  bouleau: PollenLevel;
  graminees: PollenLevel;
  olivier: PollenLevel;
  nb_communes: number;
}

/** Donnée normalisée par zone (dept ou CP) pour le repaint et la popup. */
interface ZoneEntry {
  nom: string;
  indice_global: PollenLevel;
  especes: Record<PollenSpecies, PollenLevel>;
  stale: boolean;
  nbCommunes?: number;
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

function metricOf(entry: ZoneEntry, espece: PollenEspece): PollenLevel {
  return espece === 'global' ? entry.indice_global : entry.especes[espece];
}

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  visible: boolean;
  /** Échelle des zones : département (échantillonné) ou code postal (bulk). */
  scale?: PollenScale;
  /** Niveau minimum affiché (0 = tous) — en dessous : transparent. */
  minLevel?: number;
  /** Métrique peinte/filtrée : indice global ou une espèce. */
  espece?: PollenEspece;
  /** Incrémenté après une ingestion admin pour forcer le rechargement. */
  refreshKey?: number;
  /** Progression du stream département (départements traités / total). */
  onProgress?: (done: number, total: number) => void;
  /** Statut de la donnée CP : 'no_data' si l'ingestion n'a jamais tourné. */
  onCpDataStatus?: (status: 'ok' | 'no_data', date: string | null) => void;
  opacity?: number;
}

export function PollenMapLayer({
  mapRef,
  visible,
  scale = 'departement',
  minLevel = 0,
  espece = 'global',
  refreshKey = 0,
  onProgress,
  onCpDataStatus,
  opacity = 0.55,
}: Props) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const entriesRef = useRef<Map<string, ZoneEntry>>(new Map());
  const zonesRef = useRef<GeoJSON.FeatureCollection | null>(null);
  // Filtres actifs — lus par applyPaint/popup sans re-déclencher l'effet data
  const filterRef = useRef<{ minLevel: number; espece: PollenEspece }>({ minLevel, espece });
  filterRef.current = { minLevel, espece };

  const cleanup = (map: maplibregl.Map) => {
    if (clickRef.current) map.off('click', FILL_ID, clickRef.current);
    clickRef.current = null;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(POLLEN_SOURCE_ID)) map.removeSource(POLLEN_SOURCE_ID);
    entriesRef.current.clear();
    zonesRef.current = null;
  };

  /** Recalcule la propriété `indice` des features selon les filtres actifs. */
  const applyPaint = (map: maplibregl.Map) => {
    const src = map.getSource(POLLEN_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const zones = zonesRef.current;
    if (!src || !zones) return;
    const { minLevel: min, espece: sp } = filterRef.current;
    const threshold = Math.max(min, 1); // 0 = indisponible, jamais peint
    const merged: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.features.map(f => {
        const code = String(f.properties?.code ?? '');
        const entry = entriesRef.current.get(code);
        const value = entry ? metricOf(entry, sp) : null;
        return {
          ...f,
          properties: {
            ...f.properties,
            indice: value != null && value >= threshold ? value : null,
          },
        };
      }),
    };
    src.setData(merged);
  };

  // ── Effet data : (re)charge zones + valeurs quand visible/échelle change ──
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
        // 1. Polygones des zones (géo stable, cache navigateur/CDN)
        const zonesRes = await adminFetch(`/api/meteo-geo/zones?scale=${scale}`);
        if (!zonesRes.ok) throw new Error(`zones HTTP ${zonesRes.status}`);
        const zones = await zonesRes.json() as GeoJSON.FeatureCollection;
        if (cancelled) return;
        const m = mapRef.current;
        if (!m) return;

        cleanup(m);
        zonesRef.current = zones;
        m.addSource(POLLEN_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        // Peinture par niveau (match sur property indice, null/-1 = transparent)
        const matchExpr: maplibregl.ExpressionSpecification = [
          'match', ['coalesce', ['get', 'indice'], -1],
          1, colors[1], 2, colors[2], 3, colors[3],
          4, colors[4], 5, colors[5], 6, colors[6],
          'rgba(0,0,0,0)', // sous le seuil ou sans donnée : transparent
        ] as maplibregl.ExpressionSpecification;

        m.addLayer({
          id: FILL_ID, type: 'fill', source: POLLEN_SOURCE_ID,
          paint: { 'fill-color': matchExpr, 'fill-opacity': opacity },
        });
        m.addLayer({
          id: LINE_ID, type: 'line', source: POLLEN_SOURCE_ID,
          paint: { 'line-color': colors[0], 'line-width': 0.4, 'line-opacity': 0.5 },
        });

        // Popup clic : indice global + détail 6 espèces + mention ODbL
        const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const code = String(f.properties?.code ?? '');
          const entry = entriesRef.current.get(code);
          if (popupRef.current) popupRef.current.remove();
          const rows = entry
            ? SPECIES_LABELS.map(([key, label]) => {
                const lvl = entry.especes[key];
                return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-secondary);">
                  <span>${label}</span>
                  <span style="font-family:'JetBrains Mono',monospace;color:${colors[lvl]};">${lvl} — ${POLLEN_LEVEL_LABELS[lvl]}</span>
                </div>`;
              }).join('')
            : '<div style="font-size:11px;color:var(--text-tertiary);">Donnée indisponible</div>';
          const sampleNote = scale === 'cp'
            ? `max des ${entry?.nbCommunes ?? '?'} commune(s) du code postal`
            : 'échantillon : 1 commune par département';
          popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:'Inter',system-ui,sans-serif;line-height:1.5;padding:4px 2px;">
                <div style="font-size:12px;color:var(--text-primary);font-weight:500;margin-bottom:4px;">
                  ${String(f.properties?.nom ?? code)} (${code})
                </div>
                ${entry ? `
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${colors[entry.indice_global]};display:inline-block;"></span>
                    <span style="font-size:12px;color:var(--text-primary);">Indice pollen ${entry.indice_global}/6 — ${POLLEN_LEVEL_LABELS[entry.indice_global]}${entry.stale ? ' (donnée de la veille)' : ''}</span>
                  </div>` : ''}
                ${rows}
                <div style="font-size:9px;color:var(--text-tertiary);margin-top:8px;">Source : Atmo France et les AASQA (ODbL) — ${sampleNote}</div>
              </div>
            `)
            .addTo(m);
        };
        m.on('click', FILL_ID, onClick);
        clickRef.current = onClick;

        // 2. Valeurs pollen selon l'échelle
        if (scale === 'cp') {
          // min_level=0 volontaire : on charge tout (~6 200 lignes, léger) et
          // le seuil/espèce est appliqué au paint — changer de filtre ne
          // redéclenche aucun fetch.
          const res = await adminFetch('/api/civic-indicators/pollen-map?scale=cp&min_level=0&espece=global');
          if (!res.ok) throw new Error(`pollen-map cp HTTP ${res.status}`);
          const payload = await res.json() as { date: string | null; rows: CpPollenRow[]; error?: string };
          if (cancelled) return;
          if (!payload.date) {
            onCpDataStatus?.('no_data', null);
            applyPaint(m);
            return;
          }
          onCpDataStatus?.('ok', payload.date);
          for (const r of payload.rows) {
            entriesRef.current.set(r.code_postal, {
              nom: r.code_postal,
              indice_global: r.indice_global,
              especes: {
                ambroisie: r.ambroisie, armoise: r.armoise, aulne: r.aulne,
                bouleau: r.bouleau, graminees: r.graminees, olivier: r.olivier,
              },
              stale: false,
              nbCommunes: r.nb_communes,
            });
          }
          applyPaint(m);
          return;
        }

        // Échelle département — stream NDJSON, repeint tous les 10 départements
        const res = await adminFetch('/api/civic-indicators/pollen-map?scale=departement');
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
                entriesRef.current.set(line.code_dept, {
                  nom: line.nom_dept ?? line.code_dept,
                  indice_global: line.pollen.indice_global,
                  especes: line.pollen.especes,
                  stale: line.stale ?? false,
                });
              }
              sinceRepaint++;
              if (sinceRepaint >= 10) { applyPaint(m); sinceRepaint = 0; }
              onProgress?.(done, total);
            }
          }
        }
        applyPaint(m);
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
  }, [visible, scale, opacity, refreshKey]);

  // ── Effet filtre : repaint sans refetch quand seuil/espèce change ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !visible) return;
    applyPaint(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLevel, espece]);

  return null;
}

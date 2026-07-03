'use client';

/**
 * CivicHealthMapLayer — choroplèthe santé environnementale : indice pollen
 * (carte des allergènes) ou indice ATMO (qualité de l'air), un dataset actif
 * à la fois.
 *
 * Deux échelles :
 *   • departement — échantillonnage 1 commune représentative/dept, stream
 *     NDJSON /api/civic-indicators/health-map (progression visible, chaque
 *     ligne porte pollen ET air — un seul stream sert les deux datasets) ;
 *   • cp — lecture pollen_map_daily / atmo_map_daily (ingestion bulk WFS
 *     nationale), niveaux max des communes du code postal.
 *
 * Filtres (seuil minimum + métrique) : appliqués au repaint sans refetch —
 * les données chargées restent en ref, seule la propriété `indice` des
 * features est recalculée. En dessous du seuil : transparent.
 *
 * Couleurs : tokens CSS --pollen-level-N / --atmo-level-N lus au runtime
 * (getComputedStyle) — MapLibre ne résout pas var(), et on respecte le
 * thème actif. Ne rend rien dans le DOM React.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { ATMO_LEVEL_LABELS, POLLEN_LEVEL_LABELS } from '@/lib/civic-health/levels';
import type { AirIndicator, AtmoLevel, PollenIndicator } from '@/lib/civic-health/types';

export const CIVIC_SOURCE_ID = 'civic-health-zones';
const FILL_ID = 'civic-health-zones-fill';
const LINE_ID = 'civic-health-zones-line';

export type CivicDataset = 'pollen' | 'atmo';
export type CivicScale = 'departement' | 'cp';

/** Libellé d'un niveau selon le dataset (0 = indisponible côté pollen). */
export function civicLevelLabel(dataset: CivicDataset, lvl: number): string {
  if (dataset === 'pollen') return POLLEN_LEVEL_LABELS[lvl as keyof typeof POLLEN_LEVEL_LABELS] ?? '—';
  return lvl >= 1 && lvl <= 6 ? ATMO_LEVEL_LABELS[lvl as AtmoLevel] : 'indisponible';
}

/** Sous-métriques affichées dans la popup, par dataset. */
const METRIC_LABELS: Record<CivicDataset, Array<[string, string]>> = {
  pollen: [
    ['ambroisie', 'Ambroisie'],
    ['armoise', 'Armoise'],
    ['aulne', 'Aulne'],
    ['bouleau', 'Bouleau'],
    ['graminees', 'Graminées'],
    ['olivier', 'Olivier'],
  ],
  atmo: [
    ['no2', 'Dioxyde d’azote (NO₂)'],
    ['o3', 'Ozone (O₃)'],
    ['pm10', 'Particules PM10'],
    ['pm25', 'Particules fines PM2.5'],
    ['so2', 'Dioxyde de soufre (SO₂)'],
  ],
};

interface DeptLine {
  type: 'meta' | 'dept' | 'done';
  total?: number;
  code_dept?: string;
  nom_dept?: string;
  pollen?: PollenIndicator | null;
  air?: AirIndicator | null;
  stale?: boolean;
}

interface CpRow {
  code_postal: string;
  indice_global: number;
  nb_communes: number;
  alerte?: boolean;
  [metric: string]: string | number | boolean | undefined;
}

/** Donnée normalisée par zone (dept ou CP) pour le repaint et la popup. */
interface ZoneEntry {
  nom: string;
  indice_global: number;
  metrics: Record<string, number>;
  /** Concentrations pollen en grains/m³ (max des communes en mode CP). */
  concentrations?: Record<string, number>;
  /** Alerte pollen Atmo France sur la zone. */
  alerte?: boolean;
  stale: boolean;
  nbCommunes?: number;
}

/** Lit les couleurs du thème actif (tokens CSS → hex utilisables par MapLibre). */
function readColors(dataset: CivicDataset): Record<number, string> {
  const style = getComputedStyle(document.documentElement);
  const prefix = dataset === 'pollen' ? '--pollen-level-' : '--atmo-level-';
  const colors: Record<number, string> = {};
  for (let lvl = 1; lvl <= 6; lvl++) {
    colors[lvl] = style.getPropertyValue(`${prefix}${lvl}`).trim() || '#555555';
  }
  colors[0] = style.getPropertyValue(dataset === 'pollen' ? '--pollen-level-0' : '--atmo-level-na').trim() || '#555555';
  return colors;
}

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Dataset actif — null : couche masquée. */
  dataset: CivicDataset | null;
  /** Échelle des zones : département (échantillonné) ou code postal (bulk). */
  scale?: CivicScale;
  /** Niveau minimum affiché (0 = tous) — en dessous : transparent. */
  minLevel?: number;
  /** Métrique peinte/filtrée : 'global' ou une espèce/un polluant. */
  metric?: string;
  /** Incrémenté après une ingestion admin pour forcer le rechargement. */
  refreshKey?: number;
  /** Progression du stream département (départements traités / total). */
  onProgress?: (done: number, total: number) => void;
  /** Statut de la donnée CP : 'no_data' si l'ingestion n'a jamais tourné. */
  onCpDataStatus?: (status: 'ok' | 'no_data', date: string | null) => void;
  /** Fin de chargement (succès ou erreur) — pour l'état loading du panel. */
  onLoadingChange?: (loading: boolean) => void;
  opacity?: number;
}

export function CivicHealthMapLayer({
  mapRef,
  dataset,
  scale = 'departement',
  minLevel = 0,
  metric = 'global',
  refreshKey = 0,
  onProgress,
  onCpDataStatus,
  onLoadingChange,
  opacity = 0.55,
}: Props) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const entriesRef = useRef<Map<string, ZoneEntry>>(new Map());
  const zonesRef = useRef<GeoJSON.FeatureCollection | null>(null);
  // Filtres actifs — lus par applyPaint/popup sans re-déclencher l'effet data
  const filterRef = useRef<{ minLevel: number; metric: string }>({ minLevel, metric });
  filterRef.current = { minLevel, metric };

  const cleanup = (map: maplibregl.Map) => {
    if (clickRef.current) map.off('click', FILL_ID, clickRef.current);
    clickRef.current = null;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(CIVIC_SOURCE_ID)) map.removeSource(CIVIC_SOURCE_ID);
    entriesRef.current.clear();
    zonesRef.current = null;
  };

  /** Recalcule la propriété `indice` des features selon les filtres actifs. */
  const applyPaint = (map: maplibregl.Map) => {
    const src = map.getSource(CIVIC_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const zones = zonesRef.current;
    if (!src || !zones) return;
    const { minLevel: min, metric: m } = filterRef.current;
    const threshold = Math.max(min, 1); // 0 = indisponible, jamais peint
    const merged: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.features.map(f => {
        const code = String(f.properties?.code ?? '');
        const entry = entriesRef.current.get(code);
        const value = entry ? (m === 'global' ? entry.indice_global : entry.metrics[m] ?? null) : null;
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

  // ── Effet data : (re)charge zones + valeurs quand dataset/échelle change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!dataset) {
      cleanup(map);
      return;
    }

    let cancelled = false;
    const colors = readColors(dataset);
    const metricLabels = METRIC_LABELS[dataset];
    onLoadingChange?.(true);

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
        m.addSource(CIVIC_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        // Peinture par niveau (match sur property indice, null/-1 = transparent)
        const matchExpr: maplibregl.ExpressionSpecification = [
          'match', ['coalesce', ['get', 'indice'], -1],
          1, colors[1], 2, colors[2], 3, colors[3],
          4, colors[4], 5, colors[5], 6, colors[6],
          'rgba(0,0,0,0)', // sous le seuil ou sans donnée : transparent
        ] as maplibregl.ExpressionSpecification;

        m.addLayer({
          id: FILL_ID, type: 'fill', source: CIVIC_SOURCE_ID,
          paint: { 'fill-color': matchExpr, 'fill-opacity': opacity },
        });
        m.addLayer({
          id: LINE_ID, type: 'line', source: CIVIC_SOURCE_ID,
          paint: { 'line-color': colors[0], 'line-width': 0.4, 'line-opacity': 0.5 },
        });

        // Popup clic : indice global + détail par espèce/polluant + mention ODbL
        const titre = dataset === 'pollen' ? 'Indice pollen' : 'Indice ATMO';
        const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const code = String(f.properties?.code ?? '');
          const entry = entriesRef.current.get(code);
          if (popupRef.current) popupRef.current.remove();
          const rows = entry
            ? metricLabels.map(([key, label]) => {
                const lvl = entry.metrics[key] ?? 0;
                const conc = entry.concentrations?.[key];
                const concStr = conc && conc > 0
                  ? ` <span style="color:var(--text-tertiary);">· ${conc < 10 ? conc.toFixed(1) : Math.round(conc)} grains/m³</span>`
                  : '';
                return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-secondary);">
                  <span>${label}</span>
                  <span style="font-family:'JetBrains Mono',monospace;color:${colors[lvl] ?? colors[0]};">${lvl} — ${civicLevelLabel(dataset, lvl)}${concStr}</span>
                </div>`;
              }).join('')
            : '<div style="font-size:11px;color:var(--text-tertiary);">Donnée indisponible</div>';
          const alerteBadge = entry?.alerte
            ? `<div style="display:inline-block;margin-bottom:6px;padding:2px 8px;border-radius:4px;font-size:10px;
                background:rgba(255,87,87,0.1);border:0.5px solid rgba(255,87,87,0.2);color:var(--danger);">
                ⚠ Alerte pollen Atmo France
              </div>`
            : '';
          const sampleNote = scale === 'cp'
            ? `max des ${entry?.nbCommunes ?? '?'} commune(s) du code postal`
            : 'échantillon : 1 commune par département';
          popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: '300px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:'Inter',system-ui,sans-serif;line-height:1.5;padding:4px 2px;">
                <div style="font-size:12px;color:var(--text-primary);font-weight:500;margin-bottom:4px;">
                  ${String(f.properties?.nom ?? code)} (${code})
                </div>
                ${entry ? `
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${colors[entry.indice_global] ?? colors[0]};display:inline-block;"></span>
                    <span style="font-size:12px;color:var(--text-primary);">${titre} ${entry.indice_global}/6 — ${civicLevelLabel(dataset, entry.indice_global)}${entry.stale ? ' (donnée de la veille)' : ''}</span>
                  </div>` : ''}
                ${alerteBadge}
                ${rows}
                <div style="font-size:9px;color:var(--text-tertiary);margin-top:8px;">Source : Atmo France et les AASQA (ODbL) — ${sampleNote}</div>
              </div>
            `)
            .addTo(m);
        };
        m.on('click', FILL_ID, onClick);
        clickRef.current = onClick;

        // 2. Valeurs selon l'échelle
        if (scale === 'cp') {
          // min_level=0 volontaire : on charge tout (~6 200 lignes, léger) et
          // le seuil/métrique est appliqué au paint — changer de filtre ne
          // redéclenche aucun fetch.
          const res = await adminFetch(`/api/civic-indicators/health-map?dataset=${dataset}&scale=cp&min_level=0&metric=global`);
          if (!res.ok) throw new Error(`health-map cp HTTP ${res.status}`);
          const payload = await res.json() as { date: string | null; rows: CpRow[]; error?: string };
          if (cancelled) return;
          if (!payload.date) {
            onCpDataStatus?.('no_data', null);
            applyPaint(m);
            return;
          }
          onCpDataStatus?.('ok', payload.date);
          for (const r of payload.rows) {
            const metrics: Record<string, number> = {};
            const concentrations: Record<string, number> = {};
            for (const [key] of metricLabels) {
              metrics[key] = Number(r[key] ?? 0);
              if (dataset === 'pollen') concentrations[key] = Number(r[`conc_${key}`] ?? 0);
            }
            entriesRef.current.set(r.code_postal, {
              nom: r.code_postal,
              indice_global: r.indice_global,
              metrics,
              ...(dataset === 'pollen' ? { concentrations, alerte: r.alerte === true } : {}),
              stale: false,
              nbCommunes: r.nb_communes,
            });
          }
          applyPaint(m);
          return;
        }

        // Échelle département — stream NDJSON, repeint tous les 10 départements
        const res = await adminFetch(`/api/civic-indicators/health-map?dataset=${dataset}&scale=departement`);
        if (!res.ok || !res.body) throw new Error(`health-map HTTP ${res.status}`);
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
            let line: DeptLine;
            try { line = JSON.parse(raw) as DeptLine; } catch { continue; }
            if (line.type === 'meta') { total = line.total ?? 0; continue; }
            if (line.type === 'dept' && line.code_dept) {
              done++;
              if (dataset === 'pollen' && line.pollen) {
                entriesRef.current.set(line.code_dept, {
                  nom: line.nom_dept ?? line.code_dept,
                  indice_global: line.pollen.indice_global,
                  metrics: { ...line.pollen.especes },
                  // Absent sur les payloads en cache antérieurs à l'ajout des concentrations
                  concentrations: line.pollen.concentrations,
                  alerte: line.pollen.alerte,
                  stale: line.stale ?? false,
                });
              } else if (dataset === 'atmo' && line.air) {
                entriesRef.current.set(line.code_dept, {
                  nom: line.nom_dept ?? line.code_dept,
                  indice_global: line.air.indice,
                  metrics: {
                    no2: line.air.sous_indices.no2 ?? 0,
                    o3: line.air.sous_indices.o3 ?? 0,
                    pm10: line.air.sous_indices.pm10 ?? 0,
                    pm25: line.air.sous_indices.pm25 ?? 0,
                    so2: line.air.sous_indices.so2 ?? 0,
                  },
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
        if (!cancelled) console.error('[CivicHealthMapLayer]', err);
      } finally {
        if (!cancelled) onLoadingChange?.(false);
      }
    })();

    return () => {
      cancelled = true;
      onLoadingChange?.(false);
      const m = mapRef.current;
      if (m) cleanup(m);
    };
    // opacity absent des deps : simple peinture, gérée par l'effet dédié ci-dessous
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, scale, refreshKey]);

  // ── Effet filtre : repaint sans refetch quand seuil/métrique change ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataset) return;
    applyPaint(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLevel, metric]);

  // ── Effet opacité : setPaintProperty seul, ni refetch ni reconstruction FC ─
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataset || !map.getLayer(FILL_ID)) return;
    try { map.setPaintProperty(FILL_ID, 'fill-opacity', opacity); } catch { /* couche pas prête */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacity]);

  return null;
}

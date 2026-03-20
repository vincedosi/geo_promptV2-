/**
 * PopulationTileLayer — Carroyage Filosofi multi-résolution (style INSEE)
 *
 * - Zoom ≤ 7  → carreaux 20 km
 * - Zoom 8-10 → carreaux 2 km
 * - Zoom 11-13 → carreaux 1 km
 * - Zoom ≥ 14 → carreaux 200 m natifs
 *
 * Source GeoJSON dynamique : /api/carreaux/dynamic (debounce 300ms)
 * Choroplèthe : rampe calculée sur les percentiles 5-95 du viewport
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CarreauxIndicateur {
  id:    string;
  label: string;
  unit?: string;
  group: string;
}

export const CARREAUX_INDICATEURS: CarreauxIndicateur[] = [
  // Population
  { id: 'population_totale',   label: 'Population totale',   unit: 'pers.', group: 'Population' },
  { id: 'population_inconnue', label: 'Population inconnue', unit: 'pers.', group: 'Population' },
  { id: 'ind_0_3',             label: '0-3 ans',             unit: 'pers.', group: 'Population' },
  { id: 'ind_4_5',             label: '4-5 ans',             unit: 'pers.', group: 'Population' },
  { id: 'ind_6_10',            label: '6-10 ans',            unit: 'pers.', group: 'Population' },
  { id: 'ind_11_17',           label: '11-17 ans',           unit: 'pers.', group: 'Population' },
  { id: 'ind_18_24',           label: 'Jeunes 18-24 ans',    unit: 'pers.', group: 'Population' },
  { id: 'ind_25_39',           label: 'Actifs 25-39 ans',    unit: 'pers.', group: 'Population' },
  { id: 'ind_40_54',           label: 'Actifs 40-54 ans',    unit: 'pers.', group: 'Population' },
  { id: 'ind_55_64',           label: '55-64 ans',           unit: 'pers.', group: 'Population' },
  { id: 'ind_65_79',           label: 'Seniors 65-79 ans',   unit: 'pers.', group: 'Population' },
  { id: 'ind_80p',             label: 'Seniors 80 ans et +', unit: 'pers.', group: 'Population' },
  // Ménages
  { id: 'menages_total',           label: 'Ménages total',         unit: 'mén.', group: 'Ménages' },
  { id: 'menages_pauvres',         label: 'Ménages pauvres',       unit: 'mén.', group: 'Ménages' },
  { id: 'menages_1_personne',      label: 'Ménages 1 personne',    unit: 'mén.', group: 'Ménages' },
  { id: 'menages_5_plus',          label: 'Ménages 5+ personnes',  unit: 'mén.', group: 'Ménages' },
  { id: 'menages_proprietaires',   label: 'Ménages propriétaires', unit: 'mén.', group: 'Ménages' },
  { id: 'familles_monoparentales', label: 'Familles monoparent.',  unit: 'mén.', group: 'Ménages' },
  { id: 'menages_maison',          label: 'Ménages en maison',     unit: 'mén.', group: 'Ménages' },
  { id: 'menages_collectif',       label: 'Ménages en collectif',  unit: 'mén.', group: 'Ménages' },
  { id: 'surface_moyenne',         label: 'Surface moyenne (m²)',  unit: 'm²',   group: 'Ménages' },
  // Revenus
  { id: 'revenu_median', label: 'Revenu médian (€)', unit: '€', group: 'Revenus' },
  // Logements
  { id: 'logements_avant_1945',  label: 'Logements avant 1945',  unit: 'log.', group: 'Logements' },
  { id: 'logements_1945_1970',   label: 'Logements 1945-1970',   unit: 'log.', group: 'Logements' },
  { id: 'logements_1970_1990',   label: 'Logements 1970-1990',   unit: 'log.', group: 'Logements' },
  { id: 'logements_apres_1990',  label: 'Logements après 1990',  unit: 'log.', group: 'Logements' },
  { id: 'logements_sociaux',     label: 'Logements sociaux',     unit: 'log.', group: 'Logements' },
  { id: 'logements_inconnus',    label: 'Logements inconnus',    unit: 'log.', group: 'Logements' },
];

interface PopulationTileLayerProps {
  mapRef?:    React.MutableRefObject<maplibregl.Map | null>;
  mapReady:   boolean;
  visible?:   boolean;
  indicator?: string;
  opacity?:   number;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const SOURCE_ID = 'carreaux-insee';
const FILL_ID   = 'carreaux-insee-fill';
const LINE_ID   = 'carreaux-insee-line';

const COLOR_STOPS = [
  [0,    '#FFF5F0'],
  [0.10, '#FEE0D2'],
  [0.25, '#FCBBA1'],
  [0.45, '#FC9272'],
  [0.65, '#FB6A4A'],
  [0.80, '#DE2D26'],
  [1.00, '#A50F15'],
] as [number, string][];

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildColorExpression(
  min: number,
  max: number,
): maplibregl.ExpressionSpecification {
  if (max <= min) {
    return ['to-color', '#FC9272'] as unknown as maplibregl.ExpressionSpecification;
  }
  const range = max - min;
  const stops = COLOR_STOPS.flatMap(([t, color]) => [min + t * range, color]);
  return [
    'interpolate', ['linear'],
    ['coalesce', ['get', 'value'], 0],
    ...stops,
  ] as unknown as maplibregl.ExpressionSpecification;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PopulationTileLayer({
  mapRef,
  mapReady,
  visible  = true,
  indicator = 'population_totale',
  opacity  = 0.72,
}: PopulationTileLayerProps) {
  const initializedRef = useRef(false);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const currentIndRef  = useRef(indicator);
  const visibleRef     = useRef(visible);

  useEffect(() => { currentIndRef.current = indicator; }, [indicator]);

  // ── Fetch + mise à jour de la source ─────────────────────────────────────────
  const fetchCarreaux = useCallback(async (map: maplibregl.Map) => {
    if (!map || !map.getSource(SOURCE_ID)) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const bounds  = map.getBounds();
    const zoom    = Math.floor(map.getZoom());
    if (zoom < 7) return; // France entière trop lente, zoom in requis
    // Évite les bbox trop larges (France entière → timeout Supabase)
    const areaDeg = (bounds.getEast() - bounds.getWest()) * (bounds.getNorth() - bounds.getSouth());
    if (areaDeg > 20) return;

    // Skip si même bbox + même indicateur (évite double-fetch sur zoom sans déplacement)
    const w = bounds.getWest().toFixed(2), s = bounds.getSouth().toFixed(2);
    const e = bounds.getEast().toFixed(2), n = bounds.getNorth().toFixed(2);
    const fetchKey = `${zoom}|${w}|${s}|${e}|${n}|${currentIndRef.current}`;
    if (fetchKey === lastKeyRef.current) return;
    lastKeyRef.current = fetchKey;

    const params = new URLSearchParams({
      zoom:      String(zoom),
      west:      w,
      south:     s,
      east:      e,
      north:     n,
      indicator: currentIndRef.current,
      limit:     '2000',
    });

    try {
      const res = await fetch(`/api/carreaux/dynamic?${params}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) return;

      const geojson = await res.json() as GeoJSON.FeatureCollection;
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!src || !map.getLayer(FILL_ID)) return;

      src.setData(geojson);

      if (geojson.features.length > 0) {
        const values = geojson.features
          .map(f => (f.properties as any)?.value ?? 0)
          .filter(v => v > 0);

        if (values.length > 0) {
          const p5  = percentile(values, 0.05);
          const p95 = percentile(values, 0.95);
          try {
            map.setPaintProperty(FILL_ID, 'fill-color', buildColorExpression(p5, p95));
          } catch { /* layer pas encore prêt */ }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        console.warn('[PopulationTileLayer] fetch error:', err instanceof Error ? err.message : err);
      }
    }
  }, []);

  const lastKeyRef = useRef('');

  const scheduleFetch = useCallback((map: maplibregl.Map) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCarreaux(map), 500);
  }, [fetchCarreaux]);

  // ── Init source + layers ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !mapReady || initializedRef.current) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id:     FILL_ID,
      type:   'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color':   '#FC9272',
        'fill-opacity': opacity,
      },
      layout: { visibility: visible ? 'visible' : 'none' },
    });

    map.addLayer({
      id:     LINE_ID,
      type:   'line',
      source: SOURCE_ID,
      paint: {
        'line-color':   '#666',
        'line-width':   0.3,
        'line-opacity': 0.4,
      },
      layout: { visibility: visible ? 'visible' : 'none' },
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'carreaux-popup',
    });

    map.on('mouseenter', FILL_ID, (e) => {
      map.getCanvas().style.cursor = 'crosshair';
      const props = e.features?.[0]?.properties as any;
      if (!props) return;
      const indMeta  = CARREAUX_INDICATEURS.find(i => i.id === currentIndRef.current);
      const val      = Number(props.value      ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
      const pop      = Number(props.population ?? 0).toLocaleString('fr-FR');
      const men      = Number(props.menages    ?? 0).toLocaleString('fr-FR');
      popup.setLngLat(e.lngLat).setHTML(
        `<div style="font-size:11px;padding:6px 8px;font-family:monospace">` +
        `<div><b>${indMeta?.label ?? 'Valeur'}</b> : ${val}${indMeta?.unit ? ' ' + indMeta.unit : ''}</div>` +
        (pop !== '0' ? `<div style="color:#555">Population : ${pop} pers.</div>` : '') +
        (men !== '0' ? `<div style="color:#555">Ménages : ${men}</div>` : '') +
        `</div>`
      ).addTo(map);
    });

    map.on('mouseleave', FILL_ID, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    initializedRef.current = true;
    if (visible) scheduleFetch(map);

    const onMoveEnd = () => { if (visibleRef.current) scheduleFetch(map); };
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('moveend', onMoveEnd);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* cleanup silencieux */ }
      initializedRef.current = false;
    };
  }, [mapRef, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visibilité ────────────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible;
    const map = mapRef?.current;
    if (!map || !mapReady || !initializedRef.current) return;
    const vis = visible ? 'visible' : 'none';
    try {
      map.setLayoutProperty(FILL_ID, 'visibility', vis);
      map.setLayoutProperty(LINE_ID, 'visibility', vis);
    } catch { /* layer pas encore prêt */ }
    if (visible) scheduleFetch(map);
  }, [visible, mapRef, mapReady, scheduleFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rechargement sur changement d'indicateur ──────────────────────────────────
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !mapReady || !initializedRef.current || !visible) return;
    scheduleFetch(map);
  }, [indicator]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export default PopulationTileLayer;

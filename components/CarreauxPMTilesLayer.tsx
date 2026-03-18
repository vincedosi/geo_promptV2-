/**
 * CarreauxPMTilesLayer — Carroyage Filosofi via tuiles MVT dynamiques
 *
 * Source: /api/tiles/{z}/{x}/{y} → ST_AsMVT (PostGIS)
 * Z10-11 : carreaux 1km | Z12+ : carreaux 200m
 * Coloration dynamique : percentiles 5-95 des features visibles (queryRenderedFeatures)
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CarreauxIndicateur {
  id: string;
  label: string;
  unit?: string;
  group: string;
}

export const CARREAUX_INDICATEURS: CarreauxIndicateur[] = [
  // Population
  { id: 'population_totale',       label: 'Population totale',       unit: 'pers.', group: 'Population' },
  { id: 'population_inconnue',     label: 'Population inconnue',     unit: 'pers.', group: 'Population' },
  { id: 'ind_0_3',                 label: '0-3 ans',                 unit: 'pers.', group: 'Population' },
  { id: 'ind_4_5',                 label: '4-5 ans',                 unit: 'pers.', group: 'Population' },
  { id: 'ind_6_10',                label: '6-10 ans',                unit: 'pers.', group: 'Population' },
  { id: 'ind_11_17',               label: '11-17 ans',               unit: 'pers.', group: 'Population' },
  { id: 'ind_18_24',               label: 'Jeunes 18-24 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_25_39',               label: 'Actifs 25-39 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_40_54',               label: 'Actifs 40-54 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_55_64',               label: '55-64 ans',               unit: 'pers.', group: 'Population' },
  { id: 'ind_65_79',               label: 'Seniors 65-79 ans',       unit: 'pers.', group: 'Population' },
  { id: 'ind_80p',                 label: 'Seniors 80 ans et +',     unit: 'pers.', group: 'Population' },
  // Ménages
  { id: 'menages_total',           label: 'Ménages total',           unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_pauvres',         label: 'Ménages pauvres',         unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_1_personne',      label: 'Ménages 1 personne',      unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_5_plus',          label: 'Ménages 5+ personnes',    unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_proprietaires',   label: 'Ménages propriétaires',   unit: 'mén.',  group: 'Ménages' },
  { id: 'familles_monoparentales', label: 'Familles monoparent.',    unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_maison',          label: 'Ménages en maison',       unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_collectif',       label: 'Ménages en collectif',    unit: 'mén.',  group: 'Ménages' },
  { id: 'surface_moyenne',         label: 'Surface moyenne (m²)',    unit: 'm²',    group: 'Ménages' },
  // Revenus
  { id: 'revenu_median',           label: 'Revenu médian (€)',       unit: '€',     group: 'Revenus' },
  // Logements
  { id: 'logements_avant_1945',    label: 'Logements avant 1945',   unit: 'log.',  group: 'Logements' },
  { id: 'logements_1945_1970',     label: 'Logements 1945-1970',    unit: 'log.',  group: 'Logements' },
  { id: 'logements_1970_1990',     label: 'Logements 1970-1990',    unit: 'log.',  group: 'Logements' },
  { id: 'logements_apres_1990',    label: 'Logements après 1990',   unit: 'log.',  group: 'Logements' },
  { id: 'logements_sociaux',       label: 'Logements sociaux',      unit: 'log.',  group: 'Logements' },
  { id: 'logements_inconnus',      label: 'Logements inconnus',     unit: 'log.',  group: 'Logements' },
];

// ── Constantes ──────────────────────────────────────────────────────────────

const SOURCE_ID    = 'carreaux-mvt';
const FILL_ID      = 'carreaux-mvt-fill';
const LINE_ID      = 'carreaux-mvt-line';
const SOURCE_LAYER = 'carreaux';

export interface CarreauxPalette {
  id: string;
  label: string;
  stops: string[]; // 6 couleurs, min → max
}

export const CARREAUX_PALETTES: CarreauxPalette[] = [
  {
    id: 'rouge',
    label: 'Rouge',
    stops: ['#FFF5F0', '#FEE0D2', '#FCBBA1', '#FC9272', '#DE2D26', '#A50F15'],
  },
  {
    id: 'bleu',
    label: 'Bleu',
    stops: ['#F7FBFF', '#C6DBEF', '#9ECAE1', '#4292C6', '#2171B5', '#08306B'],
  },
  {
    id: 'vert',
    label: 'Vert',
    stops: ['#F7FCF5', '#C7E9C0', '#74C476', '#41AB5D', '#238B45', '#00441B'],
  },
  {
    id: 'violet',
    label: 'Violet',
    stops: ['#F2F0F7', '#DADAEB', '#BCBDDC', '#9E9AC8', '#756BB1', '#54278F'],
  },
  {
    id: 'turbo',
    label: 'Turbo',
    stops: ['#30123B', '#4675ED', '#1BD0D5', '#71F656', '#FAC829', '#B10326'],
  },
  {
    id: 'plasma',
    label: 'Plasma',
    stops: ['#0D0887', '#6A00A8', '#B12A90', '#E16462', '#FCA636', '#F0F921'],
  },
];

const COLOR_STOPS = [
  [0,    '#FFF5F0'],
  [0.10, '#FEE0D2'],
  [0.25, '#FCBBA1'],
  [0.45, '#FC9272'],
  [0.65, '#FB6A4A'],
  [0.80, '#DE2D26'],
  [1.00, '#A50F15'],
] as [number, string][];

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildColorExpression(
  min: number,
  max: number,
  indicator: string,
): maplibregl.ExpressionSpecification {
  if (max <= min) {
    return ['to-color', '#FC9272'] as unknown as maplibregl.ExpressionSpecification;
  }
  const range = max - min;
  const stops = COLOR_STOPS.flatMap(([t, color]) => [min + t * range, color]);
  return [
    'interpolate', ['linear'],
    ['coalesce', ['get', indicator], 0],
    ...stops,
  ] as unknown as maplibregl.ExpressionSpecification;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CarreauxPMTilesLayerProps {
  mapRef?:    React.MutableRefObject<maplibregl.Map | null>;
  mapReady:   boolean;
  visible?:   boolean;
  indicator?: string;
  opacity?:   number;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function CarreauxPMTilesLayer({
  mapRef,
  mapReady,
  visible   = true,
  indicator = 'population_totale',
  opacity   = 0.72,
}: CarreauxPMTilesLayerProps) {

const initializedRef = useRef(false);
  const indicatorRef   = useRef(indicator);
  const visibleRef     = useRef(visible);
  const colorDebRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { indicatorRef.current = indicator; }, [indicator]);
  useEffect(() => { visibleRef.current = visible; },    [visible]);

  // ── Recoloration dynamique ─────────────────────────────────────────────────
  const updateColors = useCallback((map: maplibregl.Map) => {
    if (!initializedRef.current || !map.getLayer(FILL_ID)) return;

    const features = map.queryRenderedFeatures(undefined, { layers: [FILL_ID] });
    console.log('[carreaux] updateColors — features rendues:', features.length, 'indicator:', indicatorRef.current);
    if (features.length === 0) return;

    const ind = indicatorRef.current;
    const values = features
      .map(f => Number((f.properties as Record<string, unknown>)?.[ind] ?? 0))
      .filter(v => v > 0);

    console.log('[carreaux] updateColors — valeurs > 0:', values.length, 'sur', features.length, 'features');
    if (values.length === 0) return;

    const p5  = percentile(values, 0.05);
    const p95 = percentile(values, 0.95);
    console.log('[carreaux] updateColors — p5:', p5, 'p95:', p95);

    try {
      map.setPaintProperty(FILL_ID, 'fill-color', buildColorExpression(p5, p95, ind));
    } catch (e) { console.error('[carreaux] setPaintProperty ERREUR:', e); }
  }, []);

  const scheduleColor = useCallback((map: maplibregl.Map) => {
    if (colorDebRef.current) clearTimeout(colorDebRef.current);
    colorDebRef.current = setTimeout(() => updateColors(map), 200);
  }, [updateColors]);

  // ── Init source + layers ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef?.current;

    // LOG #2 — déclenché quand mapRef/mapReady/scheduleColor/opacity changent
    console.log('[carreaux] EFFECT INIT — map:', !!map, 'mapReady:', mapReady, 'styleLoaded:', map?.isStyleLoaded(), 'alreadyInit:', initializedRef.current);

    if (!map) {
      console.warn('[carreaux] SKIP init — map est null (carte pas encore créée)');
      return;
    }
    if (initializedRef.current) {
      console.warn('[carreaux] SKIP init — déjà initialisé');
      return;
    }

    let pendingLoadListener: (() => void) | null = null;

    const doInit = () => {
      if (initializedRef.current) {
        console.warn('[carreaux] doInit SKIP — déjà initialisé (double appel)');
        return;
      }
      console.log('[carreaux] doInit START — zoom:', map.getZoom().toFixed(1), 'styleLoaded:', map.isStyleLoaded());

      // Nettoyage préventif des layers/source orphelins
      try { map.removeLayer(LINE_ID); console.log('[carreaux] supprimé LINE orphelin'); } catch { /* ok */ }
      try { map.removeLayer(FILL_ID); console.log('[carreaux] supprimé FILL orphelin'); } catch { /* ok */ }
      try { map.removeSource(SOURCE_ID); console.log('[carreaux] supprimé SOURCE orpheline'); } catch { /* ok */ }

      const tilesUrl = `${window.location.origin}/api/tiles/{z}/{x}/{y}`;
      console.log('[carreaux] addSource → tiles:', tilesUrl);

      try {
        map.addSource(SOURCE_ID, {
          type: 'vector',
          tiles: [tilesUrl],
          minzoom: 10,
          maxzoom: 14,
          attribution: 'INSEE, Filosofi 2019',
        });
        console.log('[carreaux] addSource OK — getSource:', !!map.getSource(SOURCE_ID));
      } catch (e) {
        console.error('[carreaux] addSource ERREUR:', e);
        return;
      }

      try {
        map.addLayer({
          id:     FILL_ID,
          type:   'fill',
          source: SOURCE_ID,
          'source-layer': SOURCE_LAYER,
          minzoom: 10,
          paint: {
            'fill-color':   '#FC9272',
            'fill-opacity': opacity,
          },
          layout: { visibility: visibleRef.current ? 'visible' : 'none' },
        });
        console.log('[carreaux] addLayer FILL OK — visibility:', visibleRef.current ? 'visible' : 'none');
      } catch (e) {
        console.error('[carreaux] addLayer FILL ERREUR:', e);
        return;
      }

      try {
        map.addLayer({
          id:     LINE_ID,
          type:   'line',
          source: SOURCE_ID,
          'source-layer': SOURCE_LAYER,
          minzoom: 10,
          paint: {
            'line-color':   '#555',
            'line-width':   [
              'interpolate', ['linear'], ['zoom'],
              10, 0.1,
              12, 0.3,
              14, 0.8,
            ] as unknown as maplibregl.ExpressionSpecification,
            'line-opacity': 0.35,
          },
          layout: { visibility: visibleRef.current ? 'visible' : 'none' },
        });
        console.log('[carreaux] addLayer LINE OK');
      } catch (e) {
        console.error('[carreaux] addLayer LINE ERREUR:', e);
      }

      // Log toutes les erreurs MapLibre (tuiles 404/500, source corrompue, etc.)
      map.on('error', (ev) => {
        console.error('[carreaux] MAP ERROR EVENT:', ev?.error?.message ?? ev);
      });

      // Popup hover
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'carreaux-popup',
      });

      map.on('mouseenter', FILL_ID, (e) => {
        map.getCanvas().style.cursor = 'crosshair';
        const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!props) return;
        const indMeta = CARREAUX_INDICATEURS.find(i => i.id === indicatorRef.current);
        const val = Number(props[indicatorRef.current] ?? 0)
          .toLocaleString('fr-FR', { maximumFractionDigits: 1 });
        const pop = Number(props.population_totale ?? 0).toLocaleString('fr-FR');
        const men = Number(props.menages_total ?? 0).toLocaleString('fr-FR');
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

      // Recoloration dynamique après chaque rendu de tuile
      const onIdle = () => {
        console.log('[carreaux] idle/moveend — visible:', visibleRef.current, 'init:', initializedRef.current);
        if (visibleRef.current) scheduleColor(map);
      };
      map.on('idle',    onIdle);
      map.on('moveend', onIdle);

      initializedRef.current = true;
      console.log('[carreaux] doInit TERMINÉ ✓ — source:', !!map.getSource(SOURCE_ID), '| FILL layer:', !!map.getLayer(FILL_ID), '| LINE layer:', !!map.getLayer(LINE_ID));
    };

    if (map.isStyleLoaded()) {
      console.log('[carreaux] style déjà chargé → doInit immédiat');
      doInit();
    } else {
      console.log('[carreaux] style PAS encore chargé → en attente event "load"');
      pendingLoadListener = doInit;
      map.once('load', pendingLoadListener);
    }

    return () => {
      console.log('[carreaux] CLEANUP — suppression layers/source, init → false');
      if (pendingLoadListener) map.off('load', pendingLoadListener);
      if (colorDebRef.current) clearTimeout(colorDebRef.current);
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* cleanup silencieux */ }
      initializedRef.current = false;
    };
  }, [mapRef, mapReady, scheduleColor, opacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visibilité ─────────────────────────────────────────────────────────────
  useEffect(() => {
    visibleRef.current = visible;
    const map = mapRef?.current;
    console.log('[carreaux] EFFECT VIS — visible:', visible, 'map:', !!map, 'mapReady:', mapReady, 'init:', initializedRef.current);
    if (!map || !mapReady || !initializedRef.current) {
      console.warn('[carreaux] EFFECT VIS SKIP — conditions non remplies');
      return;
    }
    const vis = visible ? 'visible' : 'none';
    try {
      map.setLayoutProperty(FILL_ID, 'visibility', vis);
      map.setLayoutProperty(LINE_ID, 'visibility', vis);
      console.log('[carreaux] visibility mis à jour →', vis);
      if (visible) scheduleColor(map);
    } catch (e) { console.error('[carreaux] setLayoutProperty ERREUR:', e); }
  }, [visible, mapRef, mapReady, scheduleColor]);

  // ── Indicateur ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef?.current;
    console.log('[carreaux] EFFECT INDICATOR — indicator:', indicator, 'init:', initializedRef.current, 'visible:', visible);
    if (!map || !mapReady || !initializedRef.current || !visible) return;
    scheduleColor(map);
  }, [indicator]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export default CarreauxPMTilesLayer;

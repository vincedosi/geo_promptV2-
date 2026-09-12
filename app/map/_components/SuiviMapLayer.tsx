'use client';

/**
 * SuiviMapLayer — choroplèthe CP du cockpit de suivi (spec 2026-07-17) et de
 * la réconciliation DSP ⇔ mesure (spec 2026-07-18). Activée par l'événement
 * `magelian:suivi-map` : detail = { campaignId, metric, forecastCpm }.
 *
 * La métrique détermine tout (via la table `METRICS`) : l'endpoint (suivi vs
 * reconcile), le label, le format de valeur, les couleurs/seuils et la légende.
 * Ajouter une métrique = une entrée dans `METRICS`, rien d'autre à toucher.
 * Couleurs lues des tokens CSS au runtime (MapLibre ne résout pas var()).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { echapperHtml as esc } from '@/lib/map/echapper-html';
import { adminFetch } from '@/lib/admin-fetch';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';

const SOURCE_ID = 'suivi-campaign-zones';
const FILL_ID = 'suivi-campaign-zones-fill';
const LINE_ID = 'suivi-campaign-zones-line';
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

type SuiviMapSource = 'suivi' | 'reconcile';
export type SuiviMapMetric = 'hold' | 'cpm' | 'objectif' | 'measure' | 'dspcpm';

export interface SuiviMapEventDetail {
  campaignId: string;
  metric: SuiviMapMetric;
  forecastCpm: number | null;
  actors?: string[];
}

interface FeatureRow {
  code: string;
  nom: string | null;
  in_target: boolean;
  value: number | null;
  geometry: GeoJSON.Geometry;
}

type Tone = { ok: string; warn: string; bad: string; teal: string };

function readToneColors(): Tone {
  const style = getComputedStyle(document.documentElement);
  return {
    ok: style.getPropertyValue('--success').trim() || '#3dffa0',
    warn: style.getPropertyValue('--warning').trim() || '#f7b731',
    bad: style.getPropertyValue('--danger').trim() || '#ff5757',
    teal: style.getPropertyValue('--brand-teal').trim() || '#4ecdc4',
  };
}

const V: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'value'], -1];
const TRANSPARENT = 'rgba(0,0,0,0)';

/** Case à 3 paliers croissants : < low → bad, < high → warn, sinon ok (transparent si absent). */
function tieredFill(c: Tone, low: number, high: number): maplibregl.ExpressionSpecification {
  return ['case', ['<', V, 0], TRANSPARENT, ['<', V, low], c.bad, ['<', V, high], c.warn, c.ok];
}
const flatFill = (c: Tone): maplibregl.ExpressionSpecification => ['case', ['<', V, 0], TRANSPARENT, c.teal];

/** Divergent centré sur 100 : < 70 bad, 70–90 warn, 90–110 ok, > 110 teal (grisé si absent). */
function divergingFill(c: Tone): maplibregl.ExpressionSpecification {
  return ['case', ['<', V, 0], TRANSPARENT, ['<', V, 70], c.bad, ['<', V, 90], c.warn, ['<=', V, 110], c.ok, c.teal];
}
const eur = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;

/**
 * Config déclarative par métrique — source de vérité unique. `source` sert à la
 * fois d'endpoint (`/suivi/map` | `/reconcile/map`) et de famille de toggles.
 */
interface MetricConfig {
  source: SuiviMapSource;
  label: string;
  format: (v: number) => string;
  fill: (c: Tone, forecastCpm: number | null) => maplibregl.ExpressionSpecification;
  legend: (c: Tone, forecastCpm: number | null) => Array<[string, string]>;
  /** Métrique masquée sous filtre acteur partiel : sa valeur devient une
   *  contribution (lit l'objectif GLOBAL, pas la part de l'acteur) → trompeuse
   *  rendue comme une atteinte absolue. Cohérent avec le masquage SuiviTable. */
  hiddenUnderPartialActors?: true;
}

const METRICS: Record<SuiviMapMetric, MetricConfig> = {
  hold: {
    source: 'suivi', label: 'Tenue du plan',
    format: (v) => `${v} % du plan`,
    fill: (c) => tieredFill(c, 60, 80),
    legend: (c) => [[c.ok, '≥ 80 % du plan'], [c.warn, '60–80 %'], [c.bad, '< 60 %']],
  },
  cpm: {
    source: 'suivi', label: 'CPM',
    format: eur,
    fill: (c, f) => (f == null || f <= 0) ? flatFill(c)
      : ['case', ['<', V, 0], TRANSPARENT, ['<=', V, f * 1.1], c.ok, ['<=', V, f * 1.25], c.warn, c.bad],
    legend: (c, f) => (f == null || f <= 0)
      ? [[c.teal, 'CPM réel (pas de prévu)']]
      : [[c.ok, '≤ prévu +10 %'], [c.warn, 'prévu +10–25 %'], [c.bad, '> prévu +25 %']],
  },
  objectif: {
    source: 'suivi', label: 'Atteinte objectif', hiddenUnderPartialActors: true,
    format: (v) => `${v} % de l'objectif`,
    fill: (c) => divergingFill(c),
    legend: (c) => [[c.bad, '< 70 % (nettement sous)'], [c.warn, '70–90 % (sous)'], [c.ok, '90–110 % (sur l\'objectif)'], [c.teal, '> 110 % (au-dessus)']],
  },
  measure: {
    source: 'reconcile', label: 'Taux de mesure',
    format: (v) => `${v} % mesuré`,
    fill: (c) => tieredFill(c, 85, 95),
    legend: (c) => [[c.ok, '≥ 95 % mesuré'], [c.warn, '85–95 %'], [c.bad, '< 85 %']],
  },
  dspcpm: {
    source: 'reconcile', label: 'CPM DSP',
    format: eur,
    fill: (c) => flatFill(c),
    legend: (c) => [[c.teal, 'CPM DSP réel par CP']],
  },
};

const SOURCE_TITLE: Record<SuiviMapSource, string> = { suivi: 'Suivi campagne', reconcile: 'Réconciliation' };
const METRIC_KEYS = Object.keys(METRICS) as SuiviMapMetric[];

/**
 * Événement diffusé à chaque changement du statut actif/inactif (activation,
 * fermeture, changement de métrique) — permet à `page.tsx` de suivre l'état
 * SANS dupliquer la logique d'activation (Tâche 6, 2026-09-12) : le groupe
 * « Campagne active » du panneau Calques n'apparaît que si un `detail` non
 * nul est reçu, et l'exclusivité des dégradés est demandée à ce moment-là.
 */
export const SUIVI_MAP_STATUS_EVENT = 'magelian:suivi-map-status';
/** Demande de fermeture externe (ex. évincé par un autre dégradé, ou croix
 *  « Actifs » du panneau Calques) — symétrique de `magelian:suivi-map`. */
export const SUIVI_MAP_CLEAR_EVENT = 'magelian:suivi-map-clear';

/**
 * Paliers de légende [couleur, libellé] d'une métrique — exportée pour
 * `components/map/LegendeCarte.tsx` (Tâche 6) : la légende unique du panneau
 * Calques les rend, ce composant ne les affiche plus lui-même.
 */
export function legendePourMetrique(metric: SuiviMapMetric, forecastCpm: number | null): Array<[string, string]> {
  return METRICS[metric].legend(readToneColors(), forecastCpm);
}

export function SuiviMapLayer({ mapRef }: { mapRef: React.MutableRefObject<maplibregl.Map | null> }) {
  const [active, setActive] = useState<SuiviMapEventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<SuiviMapEventDetail>).detail;
      if (detail?.campaignId) setActive(detail);
    };
    window.addEventListener('magelian:suivi-map', onEvent);
    return () => window.removeEventListener('magelian:suivi-map', onEvent);
  }, []);

  // Fermeture demandée depuis l'extérieur (panneau Calques : croix « Actifs »,
  // ou éviction par un autre dégradé de couleur — un seul à la fois).
  useEffect(() => {
    const onClear = () => setActive(null);
    window.addEventListener(SUIVI_MAP_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(SUIVI_MAP_CLEAR_EVENT, onClear);
  }, []);

  // Rediffuse le statut courant à chaque changement (activation, fermeture,
  // changement de métrique) — source unique pour page.tsx, qui n'a sinon
  // aucun moyen de savoir si une campagne est active (état interne à ce
  // composant, déclenché par un événement DOM émis ailleurs).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<SuiviMapEventDetail | null>(SUIVI_MAP_STATUS_EVENT, { detail: active }));
  }, [active]);

  const cleanup = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (clickRef.current) map.off('click', FILL_ID, clickRef.current);
    clickRef.current = null;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!active) { cleanup(); return; }

    const cfg = METRICS[active.metric];
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const actorsQ = active.actors?.length ? `&actors=${encodeURIComponent(active.actors.join(','))}` : '';
        const res = await adminFetch(
          `/api/digital/${active.campaignId}/${cfg.source}/map?metric=${active.metric}${actorsQ}`,
          { cache: 'no-store' },
        );
        const d = res.ok ? await res.json() : null;
        if (cancelled || !d) return;
        const rows: FeatureRow[] = d.features ?? [];
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: rows.map((r) => ({
            type: 'Feature',
            geometry: r.geometry,
            properties: { code: r.code, nom: r.nom, in_target: r.in_target, value: r.value },
          })),
        };
        cleanup();
        map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
        map.addLayer({
          id: FILL_ID, type: 'fill', source: SOURCE_ID,
          paint: {
            'fill-color': cfg.fill(readToneColors(), active.forecastCpm),
            'fill-opacity': 0.55,
          },
        });
        map.addLayer({
          id: LINE_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 0.5 },
        });
        const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { code: string; nom: string | null; in_target: boolean | string; value: number | null };
          const inTarget = p.in_target === true || p.in_target === 'true';
          const valueLabel = p.value == null ? '—' : cfg.format(Number(p.value));
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:${fInter};font-size:12px;">`
              + `<strong>${esc(p.code)}</strong>${p.nom ? ` · ${esc(p.nom)}` : ''}`
              + `${inTarget ? ' · <span style="color:var(--brand-teal)">cible</span>' : ''}<br/>`
              + `<span style="font-family:${fMono};font-size:11px;">${esc(cfg.label)} : ${esc(valueLabel)}</span>`
              + `</div>`,
            )
            .addTo(map);
        };
        map.on('click', FILL_ID, onClick);
        clickRef.current = onClick;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, mapRef, cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  if (!active) return null;

  const cfg = METRICS[active.metric];
  // Sous filtre acteur partiel, on retire les métriques marquées
  // hiddenUnderPartialActors (règle portée par la table METRICS, pas par un test
  // de nom de métrique ici) — cf. commentaire de MetricConfig.
  const partialActors = !!active.actors?.length;
  const toggles = METRIC_KEYS.filter(
    (m) => METRICS[m].source === cfg.source && !(METRICS[m].hiddenUnderPartialActors && partialActors),
  );

  return (
    <div style={{
      position: 'fixed', left: LARGEUR_RAIL + ECART_RAIL_PANNEAU + 12, bottom: 28, zIndex: 5000,
      background: 'var(--card-overlay, rgba(10,10,10,0.92))', border: '0.5px solid var(--border-default)',
      borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 210,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
          {SOURCE_TITLE[cfg.source]} {loading ? '· chargement…' : ''}
        </span>
        <button
          type="button"
          onClick={() => setActive(null)}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 11, cursor: 'pointer', padding: 0 }}
        >
          Fermer
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {toggles.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setActive({ ...active, metric: m })}
            style={{
              background: 'transparent', borderRadius: 6, padding: '4px 10px',
              border: `0.5px solid ${active.metric === m ? 'var(--brand-teal)' : 'var(--border-default)'}`,
              color: active.metric === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
              fontFamily: fInter, fontSize: 11, cursor: 'pointer',
            }}
          >
            {METRICS[m].label}
          </button>
        ))}
      </div>
      {/* Légende — rendue par la légende unique de la carte (LegendeCarte,
          Tâche 6) via `legendePourMetrique` exportée ci-dessus. */}
    </div>
  );
}

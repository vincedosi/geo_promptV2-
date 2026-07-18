'use client';

/**
 * SuiviMapLayer — choroplèthe CP du cockpit de suivi (spec 2026-07-17) et de
 * la réconciliation DSP ⇔ mesure (spec 2026-07-18). Activée par l'événement
 * `magelian:suivi-map` : detail = { campaignId, source?, metric, forecastCpm }.
 *
 * source 'suivi' (défaut) → /suivi/map, métriques 'hold'|'cpm' ;
 * source 'reconcile'      → /reconcile/map, métriques 'measure'|'dspcpm'.
 * Couleurs lues des tokens CSS au runtime (MapLibre ne résout pas var()).
 * Légende flottante avec toggle de métrique et fermeture — pattern
 * CivicHealthMapLayer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';

const SOURCE_ID = 'suivi-campaign-zones';
const FILL_ID = 'suivi-campaign-zones-fill';
const LINE_ID = 'suivi-campaign-zones-line';
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

type SuiviMapSource = 'suivi' | 'reconcile';
type SuiviMapMetric = 'hold' | 'cpm' | 'measure' | 'dspcpm';

export interface SuiviMapEventDetail {
  campaignId: string;
  source?: SuiviMapSource;
  metric: SuiviMapMetric;
  forecastCpm: number | null;
}

interface FeatureRow {
  code: string;
  nom: string | null;
  in_target: boolean;
  value: number | null;
  geometry: GeoJSON.Geometry;
}

function readToneColors(): { ok: string; warn: string; bad: string; teal: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    ok: style.getPropertyValue('--success').trim() || '#3dffa0',
    warn: style.getPropertyValue('--warning').trim() || '#f7b731',
    bad: style.getPropertyValue('--danger').trim() || '#ff5757',
    teal: style.getPropertyValue('--brand-teal').trim() || '#4ecdc4',
  };
}

function fillColorExpression(metric: SuiviMapMetric, forecastCpm: number | null): maplibregl.ExpressionSpecification {
  const c = readToneColors();
  const v: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'value'], -1];
  if (metric === 'hold') {
    return ['case',
      ['<', v, 0], 'rgba(0,0,0,0)',
      ['<', v, 60], c.bad,
      ['<', v, 80], c.warn,
      c.ok];
  }
  if (metric === 'measure') {
    return ['case',
      ['<', v, 0], 'rgba(0,0,0,0)',
      ['<', v, 85], c.bad,
      ['<', v, 95], c.warn,
      c.ok];
  }
  if (metric === 'dspcpm') {
    // Pas de référence prévue par CP côté DSP : teal uni au-dessus de 0.
    return ['case', ['<', v, 0], 'rgba(0,0,0,0)', c.teal];
  }
  // 'cpm' (suivi) : vs CPM prévu.
  if (forecastCpm == null || forecastCpm <= 0) {
    return ['case', ['<', v, 0], 'rgba(0,0,0,0)', c.teal];
  }
  return ['case',
    ['<', v, 0], 'rgba(0,0,0,0)',
    ['<=', v, forecastCpm * 1.1], c.ok,
    ['<=', v, forecastCpm * 1.25], c.warn,
    c.bad];
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

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const endpoint = (active.source ?? 'suivi') === 'reconcile' ? 'reconcile' : 'suivi';
        const res = await adminFetch(
          `/api/digital/${active.campaignId}/${endpoint}/map?metric=${active.metric}`,
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
            'fill-color': fillColorExpression(active.metric, active.forecastCpm),
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
          const isCurrency = active.metric === 'cpm' || active.metric === 'dspcpm';
          const valueLabel = p.value == null ? '—'
            : isCurrency ? `${Number(p.value).toFixed(2).replace('.', ',')} €`
            : active.metric === 'measure' ? `${p.value} % mesuré`
            : `${p.value} % du plan`;
          const metricLabel = active.metric === 'cpm' ? 'CPM'
            : active.metric === 'dspcpm' ? 'CPM DSP'
            : active.metric === 'measure' ? 'Taux de mesure' : 'Tenue';
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:${fInter};font-size:12px;">`
              + `<strong>${p.code}</strong>${p.nom ? ` · ${p.nom}` : ''}`
              + `${inTarget ? ' · <span style="color:var(--brand-teal)">cible</span>' : ''}<br/>`
              + `<span style="font-family:${fMono};font-size:11px;">${metricLabel} : ${valueLabel}</span>`
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

  const legendRow = (color: string, label: string) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
  const c = readToneColors();
  const hasForecast = active.forecastCpm != null && active.forecastCpm > 0;
  const isRecon = (active.source ?? 'suivi') === 'reconcile';
  const toggles: Array<{ metric: SuiviMapMetric; label: string }> = isRecon
    ? [{ metric: 'measure', label: 'Taux de mesure' }, { metric: 'dspcpm', label: 'CPM DSP' }]
    : [{ metric: 'hold', label: 'Tenue du plan' }, { metric: 'cpm', label: 'CPM' }];

  return (
    <div style={{
      position: 'fixed', left: 68, bottom: 28, zIndex: 5000,
      background: 'var(--card-overlay, rgba(10,10,10,0.92))', border: '0.5px solid var(--border-default)',
      borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 210,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
          {isRecon ? 'Réconciliation' : 'Suivi campagne'} {loading ? '· chargement…' : ''}
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
        {toggles.map((t) => (
          <button
            key={t.metric}
            type="button"
            onClick={() => setActive({ ...active, metric: t.metric })}
            style={{
              background: 'transparent', borderRadius: 6, padding: '4px 10px',
              border: `0.5px solid ${active.metric === t.metric ? 'var(--brand-teal)' : 'var(--border-default)'}`,
              color: active.metric === t.metric ? 'var(--brand-teal)' : 'var(--text-secondary)',
              fontFamily: fInter, fontSize: 11, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {active.metric === 'hold' && (
          <>
            {legendRow(c.ok, '≥ 80 % du plan')}
            {legendRow(c.warn, '60–80 %')}
            {legendRow(c.bad, '< 60 %')}
          </>
        )}
        {active.metric === 'measure' && (
          <>
            {legendRow(c.ok, '≥ 95 % mesuré')}
            {legendRow(c.warn, '85–95 %')}
            {legendRow(c.bad, '< 85 %')}
          </>
        )}
        {active.metric === 'dspcpm' && legendRow(c.teal, 'CPM DSP réel par CP')}
        {active.metric === 'cpm' && (hasForecast ? (
          <>
            {legendRow(c.ok, '≤ prévu +10 %')}
            {legendRow(c.warn, 'prévu +10–25 %')}
            {legendRow(c.bad, '> prévu +25 %')}
          </>
        ) : (
          legendRow(c.teal, 'CPM réel (pas de prévu)')
        ))}
      </div>
    </div>
  );
}

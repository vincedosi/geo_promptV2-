'use client';

/**
 * ScoreMapLayer — choroplèthe 0-100 du score composite par code postal
 * (Tâche 12, 2026-09-13).
 *
 * Activée par l'événement `magelian:score-map` : detail = { scores, libelle }.
 * Éteinte par le même événement avec `scores: []`.
 *
 * **Les géométries ne sont PAS refetchées par ce calque.** Elles viennent de
 * `/api/meteo-geo/zones?scale=cp` — la même route que `CivicHealthMapLayer`,
 * cachée un jour au navigateur et une semaine au CDN. Les valeurs y sont
 * fusionnées côté client. Ajouter une route de géométrie propre au score
 * aurait fait payer une seconde fois 3,8 Mo de polygones déjà en cache.
 *
 * Le chargement de ces géométries n'a lieu QU'À la première activation, jamais
 * au montage : un préchargement au chargement de page est exactement ce que
 * CLAUDE.md interdit.
 *
 * Ce calque est un DÉGRADÉ au sens de `lib/carte/degrades.ts` (id `'score'`) :
 * il ne peut pas coexister avec les six autres choroplèthes. C'est `page.tsx`
 * qui applique l'exclusivité, comme pour les autres.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { echapperHtml as esc } from '@/lib/map/echapper-html';
import { adminFetch } from '@/lib/admin-fetch';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';

/** Nom de l'événement d'activation — partagé, jamais recopié en litteral. */
export const SCORE_MAP_EVENT = 'magelian:score-map';

const SOURCE_ID = 'score-composite-cp';
const FILL_ID = 'score-composite-cp-fill';
const LINE_ID = 'score-composite-cp-line';
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface ScoreCP {
  code: string;
  score: number;
  n_indicateurs: number;
}

export interface ScoreMapEventDetail {
  /** Vide = éteindre le calque. */
  scores: ScoreCP[];
  /** Ce que le score agrège, affiché en légende (« Revenu médian × Abstention »). */
  libelle: string;
  /** Nombre d'indicateurs demandés — sert à repérer les scores partiels. */
  nIndicateurs: number;
}

interface Props {
  /** Convention des autres calques de cette page (SuiviMapLayer, CivicHealthMapLayer). */
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
}

/**
 * Échelle 0-100 en cinq paliers. Le score est déjà normalisé sur le périmètre :
 * pas de bornes à calculer, pas de log10 — contrairement aux carreaux et aux
 * IRIS, dont les valeurs brutes s'étalent sur plusieurs ordres de grandeur.
 */
function echelleScore(teal: string): maplibregl.ExpressionSpecification {
  const v: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'score'], -1];
  return [
    'case',
    ['<', v, 0], 'rgba(0,0,0,0)',
    [
      'interpolate', ['linear'], v,
      0,   'rgba(78,205,196,0.10)',
      25,  'rgba(78,205,196,0.28)',
      50,  'rgba(78,205,196,0.48)',
      75,  'rgba(78,205,196,0.70)',
      100, teal,
    ],
  ] as maplibregl.ExpressionSpecification;
}

export function ScoreMapLayer({ mapRef }: Props) {
  const geometriesRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [legende, setLegende] = useState<{ libelle: string; n: number; partiels: number } | null>(null);
  const [chargement, setChargement] = useState(false);

  const eteindre = useCallback((m: maplibregl.Map) => {
    if (m.getLayer(FILL_ID)) m.removeLayer(FILL_ID);
    if (m.getLayer(LINE_ID)) m.removeLayer(LINE_ID);
    if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
    popupRef.current?.remove();
    popupRef.current = null;
    setLegende(null);
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const onScoreMap = async (evenement: Event) => {
      const detail = (evenement as CustomEvent<ScoreMapEventDetail>).detail;
      if (!detail || !detail.scores.length) { eteindre(m); return; }

      // Géométries : une seule fois pour toute la session (cache `useRef`,
      // règle CLAUDE.md « vérifier le cache AVANT tout fetch »).
      if (!geometriesRef.current) {
        setChargement(true);
        try {
          const res = await adminFetch('/api/meteo-geo/zones?scale=cp');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          geometriesRef.current = await res.json() as GeoJSON.FeatureCollection;
        } catch {
          setChargement(false);
          return;
        }
        setChargement(false);
      }

      const parCode = new Map(detail.scores.map((s) => [s.code, s]));
      const features = geometriesRef.current.features
        .filter((f) => parCode.has(String(f.properties?.code ?? '')))
        .map((f) => {
          const s = parCode.get(String(f.properties?.code ?? ''))!;
          return { ...f, properties: { ...f.properties, score: s.score, n_indicateurs: s.n_indicateurs } };
        });
      const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

      const teal = getComputedStyle(document.documentElement).getPropertyValue('--brand-teal').trim() || '#4ecdc4';
      const source = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(collection);
      } else {
        m.addSource(SOURCE_ID, { type: 'geojson', data: collection });
        m.addLayer({
          id: FILL_ID, type: 'fill', source: SOURCE_ID,
          paint: { 'fill-color': echelleScore(teal), 'fill-opacity': 0.85 },
        });
        m.addLayer({
          id: LINE_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': 'rgba(255,255,255,0.12)', 'line-width': 0.5 },
        });
      }

      setLegende({
        libelle: detail.libelle,
        n: detail.scores.length,
        partiels: detail.scores.filter((s) => s.n_indicateurs < detail.nIndicateurs).length,
      });
    };

    // `esc` sur TOUTE valeur reprise dans le HTML du popup : le libellé d'un
    // indicateur vient de la base (CORRECTIF XSS des popups, 2026-09-11).
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!m.getLayer(FILL_ID)) return;
      const f = m.queryRenderedFeatures(e.point, { layers: [FILL_ID] })[0];
      if (!f) return;
      const code = esc(String(f.properties?.code ?? ''));
      const nom = esc(String(f.properties?.nom ?? ''));
      const score = Number(f.properties?.score ?? 0).toFixed(1);
      const n = Number(f.properties?.n_indicateurs ?? 0);
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, className: 'magelian-popup' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:${fInter};font-size:12px;color:var(--text-primary)">` +
          `<div style="font-weight:500">${code}${nom ? ` — ${nom}` : ''}</div>` +
          `<div style="font-family:${fMono};font-size:16px;margin:4px 0">${score}<span style="font-size:11px;color:var(--text-tertiary)">/100</span></div>` +
          `<div style="font-size:11px;color:var(--text-tertiary)">sur ${n} indicateur${n > 1 ? 's' : ''}</div>` +
          `</div>`,
        )
        .addTo(m);
    };

    window.addEventListener(SCORE_MAP_EVENT, onScoreMap as EventListener);
    m.on('click', FILL_ID, onClick);
    return () => {
      window.removeEventListener(SCORE_MAP_EVENT, onScoreMap as EventListener);
      m.off('click', FILL_ID, onClick);
      eteindre(m);
    };
  }, [mapRef, eteindre]);

  if (!legende && !chargement) return null;

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
      background: 'var(--card)', border: '0.5px solid var(--border-subtle)',
      borderRadius: 6, padding: '10px 12px', zIndex: 5, minWidth: 200,
      fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
    }}>
      {chargement ? 'Chargement des contours…' : legende && (
        <>
          <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
            Score composite
          </div>
          <div style={{ marginBottom: 8, lineHeight: 1.4 }}>{legende.libelle}</div>
          <div style={{
            height: 6, borderRadius: 3, marginBottom: 4,
            background: 'linear-gradient(to right, rgba(78,205,196,0.10), var(--brand-teal))',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span>0</span><span>100</span>
          </div>
          <div style={{ marginTop: 8, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            {legende.n} code{legende.n > 1 ? 's' : ''} postal{legende.n > 1 ? 'ux' : ''}
            {/* Un score porté par moins d'indicateurs que demandé n'est pas
                comparable aux autres : le taire serait mentir par omission. */}
            {legende.partiels > 0 && ` · ${legende.partiels} partiel${legende.partiels > 1 ? 's' : ''}`}
          </div>
        </>
      )}
    </div>
  );
}

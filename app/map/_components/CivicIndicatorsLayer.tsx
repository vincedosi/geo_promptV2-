'use client';

/**
 * CivicIndicatorsLayer — layer choroplèthe des indicateurs civiques par CP.
 *
 * Branché dans /map via FilterPanel section "Indicateurs civiques".
 * Une seule variable supportée pour l'instant : abstention_pres_2022.
 *
 * Mécanique :
 *   • Quand `variableCode` ≠ null : fetch /api/insee-variables/[code]/geojson?bbox=
 *     puis ajoute source + layer fill + line MapLibre, paint interpolé sur
 *     property `value`.
 *   • Quand `variableCode` = null : nettoie la source/layer.
 *   • Hover : popup CP + valeur + libellé qualitatif.
 *
 * Le composant ne rend rien dans le DOM React — il manipule la map via un effet.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';

export type CivicVariableCode = 'abstention_pres_2022' | null;

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  variableCode: CivicVariableCode;
  /** Niveau d'opacité du layer (0-1). Default 0.65. */
  opacity?: number;
}

const SOURCE_ID = 'civic-cps-source';
const FILL_ID = 'civic-cps-fill';
const LINE_ID = 'civic-cps-line';

// Métadonnées par variable (gradient colorimétrique + libellé tooltip + unité)
const VAR_META: Record<NonNullable<CivicVariableCode>, {
  label: string;
  unit: string;
  /** Stops [valeur, couleur] pour interpolate paint MapLibre */
  stops: Array<[number, string]>;
  qualifier: (v: number) => string;
}> = {
  abstention_pres_2022: {
    label: 'Taux d\'abstention 2022',
    unit: '%',
    // Vert (forte participation) → rouge (forte abstention)
    stops: [
      [10,  '#16a34a'],   // vert profond
      [20,  '#84cc16'],   // vert-jaune
      [25,  '#eab308'],   // jaune
      [30,  '#f97316'],   // orange
      [40,  '#dc2626'],   // rouge
      [60,  '#7f1d1d'],   // rouge profond
    ],
    qualifier: (v) => {
      if (v < 18) return 'Très forte participation';
      if (v < 25) return 'Forte participation';
      if (v < 30) return 'Participation moyenne';
      if (v < 40) return 'Abstention élevée';
      return 'Abstention très élevée';
    },
  },
};

// Bbox monde entier — couvre France métro ET tous les DROM-COM
// (Guadeloupe -61°W, Réunion 55°E, Guyane -53°W, Mayotte 45°E, Polynésie -149°W).
// Sans ça, le filtre ST_Intersects exclut les DROM des features retournées.
const WORLD_BBOX = '-180,-90,180,90';

export function CivicIndicatorsLayer({ mapRef, variableCode, opacity = 0.65 }: Props) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const handlersRef = useRef<{
    move?: (e: maplibregl.MapMouseEvent) => void;
    leave?: () => void;
    click?: (e: maplibregl.MapMouseEvent) => void;
  } | null>(null);

  // Cleanup centralisé : retire layer/source/popup/handlers
  const cleanup = (map: maplibregl.Map) => {
    if (handlersRef.current?.move) map.off('mousemove', FILL_ID, handlersRef.current.move);
    if (handlersRef.current?.leave) map.off('mouseleave', FILL_ID, handlersRef.current.leave);
    if (handlersRef.current?.click) map.off('click', FILL_ID, handlersRef.current.click);
    handlersRef.current = null;
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Désactivation
    if (!variableCode) {
      cleanup(map);
      return;
    }

    const meta = VAR_META[variableCode];
    if (!meta) return;

    let cancelled = false;

    // Fetch GeoJSON France entière + DROM-COM (data publique, ~2-3 MB compressé).
    // Cache-bust via timestamp pour éviter le cache navigateur stale après re-import data.
    adminFetch(`/api/insee-variables/${variableCode}/geojson?bbox=${WORLD_BBOX}&_=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((geojson: GeoJSON.FeatureCollection | null) => {
        if (cancelled || !geojson) return;
        const m = mapRef.current;
        if (!m) return;

        cleanup(m);

        m.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

        // Construit l'expression interpolate à partir des stops
        const interpolateExpr: maplibregl.ExpressionSpecification = [
          'interpolate',
          ['linear'],
          ['coalesce', ['to-number', ['get', 'value']], 25],
          ...meta.stops.flat(),
        ] as maplibregl.ExpressionSpecification;

        m.addLayer({
          id: FILL_ID,
          type: 'fill',
          source: SOURCE_ID,
          paint: {
            'fill-color': interpolateExpr,
            'fill-opacity': opacity,
          },
        });
        m.addLayer({
          id: LINE_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#ffffff',
            'line-width': 0.3,
            'line-opacity': 0.4,
          },
        });
        // Force le layer EN HAUT de la stack pour qu'il ne soit pas masqué
        // par les labels/rues blanches de la base map (sinon Paris invisible
        // au zoom France entière car les labels "Paris" couvrent les arrond.).
        try {
          m.moveLayer(FILL_ID);
          m.moveLayer(LINE_ID);
        } catch { /* layers déjà en top, ignore */ }

        // Hover : juste change le curseur en pointer (pas de popup auto)
        // Le popup s'affiche uniquement au CLIC pour rester persistant.
        const onMove = () => { m.getCanvas().style.cursor = 'pointer'; };
        const onLeave = () => { m.getCanvas().style.cursor = ''; };

        // Click : popup persistant avec nom commune + valeur + qualifier + nb inscrits
        const onClick = async (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as Record<string, unknown>;
          const cp = String(props.code_postal ?? '');
          const v = Number(props.value ?? NaN);
          const inscrits = Number(props.inscrits ?? 0);
          const dept = String(props.code_dept ?? '');
          if (!Number.isFinite(v)) return;

          // Lookup nom de la 1ère commune associée au CP via l'endpoint dédié
          let communeName = '';
          let nbCommunes = 0;
          try {
            const res = await adminFetch(`/api/insee-variables/cp-detail?cp=${cp}`, { cache: 'force-cache' });
            if (res.ok) {
              const j = await res.json();
              communeName = j.commune_principale ?? '';
              nbCommunes = j.nb_communes ?? 0;
            }
          } catch { /* silencieux */ }

          if (popupRef.current) popupRef.current.remove();
          const Popup = (window as typeof window & { maplibregl?: typeof maplibregl }).maplibregl?.Popup ?? maplibregl.Popup;
          const communesLine = communeName
            ? `<div style="font-family: 'Inter', sans-serif; font-size: 12px; color: #f0f0f0; margin-bottom: 2px;">
                 ${communeName}${nbCommunes > 1 ? ` <span style="color: #a0a0a0; font-size: 10px;">+ ${nbCommunes - 1} autre${nbCommunes > 2 ? 's' : ''}</span>` : ''}
               </div>`
            : '';
          popupRef.current = new Popup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '300px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family: 'Inter', system-ui, sans-serif; line-height: 1.5; padding: 4px 2px;">
                <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a0a0a0;">${cp}</span>
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #666;">DÉPT ${dept}</span>
                </div>
                ${communesLine}
                <div style="
                  background: rgba(78,205,196,0.08);
                  border: 0.5px solid rgba(78,205,196,0.3);
                  border-radius: 4px;
                  padding: 8px 10px;
                  margin-top: 6px;
                ">
                  <div style="font-size: 10px; color: #a0a0a0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">${meta.label}</div>
                  <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: #4ecdc4; font-weight: 500;">
                    ${v.toFixed(1)}${meta.unit}
                  </div>
                  <div style="font-size: 11px; color: #a0a0a0; margin-top: 2px;">${meta.qualifier(v)}</div>
                </div>
                <div style="font-size: 11px; color: #a0a0a0; margin-top: 8px; display: flex; justify-content: space-between;">
                  <span>Inscrits sur les listes</span>
                  <span style="font-family: 'JetBrains Mono', monospace; color: #f0f0f0;">${inscrits.toLocaleString('fr-FR')}</span>
                </div>
              </div>
            `)
            .addTo(m);
        };
        m.on('mousemove', FILL_ID, onMove);
        m.on('mouseleave', FILL_ID, onLeave);
        m.on('click', FILL_ID, onClick);
        handlersRef.current = { move: onMove, leave: onLeave, click: onClick };
      })
      .catch(e => {
        console.error('[CivicIndicatorsLayer] fetch failed', e);
      });

    return () => {
      cancelled = true;
      const m = mapRef.current;
      if (m) cleanup(m);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableCode, opacity]);

  return null;
}

/** Liste des variables disponibles (utilisé par le dropdown FilterPanel). */
export const CIVIC_VARIABLES: Array<{ code: NonNullable<CivicVariableCode>; label: string; icon: string; description: string }> = [
  {
    code: 'abstention_pres_2022',
    label: 'Taux d\'abstention 2022',
    icon: '🗳️',
    description: 'Présidentielle 2022 — second tour. Source : Ministère de l\'Intérieur.',
  },
];

/** Légende statique (utilisée par le panel FilterPanel sous le dropdown). */
export function getCivicLegendStops(code: NonNullable<CivicVariableCode>): Array<[number, string]> {
  return VAR_META[code].stops;
}

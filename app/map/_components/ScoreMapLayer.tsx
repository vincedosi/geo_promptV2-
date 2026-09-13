'use client';

/**
 * ScoreMapLayer — choroplèthe 0-100 du score composite par code postal
 * (Tâche 12, 2026-09-13).
 *
 * Activée par l'événement `magelian:score-map` : detail = { scores, libelle }.
 * Éteinte par le même événement avec `scores: []`.
 *
 * ── Patron d'écoute : DEUX effets, jamais un seul ──────────────────────────
 * Un effet `[]` écoute l'événement et ne fait que poser un ÉTAT ; un second
 * effet, déclenché par cet état, lit `mapRef.current` et touche la carte.
 * C'est le patron de `SuiviMapLayer`, et il n'est pas cosmétique : la première
 * version de ce fichier faisait tout dans un seul effet à dépendances stables
 * (`[mapRef, eteindre]`), avec un `if (!m) return` en tête. React exécute les
 * effets des ENFANTS avant ceux du parent, et `mapRef.current` n'est renseigné
 * que dans un effet de `MapPage` (`useMapInit.ts:1071`) — donc au montage la
 * ref valait `null`, l'effet sortait, aucun listener n'était posé, et comme
 * ses dépendances ne changent jamais il n'y avait pas de seconde chance.
 * **Le calque ne se peignait jamais.** Trouvé en relecture, pas par les tests.
 *
 * Corollaire du même défaut : capturer la carte une fois aurait fait peindre
 * sur une instance détruite après un changement de fond (`useMapInit` fait
 * `map.remove()` puis recrée l'instance à chaque `mapStyleUrl`). La carte est
 * donc relue à chaque passage, y compris dans le gestionnaire de clic.
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

/**
 * Un score PARTIEL (moins d'indicateurs que demandé) est peint en retrait.
 * Sa normalisation porte sur la sous-population qui possède ces indicateurs :
 * il n'est pas comparable à un score complet, et les peindre à l'identique
 * laissait croire le contraire.
 */
const OPACITE: maplibregl.ExpressionSpecification =
  ['case', ['==', ['get', 'partiel'], true], 0.32, 0.85];

export function ScoreMapLayer({ mapRef }: Props) {
  const [actif, setActif] = useState<ScoreMapEventDetail | null>(null);
  const [chargement, setChargement] = useState(false);
  const [echec, setEchec] = useState(false);
  const geometriesRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null);

  // ── 1. Écoute seule : pose un état, ne touche jamais la carte ───────────
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<ScoreMapEventDetail>).detail;
      setActif(detail && detail.scores.length ? detail : null);
    };
    window.addEventListener(SCORE_MAP_EVENT, onEvent);
    return () => window.removeEventListener(SCORE_MAP_EVENT, onEvent);
  }, []);

  const nettoyer = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    if (clickRef.current) { m.off('click', FILL_ID, clickRef.current); clickRef.current = null; }
    popupRef.current?.remove();
    popupRef.current = null;
    if (m.getLayer(LINE_ID)) m.removeLayer(LINE_ID);
    if (m.getLayer(FILL_ID)) m.removeLayer(FILL_ID);
    if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
  }, [mapRef]);

  // ── 2. Travail carte : relit mapRef.current à CHAQUE passage ────────────
  useEffect(() => {
    if (!actif) { nettoyer(); setEchec(false); return; }

    // Jeton d'annulation : le chargement des contours pèse 3,8 Mo. Sans lui,
    // activer un autre dégradé pendant ce chargement laissait la promesse
    // reprendre ensuite et AJOUTER la couche — deux choroplèthes empilées,
    // après que le nettoyage n'eut rien trouvé à retirer.
    let annule = false;
    setEchec(false);

    (async () => {
      if (!geometriesRef.current) {
        setChargement(true);
        try {
          const res = await adminFetch('/api/meteo-geo/zones?scale=cp');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contours = await res.json() as GeoJSON.FeatureCollection;
          if (annule) return;
          geometriesRef.current = contours;
        } catch {
          if (!annule) { setEchec(true); setChargement(false); }
          return;
        }
        if (annule) return;
        setChargement(false);
      }

      const carte = mapRef.current;
      if (annule || !carte) return;

      const parCode = new Map(actif.scores.map((s) => [s.code, s]));
      const features = geometriesRef.current.features
        .filter((f) => parCode.has(String(f.properties?.code ?? '')))
        .map((f) => {
          const s = parCode.get(String(f.properties?.code ?? ''))!;
          return {
            ...f,
            properties: {
              ...f.properties,
              score: s.score,
              n_indicateurs: s.n_indicateurs,
              partiel: s.n_indicateurs < actif.nIndicateurs,
            },
          };
        });
      const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

      const teal = getComputedStyle(document.documentElement).getPropertyValue('--brand-teal').trim() || '#4ecdc4';
      const source = carte.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(collection);
      } else {
        carte.addSource(SOURCE_ID, { type: 'geojson', data: collection });
        carte.addLayer({
          id: FILL_ID, type: 'fill', source: SOURCE_ID,
          paint: { 'fill-color': echelleScore(teal), 'fill-opacity': OPACITE },
        });
        carte.addLayer({
          id: LINE_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': 'rgba(255,255,255,0.12)', 'line-width': 0.5 },
        });
      }

      // `esc` sur TOUTE valeur reprise dans le HTML du popup (correctif XSS des
      // popups, 2026-09-11).
      if (!clickRef.current) {
        const onClick = (e: maplibregl.MapMouseEvent) => {
          const carteClic = mapRef.current;
          if (!carteClic?.getLayer(FILL_ID)) return;
          const f = carteClic.queryRenderedFeatures(e.point, { layers: [FILL_ID] })[0];
          if (!f) return;
          const code = esc(String(f.properties?.code ?? ''));
          const nom = esc(String(f.properties?.nom ?? ''));
          const score = Number(f.properties?.score ?? 0).toFixed(1);
          const n = Number(f.properties?.n_indicateurs ?? 0);
          const partiel = Boolean(f.properties?.partiel);
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, className: 'magelian-popup' })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:${fInter};font-size:12px;color:var(--text-primary)">` +
              `<div style="font-weight:500">${code}${nom ? ` — ${nom}` : ''}</div>` +
              `<div style="font-family:${fMono};font-size:16px;margin:4px 0">${score}<span style="font-size:11px;color:var(--text-tertiary)">/100</span></div>` +
              `<div style="font-size:11px;color:${partiel ? 'var(--warning)' : 'var(--text-tertiary)'}">` +
              `sur ${n} indicateur${n > 1 ? 's' : ''}${partiel ? ' — partiel, non comparable' : ''}</div>` +
              `</div>`,
            )
            .addTo(carteClic);
        };
        clickRef.current = onClick;
        carte.on('click', FILL_ID, onClick);
      }
    })();

    return () => { annule = true; };
  }, [actif, mapRef, nettoyer]);

  // Retrait à la disparition du composant — séparé du travail ci-dessus, qui
  // ne doit PAS effacer la couche à chaque changement d'`actif`.
  useEffect(() => nettoyer, [nettoyer]);

  if (!actif && !chargement && !echec) return null;

  const partiels = actif ? actif.scores.filter((s) => s.n_indicateurs < actif.nIndicateurs).length : 0;

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
      background: 'var(--card)', border: '0.5px solid var(--border-subtle)',
      borderRadius: 6, padding: '10px 12px', zIndex: 5, minWidth: 200, maxWidth: 260,
      fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
    }}>
      {chargement && 'Chargement des contours…'}

      {/* Un échec silencieux laissait l'utilisateur sans calque ET sans
          explication — alors que son dégradé précédent avait déjà été éteint. */}
      {echec && (
        <span style={{ color: 'var(--danger)' }}>
          Contours des codes postaux indisponibles — le score est calculé, mais ne peut pas être affiché.
        </span>
      )}

      {actif && !chargement && !echec && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 500, flex: 1 }}>
              Score composite
            </span>
            {/* Sans cette croix, la seule façon d'éteindre le score était
                d'activer un autre dégradé. */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent<ScoreMapEventDetail>(SCORE_MAP_EVENT, {
                detail: { scores: [], libelle: '', nIndicateurs: 0 },
              }))}
              style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
              aria-label="Masquer le score composite"
            >×</button>
          </div>
          <div style={{ marginBottom: 8, lineHeight: 1.4 }}>{actif.libelle}</div>
          <div style={{
            height: 6, borderRadius: 3, marginBottom: 4,
            background: 'linear-gradient(to right, rgba(78,205,196,0.10), var(--brand-teal))',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span>0</span><span>100</span>
          </div>
          <div style={{ marginTop: 8, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
            {actif.scores.length} code{actif.scores.length > 1 ? 's' : ''} postal{actif.scores.length > 1 ? 'ux' : ''}
          </div>
          {partiels > 0 && (
            <div style={{ marginTop: 4, fontFamily: fMono, fontSize: 10, color: 'var(--warning)' }}>
              {partiels} partiel{partiels > 1 ? 's' : ''}, peint{partiels > 1 ? 's' : ''} en transparence
            </div>
          )}
        </>
      )}
    </div>
  );
}

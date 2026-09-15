'use client';

/**
 * DiffusionMapLayer — la carte « Diffusion » plein écran du Suivi V2 (Tâche
 * 13B, `task-13-brief.md` + `docs/DOC INTERFACE/PROMPT_OVERLAY_SUIVI_V2.md:101`).
 *
 * Ce que la carte affiche « en mode campagne » : la pression réelle comparée
 * au plan, sur tout le territoire visible, échelle **divergente** — la même
 * que la vignette « Alignement » de la Tâche 13A, jamais une seconde échelle.
 * Contrairement aux vignettes (trop petites), les zones les plus déréglées
 * sont ANNOTÉES par leur nom. Le score est rappelé dans une carte flottante
 * avec un retour au Suivi.
 *
 * Remplace `SuiviMapLayer.tsx` **dans l'intention**, pas dans le code : ce
 * fichier n'est PAS supprimé (Tâche 16 seulement) — les deux calques peuvent
 * coexister le temps de comparer les deux chiffres.
 *
 * ── Géométrie et échelle : AUCUNE seconde source ─────────────────────────
 * Réutilise `alignement_par_maille_geo` via la MÊME route que les vignettes
 * (`.../alignement/maille/map`, Tâche 13A) et les MÊMES `BORNES_DIVERGENTES`/
 * `RAMPE_MAPLIBRE`/`expressionEtapes` (`lib/campagne/vignette-carte.ts`,
 * `lib/campagne/palette-divergente.ts`) — zéro hex en dur en dehors de ces
 * rampes, zéro deuxième RPC de géométrie.
 *
 * ── Piège #1 (déjà vécu ici trois fois) : réapplication imperative du thème
 * Ce calque touche le MÊME `mapRef.current` que le reste de `/map` (pas une
 * instance MapLibre embarquée comme `CarteVignette`) — mêmes garde-fous que
 * `SuiviMapLayer`/`ScoreMapLayer` : deux effets, jamais un seul avec des deps
 * stables qui capturerait `mapRef.current === null` au montage (leçon de
 * `ScoreMapLayer`, voir son en-tête). `mapReady` (prop, source unique
 * `useMapInit.ts:1068`) garantit que `mapRef.current` est déjà posé dès que
 * `mapReady` vaut `true` — c'est LUI qui donne la seconde chance, pas une
 * dépendance sur `mapRef` (identité de ref toujours stable, ne redéclenche
 * jamais un effet).
 *
 * ── Piège #2 : bornes non strictement croissantes rejetées en silence
 * `expressionEtapes` (Tâche 13A) lève une erreur explicite plutôt que de
 * construire une expression MapLibre muette — réutilisée telle quelle.
 *
 * ── Piège #3 : jamais désagréger sous le code postal
 * La valeur d'un CP s'applique à TOUTE sa zone, quelle que soit la maille
 * affichée (région/département moyennent déjà plusieurs CP en amont, côté
 * RPC) — la légende de la carte flottante le rappelle explicitement
 * (`NOTE_MAILLE_CP`, texte UNIQUE partagé avec `CarteVignette.tsx`).
 *
 * ── Viewport, jamais la France entière ────────────────────────────────────
 * `moveend` débounce 600 ms + garde sur la bbox arrondie (patron
 * `useRadioLayer.ts`) : navigable et interactive, mais toujours bornée au
 * viewport visible — jamais un scan France entière (règle CLAUDE.md, trois
 * incidents). La tolérance de simplification de la géométrie est DÉRIVÉE de
 * cette bbox côté RPC (ruling T13A-1) : zoomer republie une géométrie plus
 * fine automatiquement, gratuitement.
 *
 * ── Sélection bidirectionnelle (Step 3 de la tâche 13, périmètre 13B) ────
 * Clic sur une zone → `majSession({ uniteSelectionnee: code })`. En sens
 * inverse, `session.uniteSelectionnee` (posé ici OU par une épingle de ligne
 * du tableau, Tâche 14) surligne la zone ET centre la caméra dessus — sauf
 * si le code vient de notre PROPRE clic (`dernierClicRef`), pour ne pas
 * re-voler la caméra sur un clic que l'utilisateur vient de faire à cet
 * endroit précis. LIMITE CONNUE : si la zone épinglée n'est pas dans les
 * `features` actuellement chargées (hors viewport courant), aucun centrage
 * n'a lieu — cette route est bbox-filtrée par construction (Tâche 13A) et ne
 * porte pas de « géométrie d'un code, quel que soit le viewport ». Signalé au
 * rapport, pas contourné par une route supplémentaire hors périmètre.
 *
 * ── Exclusivité des dégradés (lib/carte/degrades.ts) ──────────────────────
 * `visible` est calculé par `page.tsx`, seul à connaître `degradeActif` — ce
 * composant ne demande PAS lui-même l'exclusivité (contrairement à
 * `SuiviMapLayer`/`ScoreMapLayer`, dont l'activation traverse une frontière
 * d'arbre React via un bus d'événements DOM). La session de campagne étant
 * un contexte GLOBAL depuis la Tâche 2 (`CampagneSessionProvider` dans
 * `app/layout.tsx`), `page.tsx` lit `useCampagneSession()` directement : pas
 * besoin d'un second bus d'événements pour ce calque.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { adminFetch } from '@/lib/admin-fetch';
import {
  expressionEtapes,
  NOTE_MAILLE_CP,
  type FeatureAlignementGeo,
  type ReponseAlignementMailleGeo,
} from '@/lib/campagne/vignette-carte';
import { BORNES_DIVERGENTES, RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente';
import { COULEUR_DONNEE_ABSENTE } from '@/lib/carreaux/expressions';
import { zonesAAnnoter, centreFeature, bboxVersParametre } from '@/lib/campagne/diffusion-carte';
import { libelleVariation, type ReponseAlignement } from '@/components/campagne/suivi-v2/ScoreAlignement';
import { formaterNombre, formaterNombreArrondi } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SOURCE_ID = 'diffusion-cp';
const FILL_ID = 'diffusion-cp-fill';
const LINE_ID = 'diffusion-cp-line';
const LABELS_SOURCE_ID = 'diffusion-labels';
const LABELS_LAYER_ID = 'diffusion-labels-symbol';
/** Débounce moveend — même valeur que `useRadioLayer.ts` (mode clusters). */
const DEBOUNCE_MOVEEND_MS = 600;
/** Zones annotées par leur nom (spec §2 : « les zones les plus déréglées »). */
const MAX_ANNOTATIONS = 6;

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Garantit `mapRef.current !== null` (posé de façon synchrone AVANT le
   *  `load` asynchrone qui pose `mapReady`, `useMapInit.ts:1068`) — voir
   *  l'en-tête de fichier, leçon de `ScoreMapLayer`. */
  mapReady: boolean;
  /** Actif ET gagnant de l'exclusivité des dégradés — calculé par `page.tsx`. */
  visible: boolean;
}

/** Signature + largeur du surlignage de la zone sélectionnée — lit les tokens
 *  au moment de l'appel (jamais figé), même règle que le reste du fichier. */
function expressionLigne(
  codeSelectionne: string | null,
  teal: string,
): { couleur: maplibregl.ExpressionSpecification; largeur: maplibregl.ExpressionSpecification } {
  const estSelectionnee = ['==', ['get', 'code'], codeSelectionne] as unknown as maplibregl.ExpressionSpecification;
  return {
    couleur: ['case', estSelectionnee, teal, 'rgba(255,255,255,0.16)'] as unknown as maplibregl.ExpressionSpecification,
    largeur: ['case', estSelectionnee, 2.5, 0.4] as unknown as maplibregl.ExpressionSpecification,
  };
}

/** `+38 %` / `-52 %` — jamais un nombre sans signe sur une échelle divergente. */
function formaterEcart(valeur: number): string {
  return `${valeur >= 0 ? '+' : ''}${formaterNombreArrondi(valeur)} %`;
}

export function DiffusionMapLayer({ mapRef, mapReady, visible }: Props) {
  const { session, majSession, basculerVue } = useCampagneSession();
  const { theme } = useTheme();

  const [features, setFeatures] = useState<FeatureAlignementGeo[]>([]);
  const [nTotal, setNTotal] = useState(0);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [score, setScore] = useState<ReponseAlignement | null>(null);

  const dernierBboxRef = useRef<string | null>(null);
  const dernierClicRef = useRef<string | null>(null);
  const dernierCentrageRef = useRef<string | null>(null);
  const clickRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const enterRef = useRef<(() => void) | null>(null);
  const leaveRef = useRef<(() => void) | null>(null);

  const campaignId = session.campaignId;

  // ── Chargement de la géométrie — jamais toute la France (bbox obligatoire) ──
  const chargerGeometrie = useCallback(async (bbox: string) => {
    if (!campaignId) return;
    setChargement(true);
    try {
      const params = new URLSearchParams({ maille: session.maille, bbox });
      if (session.parent) params.set('parent', session.parent);
      const res = await adminFetch(
        `/api/campaigns/${campaignId}/alignement/maille/map?${params.toString()}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ReponseAlignementMailleGeo;
      setFeatures(data.features ?? []);
      setNTotal(data.n_total ?? 0);
      setErreur(null);
    } catch {
      setErreur('Impossible de charger la carte de diffusion.');
    } finally {
      setChargement(false);
    }
  }, [campaignId, session.maille, session.parent]);

  // ── Activation / changement de campagne, maille ou fil d'Ariane : force un
  // rafraîchissement même à bbox inchangée (la garde moveend ci-dessous ne
  // doit PAS empêcher un changement de maille de recharger). ──────────────
  useEffect(() => {
    if (!visible) { setFeatures([]); setScore(null); dernierBboxRef.current = null; return; }
    dernierBboxRef.current = null;
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const b = map.getBounds();
    const bbox = bboxVersParametre([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    dernierBboxRef.current = bbox;
    chargerGeometrie(bbox);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mapReady, campaignId, session.maille, session.parent, chargerGeometrie]);

  // ── Recharge au moveend — débounce 600 ms + garde sur bbox arrondie,
  // patron `useRadioLayer.ts` (mode clusters/heatmap). Jamais un scan France
  // entière : le viewport EST le périmètre demandé. ───────────────────────
  useEffect(() => {
    if (!visible || !mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    let timer: ReturnType<typeof setTimeout>;
    const onMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        const bbox = bboxVersParametre([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        if (bbox === dernierBboxRef.current) return;
        dernierBboxRef.current = bbox;
        chargerGeometrie(bbox);
      }, DEBOUNCE_MOVEEND_MS);
    };
    map.on('moveend', onMoveEnd);
    return () => { map.off('moveend', onMoveEnd); clearTimeout(timer); };
  }, [visible, mapReady, mapRef, chargerGeometrie]);

  // ── Score rappelé dans la carte flottante — indépendant de la maille/bbox,
  // toujours calculé au CP (règle non négociable de la spec). ─────────────
  useEffect(() => {
    if (!visible || !campaignId) { setScore(null); return; }
    let annule = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/alignement`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as ReponseAlignement;
        if (!annule) setScore(data);
      } catch { /* la carte reste utilisable sans le rappel de score */ }
    })();
    return () => { annule = true; };
  }, [visible, campaignId]);

  // ── Expressions de peinture — mêmes rampes que CarteVignette (13A), zéro
  // hex en dur en dehors d'elles. ──────────────────────────────────────────
  const expressionRemplissage = useMemo(
    () => expressionEtapes('ecart_pct', 'hors_plan', BORNES_DIVERGENTES, RAMPE_MAPLIBRE[theme], COULEUR_DONNEE_ABSENTE),
    [theme],
  );

  const etiquettes = useMemo(() => zonesAAnnoter(features, MAX_ANNOTATIONS), [features]);

  // ── Source + calques — recréés une fois, mis à jour par `setData` ensuite.
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { code: f.code ?? '—', nom: f.nom, ecart_pct: f.ecart_pct, hors_plan: f.hors_plan, impressions: f.impressions },
      })),
    };
    const fcLabels: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: etiquettes.map((e) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: e.centre },
        properties: { libelle: `${e.nom}\n${formaterEcart(e.ecart_pct)}` },
      })),
    };

    const appliquer = () => {
      const srcZones = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const srcLabels = map.getSource(LABELS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (srcZones && srcLabels) {
        srcZones.setData(fc);
        srcLabels.setData(fcLabels);
        return;
      }

      map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
      map.addLayer({
        id: FILL_ID, type: 'fill', source: SOURCE_ID,
        paint: { 'fill-color': expressionRemplissage, 'fill-opacity': 0.6 },
      });
      map.addLayer({
        id: LINE_ID, type: 'line', source: SOURCE_ID,
        paint: { 'line-color': 'rgba(255,255,255,0.16)', 'line-width': 0.4 },
      });
      map.addSource(LABELS_SOURCE_ID, { type: 'geojson', data: fcLabels });
      map.addLayer({
        id: LABELS_LAYER_ID, type: 'symbol', source: LABELS_SOURCE_ID,
        layout: {
          'text-field': ['get', 'libelle'],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-anchor': 'center',
          'text-justify': 'center',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.75)',
          'text-halo-width': 1.4,
        },
      });

      const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0];
        const code = f?.properties && String((f.properties as Record<string, unknown>).code ?? '');
        if (!code || code === '—') return;
        dernierClicRef.current = code;
        majSession({ uniteSelectionnee: code });
      };
      const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
      const onLeave = () => { map.getCanvas().style.cursor = ''; };
      map.on('click', FILL_ID, onClick);
      map.on('mouseenter', FILL_ID, onEnter);
      map.on('mouseleave', FILL_ID, onLeave);
      clickRef.current = onClick;
      enterRef.current = onEnter;
      leaveRef.current = onLeave;
    };

    if (map.isStyleLoaded()) appliquer(); else map.once('load', appliquer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, features, etiquettes, mapRef]);

  // ── Piège #1 : réapplication IMPÉRATIVE du remplissage au changement de
  // thème OU de données — jamais une lecture figée. Idempotent, garde
  // `isStyleLoaded()`, repli `once('load')` — même patron que
  // `CarteVignette.tsx` / `useMapInit.ts:1091-1102`. ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    const reapply = () => {
      if (map.getLayer(FILL_ID)) map.setPaintProperty(FILL_ID, 'fill-color', expressionRemplissage);
    };
    if (map.isStyleLoaded()) reapply(); else map.once('load', reapply);
  }, [visible, expressionRemplissage, mapRef]);

  // ── Surlignage de la zone sélectionnée — même patron impératif, rejoué au
  // changement de sélection OU de thème (le teal lu au moment de l'appel). ──
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    const reapply = () => {
      if (!map.getLayer(LINE_ID)) return;
      const teal = getComputedStyle(document.documentElement).getPropertyValue('--brand-teal').trim() || '#4ecdc4';
      const { couleur, largeur } = expressionLigne(session.uniteSelectionnee, teal);
      map.setPaintProperty(LINE_ID, 'line-color', couleur);
      map.setPaintProperty(LINE_ID, 'line-width', largeur);
    };
    if (map.isStyleLoaded()) reapply(); else map.once('load', reapply);
  }, [visible, session.uniteSelectionnee, theme, mapRef]);

  // ── Centrage sur une sélection venue d'AILLEURS (épingle d'une ligne du
  // tableau, Tâche 14) — jamais sur notre propre clic (`dernierClicRef`), qui
  // a déjà la bonne caméra sous les yeux de l'utilisateur.
  //
  // `dernierCentrageRef` est INDISPENSABLE, pas cosmétique : cet effet est
  // aussi keyé sur `features`, qui change à CHAQUE `moveend` (viewport
  // refetch, cf plus haut). Sans lui, laisser une sélection active puis
  // simplement PANNER la carte re-déclencherait ce même effet à chaque
  // rafraîchissement — et si la zone sélectionnée réapparaît dans le nouveau
  // viewport, la caméra revolerait dessus, combattant le geste de
  // l'utilisateur. Ce ref retient « déjà centré pour ce code » et bloque
  // toute re-tentative tant que la sélection elle-même n'a pas changé. ────
  useEffect(() => {
    const map = mapRef.current;
    const code = session.uniteSelectionnee;
    if (!visible || !mapReady || !map) return;
    if (!code) { dernierCentrageRef.current = null; return; }
    if (dernierClicRef.current === code) {
      dernierClicRef.current = null;
      dernierCentrageRef.current = code; // caméra déjà sur cette zone, rien à voler
      return;
    }
    if (dernierCentrageRef.current === code) return; // déjà centré pour cette sélection
    const f = features.find((x) => x.code === code);
    const centre = f ? centreFeature(f) : null;
    if (!centre) return; // zone pas encore trouvée dans le viewport courant : retenter au prochain fetch
    dernierCentrageRef.current = code;
    map.flyTo({ center: centre, zoom: Math.max(map.getZoom(), 8), duration: 800 });
  }, [visible, mapReady, session.uniteSelectionnee, features, mapRef]);

  // ── Nettoyage — calque éteint (exclusivité) ou démonté. ──────────────────
  useEffect(() => {
    if (visible) return;
    const map = mapRef.current;
    if (!map) return;
    if (clickRef.current) { map.off('click', FILL_ID, clickRef.current); clickRef.current = null; }
    if (enterRef.current) { map.off('mouseenter', FILL_ID, enterRef.current); enterRef.current = null; }
    if (leaveRef.current) { map.off('mouseleave', FILL_ID, leaveRef.current); leaveRef.current = null; }
    if (map.getLayer(LABELS_LAYER_ID)) map.removeLayer(LABELS_LAYER_ID);
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(LABELS_SOURCE_ID)) map.removeSource(LABELS_SOURCE_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }, [visible, mapRef]);

  useEffect(() => () => {
    const map = mapRef.current;
    if (!map) return;
    if (clickRef.current) map.off('click', FILL_ID, clickRef.current);
    if (enterRef.current) map.off('mouseenter', FILL_ID, enterRef.current);
    if (leaveRef.current) map.off('mouseleave', FILL_ID, leaveRef.current);
    if (map.getLayer(LABELS_LAYER_ID)) map.removeLayer(LABELS_LAYER_ID);
    if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
    if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
    if (map.getSource(LABELS_SOURCE_ID)) map.removeSource(LABELS_SOURCE_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  // `variation_7j` absent (null) veut dire INCONNU, pas « stable » — le
  // coercer à 0 afficherait une variation fabriquée. Même garde que
  // `ScoreAlignement.tsx` (`<Variation valeur={data.variation_7j} />`, qui
  // rend `null` sur une valeur absente).
  const variation = score && !score.plan_divergent && score.variation_7j != null
    ? libelleVariation(score.variation_7j)
    : null;
  const tronque = nTotal > features.length;

  return (
    <div
      style={{
        position: 'fixed', right: 16, bottom: 28, zIndex: 45, width: 260,
        background: 'var(--card-overlay, rgba(10,10,10,0.92))', border: '0.5px solid var(--border-default)',
        borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
          Diffusion {chargement ? '· chargement…' : ''}
        </span>
        <button
          type="button"
          onClick={() => basculerVue()}
          style={{
            background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 6,
            padding: '3px 9px', color: 'var(--text-secondary)', fontFamily: fInter, fontSize: 11, cursor: 'pointer',
          }}
        >
          Retour au suivi
        </button>
      </div>

      {erreur && (
        <p role="alert" style={{ margin: 0, fontFamily: fInter, fontSize: 12, color: 'var(--danger)' }}>{erreur}</p>
      )}

      {score && (
        score.plan_divergent ? (
          <p style={{ margin: 0, fontFamily: fInter, fontSize: 11, color: 'var(--warning)' }}>
            Le plan diverge entre acteurs sur au moins un code postal — score non calculable.
          </p>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: fMono, fontSize: 34, fontWeight: 700, color: 'var(--brand-teal)', lineHeight: 1 }}>
                {score.score}
              </span>
              <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>/100</span>
              {variation && (
                <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  {variation.texte}
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
              Alignement géographique, calculé au code postal.
            </p>
          </div>
        )
      )}

      <div style={{ display: 'flex', gap: 2 }} aria-hidden>
        {RAMPE_MAPLIBRE[theme].map((couleur, i) => (
          <span key={i} style={{ flex: 1, height: 5, borderRadius: 1, background: couleur }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
        <span>sous</span>
        <span>sur</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--donnee-absente)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>Gris = hors plan</span>
      </div>

      <p style={{ margin: 0, fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
        {NOTE_MAILLE_CP}
      </p>

      {tronque && (
        <p style={{ margin: 0, fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
          {formaterNombre(features.length)} zones affichées sur {formaterNombre(nTotal)} — zoomez pour plus de détail.
        </p>
      )}
    </div>
  );
}

'use client';

/**
 * CarteVignette — une des trois miniatures cartographiques du cockpit de
 * suivi V2 (Tâche 13A, task-13-brief.md). Composant PUR côté données : reçoit
 * son `FeatureCollection` déjà calculé (route
 * `.../alignement/maille/map`, RPC `alignement_par_maille_geo`, sql/165) —
 * aucun fetch ici, Task 15 orchestre. Reprend le patron d'instance MapLibre
 * embarquee de `components/campaign/suivi/SuiviDeriveMap.tsx`, SUPPRIME a la
 * Tache 16 avec l'ancien ecran de suivi (le patron survit ici) : fond plein
 * sombre/clair, zéro tuile externe (aucun I/O tuiles Nano pour une carte qui
 * ne montre que des polygones déjà servis).
 *
 * Carte NON interactive (`interactive: false`) : les trois vignettes
 * partagent le même cadrage fixe (`bounds`, calculé une fois par
 * `TrioCartes` sur l'enveloppe du périmètre actif) — ce ne sont pas des
 * cartes qu'on explore, c'est un aperçu qu'on ouvre. Le clic sur la vignette
 * entière appelle `onOuvrir` ; la sélection zone-par-zone bidirectionnelle
 * (Tâche 13 Step 3) est HORS PÉRIMÈTRE de cette tâche (13B).
 *
 * Trois pièges déjà vécus dans ce dépôt (task-13-brief.md) :
 *  1. MapLibre ne résout PAS `var()` dans `paint` : les couleurs viennent de
 *     `RAMPE_MAPLIBRE`/`RAMPE_SEQUENTIELLE` (hex littéraux par thème). Un
 *     effet keyé sur `[expression]` (qui change d'identité à chaque
 *     changement de thème OU de données) réapplique `setPaintProperty` —
 *     idempotent, garde `isStyleLoaded()`, repli `once('load')`, même patron
 *     que `useMapInit.ts:1091-1102`. Ne JAMAIS lire une couleur une seule
 *     fois via `getComputedStyle` et la figer (défaut de `SuiviMapLayer.tsx`
 *     et `CivicHealthMapLayer.tsx`).
 *  2. Un `step` à bornes non strictement croissantes est rejeté EN SILENCE
 *     par MapLibre — `expressionEtapes` (lib/campagne/vignette-carte.ts)
 *     vérifie la stricte croissance et lève une erreur explicite plutôt que
 *     de construire une expression muette.
 *  3. La valeur d'un CP s'applique à TOUTE sa zone, y compris quand la
 *     maille affichée est région/département (moyenne de CP) : la légende
 *     le dit toujours (`NOTE_MAILLE_CP` ci-dessous), quelle que soit la
 *     maille — jamais de désagrégation sous le code postal.
 *
 * Zones hors périmètre : `alignement_par_maille_geo` ne les EXCLUT jamais —
 * la géométrie reste présente, `ecart_pct`/`variable_valeur` valent `null`
 * et `hors_plan` le signale. `expressionEtapes` les peint en gris
 * (`COULEUR_DONNEE_ABSENTE`) plutôt que de les faire disparaître.
 *
 * Pas d'annotation de noms : la vignette est trop petite (Tâche 13 Step 1) —
 * les noms restent sur la grande carte (13B).
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RAMPE_MAPLIBRE, BORNES_DIVERGENTES } from '@/lib/campagne/palette-divergente';
import { RAMPE_SEQUENTIELLE } from '@/lib/campagne/palette-sequentielle';
import { COULEUR_DONNEE_ABSENTE } from '@/lib/carreaux/expressions';
import {
  lireJetonCarte, apresApplicationDuTheme, JETON_CONTOUR_CARTE, JETON_FOND_CARTE,
} from '@/components/map/jetons-carte';
import {
  bornesQuantiles,
  rampePourBornes,
  expressionEtapes,
  domaineValeurs,
  libellesExtremites,
  NOTE_MAILLE_CP,
  type FeatureAlignementGeo,
  type TypeVignette,
} from '@/lib/campagne/vignette-carte';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SOURCE_ID = 'vignette-src';
const FILL_ID = 'vignette-fill';
const LINE_ID = 'vignette-line';
const BG_ID = 'bg';

export type { TypeVignette };

/** Propriété GeoJSON dont chaque type de vignette tire sa couleur. */
function proprieteValeur(type: TypeVignette): 'impressions' | 'variable_valeur' | 'ecart_pct' {
  if (type === 'impressions') return 'impressions';
  if (type === 'variable') return 'variable_valeur';
  return 'ecart_pct';
}

// NOTE_MAILLE_CP vient désormais de `lib/campagne/vignette-carte.ts` (Tâche
// 13B) : `DiffusionMapLayer.tsx` (carte plein écran) doit afficher EXACTEMENT
// le même texte — une seule formulation pour une règle que le brief qualifie
// de non négociable, jamais deux textes à tenir synchronisés à la main.

export interface CarteVignetteProps {
  type: TypeVignette;
  titre: string;
  sousTitre: string;
  features: FeatureAlignementGeo[];
  /** Cadrage PARTAGÉ par les trois vignettes — calculé une fois par `TrioCartes`
   *  sur l'enveloppe du périmètre actif, jamais recalculé ici (même projection,
   *  même cadrage pour les trois, Tâche 13 Step 1). */
  bounds: [number, number, number, number];
  theme: 'dark' | 'light';
  chargement?: boolean;
  /** Clic sur la vignette entière — 13B décide ce que ça ouvre. */
  onOuvrir?: () => void;
  /** Contrôle additionnel affiché dans l'en-tête, HORS du bouton d'ouverture —
   *  imbriquer un `<select>` dans un `<button>` est invalide en HTML. Sert le
   *  sélecteur d'indicateur de la vignette « variable » (Tâche 13 Step 2),
   *  fourni par `TrioCartes`. */
  controleEnTete?: ReactNode;
}

export function CarteVignette({
  type, titre, sousTitre, features, bounds, theme, chargement, onOuvrir, controleEnTete,
}: CarteVignetteProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const boundsAppliqueesRef = useRef<string | null>(null);

  const propriete = proprieteValeur(type);

  const { expression, bornesLegende, rampeLegende } = useMemo(() => {
    if (type === 'alignement') {
      return {
        expression: expressionEtapes(
          'ecart_pct', 'hors_plan', BORNES_DIVERGENTES, RAMPE_MAPLIBRE[theme], COULEUR_DONNEE_ABSENTE,
        ),
        bornesLegende: BORNES_DIVERGENTES as readonly number[],
        rampeLegende: RAMPE_MAPLIBRE[theme],
      };
    }
    const rampeComplete = RAMPE_SEQUENTIELLE[theme];
    const valeurs = features.map((f) => f[propriete]).filter((v): v is number => typeof v === 'number');
    const bornes = bornesQuantiles(valeurs, rampeComplete.length);
    const rampe = rampePourBornes(rampeComplete, bornes.length);
    return {
      expression: expressionEtapes(propriete, null, bornes, rampe, COULEUR_DONNEE_ABSENTE),
      bornesLegende: bornes,
      rampeLegende: rampe,
    };
  }, [type, propriete, features, theme]);

  const domaine = useMemo(
    () => domaineValeurs(features.map((f) => f[propriete])),
    [features, propriete],
  );

  // Init carte MapLibre — une fois. Fond plein, aucune tuile externe, non
  // interactive (les trois vignettes partagent un cadrage fixe).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bg = lireJetonCarte(JETON_FOND_CARTE);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [{ id: BG_ID, type: 'background', paint: { 'background-color': bg } }] },
      center: [2.5, 46.5],
      zoom: 3.4,
      attributionControl: false,
      interactive: false,
    });
    mapRef.current = map;
    map.once('load', () => { mapReadyRef.current = true; });
    return () => {
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      boundsAppliqueesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Source + layers — recréés une fois, mis à jour par `setData` ensuite.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          code: f.code, nom: f.nom, impressions: f.impressions,
          ecart_pct: f.ecart_pct, hors_plan: f.hors_plan, variable_valeur: f.variable_valeur,
        },
      })),
    };

    const apply = () => {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(fc);
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
        map.addLayer({
          id: FILL_ID, type: 'fill', source: SOURCE_ID,
          paint: { 'fill-color': expression, 'fill-opacity': 0.85 },
        });
        map.addLayer({
          id: LINE_ID, type: 'line', source: SOURCE_ID,
          paint: { 'line-color': lireJetonCarte(JETON_CONTOUR_CARTE), 'line-width': 0.4 },
        });
      }
    };

    if (mapReadyRef.current) apply(); else map.once('load', apply);
    // `expression` volontairement hors deps : l'effet de ré-application dédié
    // (ci-dessous) s'en charge sans recréer la source ni relancer fitBounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features]);

  // Cadrage — appliqué UNE fois par valeur de `bounds` reçue (partagée par les
  // trois vignettes), pas à chaque rendu de features.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cle = bounds.join(',');
    if (boundsAppliqueesRef.current === cle) return;

    const apply = () => {
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 6, duration: 0 });
      boundsAppliqueesRef.current = cle;
    };
    if (mapReadyRef.current) apply(); else map.once('load', apply);
  }, [bounds]);

  // Piège #1 : ré-application IMPÉRATIVE de l'expression au changement de
  // thème OU de données (`expression` change d'identité dans les deux cas) —
  // jamais une lecture figée. Idempotent, garde `isStyleLoaded()`, repli
  // `once('load')` — même patron que `useMapInit.ts:1091-1102`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const reapply = () => {
      if (map.getLayer(FILL_ID)) map.setPaintProperty(FILL_ID, 'fill-color', expression);
    };
    if (map.isStyleLoaded()) reapply(); else map.once('load', reapply);
  }, [expression]);

  // Même piège #1, deux propriétés que l'effet ci-dessus NE touche PAS : le
  // fond plein de l'instance (lu une seule fois à la création) et le contour
  // des zones. Sans cette ré-application, basculer sombre → clair pendant que
  // le Suivi est ouvert laisse un carré `#050505` derrière les polygones au
  // milieu d'une page blanche, et des contours blancs invisibles dessus.
  // Keyé sur `theme` ET `features` : la seconde dépendance couvre le cas où
  // les calques n'existaient pas encore au changement de thème.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const reapply = () => {
      if (map.getLayer(BG_ID)) {
        map.setPaintProperty(BG_ID, 'background-color', lireJetonCarte(JETON_FOND_CARTE));
      }
      if (map.getLayer(LINE_ID)) {
        map.setPaintProperty(LINE_ID, 'line-color', lireJetonCarte(JETON_CONTOUR_CARTE));
      }
    };
    return apresApplicationDuTheme(() => {
      if (map.isStyleLoaded()) reapply(); else map.once('load', reapply);
    });
  }, [theme, features]);

  const { finGauche, finDroite } = libellesExtremites(type, domaine);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>
            {titre}
          </h3>
          <p style={{ margin: '2px 0 0', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
            {sousTitre}
          </p>
        </div>
        {controleEnTete}
      </div>

      <button
        type="button"
        onClick={onOuvrir}
        aria-label={`${titre}, ouvrir en grand`}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 8, padding: 10, cursor: onOuvrir ? 'pointer' : 'default',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--brand-teal-30)';
          e.currentTarget.style.background = 'var(--bg-level-3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.background = 'var(--bg-level-2)';
        }}
      >
        <div
          style={{
            position: 'relative', width: '100%', aspectRatio: '190 / 170',
            borderRadius: 6, overflow: 'hidden', border: '0.5px solid var(--border-subtle)',
          }}
        >
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {chargement && (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-level-1)', opacity: 0.6, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)',
              }}
            >
              chargement…
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 2 }} aria-hidden>
          {rampeLegende.map((couleur, i) => (
            <span key={i} style={{ flex: 1, height: 5, borderRadius: 1, background: couleur }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span>{finGauche}</span>
          <span>{finDroite}</span>
        </div>

        <p style={{ margin: 0, fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
          {NOTE_MAILLE_CP}
        </p>
      </button>
    </div>
  );
}

// Exception B12 : échelles de DONNÉES, identiques dans les deux thèmes — deux teintes violettes de CATEGORY_COLORS gardées pour la parité (défaut React listé)
/**
 * Palettes de DONNÉES de la carte principale — copie Angular (lot 4, P6), verrouillée par
 * tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 étendu à /map).
 *
 * Sources React :
 *  - `app/copilote/_lib/constants.ts:71-129` : `CATEGORY_COLORS`, `getCatColor`, `ISOCHRONE_COLORS`,
 *    `ISOCHRONE_MODE_LABELS`, `VORONOI_PALETTE`, `BATTLE_PALIER_OPACITY` (verbatim) ;
 *  - `app/copilote/_hooks/useMapInit.ts:391-530` : les littéraux de `paint` du TMJA et de la radio,
 *    NOMMÉS ici (`PALIERS_TMJA`, `TEINTES_RADIO`) — React les écrivait en ligne dans l'initialisation
 *    de la carte ;
 *  - `app/map/_components/CivicIndicatorsLayer.tsx:38-60` : l'échelle d'abstention et son qualificatif ;
 *  - `lib/carreaux/catalogue.ts:63-100` : `CARREAUX_PALETTES`, déjà copiées par le lot 3
 *    (`features/risques/logique/palettes-donnees.ts`, exception A10) — RÉ-EXPORTÉES, pas recopiées.
 *
 * Une échelle de données est la même dans les deux thèmes : c'est pourquoi ce sont des hexadécimaux
 * littéraux (exception B12 à la règle « aucune couleur en dur »). Les couleurs d'INTERFACE, elles,
 * sont des jetons : `TEINTES_RADIO.jetonGrappes` etc. donnent des NOMS de jeton, jamais `var()` ni hex.
 *
 * Défauts React listés, NON corrigés (parité) :
 *  - `CATEGORY_COLORS` porte deux teintes violettes (`lycee` #6366f1, `default` #8b5cf6) alors que le
 *    design system interdit le violet ; `ISOCHRONE_COLORS.network` (#6366f1) aussi ;
 *  - `ISOCHRONE_MODE_LABELS` ne connaît pas `network`, que `ISOCHRONE_COLORS` connaît.
 */
import { PALETTES_DONNEES } from '../../risques/logique/palettes-donnees';

export type { CarreauxPalette } from '../../risques/logique/palettes-donnees';
/** Nom React de la table (lot 3 : `PALETTES_DONNEES`). */
export const CARREAUX_PALETTES = PALETTES_DONNEES;

// ---------------------------------------------------------------------------
// Category colors (cohérent avec MapContainer.tsx)
// ---------------------------------------------------------------------------

export const CATEGORY_COLORS: Record<string, string> = {
  lycee:   '#6366f1',
  college: '#3b82f6',
  cirfa:   '#ef4444',
  gare:    '#10b981',
  sport:   '#f59e0b',
  default: '#8b5cf6',
};

// (`CATEGORY_COLORS['default']` : notation à crochets imposée par `noPropertyAccessFromIndexSignature`.)
export function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] || CATEGORY_COLORS['default'];
}

// ---------------------------------------------------------------------------
// Isochrone
// ---------------------------------------------------------------------------

export const ISOCHRONE_COLORS: Record<string, { fill: string; line: string }> = {
  walk:    { fill: '#22c55e', line: '#16a34a' },
  drive:   { fill: '#f97316', line: '#ea580c' },
  bike:    { fill: '#3b82f6', line: '#2563eb' },
  network: { fill: '#6366f1', line: '#4f46e5' },
};

export const ISOCHRONE_MODE_LABELS: Record<string, string> = {
  walk:  'À pied',
  drive: 'Voiture',
  bike:  'Vélo',
};

// ---------------------------------------------------------------------------
// Voronoï
// ---------------------------------------------------------------------------

export const VORONOI_PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
  '#86bcb6','#d4a6c8','#8cd17d','#499894','#f1ce63',
  '#d37295','#fabfd2','#b6992d','#79706e','#7a9cc0',
];

// ---------------------------------------------------------------------------
// Bataille d'Isochrones
// ---------------------------------------------------------------------------

export const BATTLE_PALIER_OPACITY: Record<number, number> = {
  0:   0.20,  // outer fill
  10:  0.65,
  20:  0.58,
  30:  0.50,
  40:  0.44,
  50:  0.38,
  60:  0.30,
  70:  0.24,
  80:  0.20,
  90:  0.16,
  120: 0.12,
  150: 0.08,
};

// ---------------------------------------------------------------------------
// TMJA — comptages routiers (useMapInit.ts:391-430, littéraux de `paint` NOMMÉS)
// ---------------------------------------------------------------------------

/**
 * Paliers de couleur du trafic, du plus faible au plus fort : l'expression MapLibre est
 * `['step', ['get', 'tmja'], paliers[0].couleur, paliers[1].seuil, paliers[1].couleur, …]`.
 * Le premier palier n'a pas de seuil (`null`) : c'est la valeur par défaut du `step`.
 */
export const PALIERS_TMJA: ReadonlyArray<{ seuil: number | null; couleur: string; libelle: string }> = [
  { seuil: null,  couleur: '#4292C6', libelle: '< 5 000' },        // bleu
  { seuil: 5000,  couleur: '#f6d543', libelle: '5 000–15 000' },  // jaune
  { seuil: 15000, couleur: '#f97316', libelle: '15 000–40 000' }, // orange
  { seuil: 40000, couleur: '#ef4444', libelle: '> 40 000' },      // rouge
];

/** Largeur du trait par zoom : paires `[zoom, largeur]` d'un `interpolate` linéaire. */
export const LARGEUR_TMJA_PAR_ZOOM: ReadonlyArray<readonly [number, number]> = [
  [5, 0.6], [7, 1.2], [9, 2], [11, 3.2], [14, 5],
];

/** Opacité du trait par zoom : paires `[zoom, opacité]` d'un `interpolate` linéaire. */
export const OPACITE_TMJA_PAR_ZOOM: ReadonlyArray<readonly [number, number]> = [
  [5, 0.95], [9, 0.9], [12, 0.8],
];

/** Source des tuiles du flux routier : zooms et version de cache (`?v=`, à bumper avec `get_tmja_tile`). */
export const SOURCE_TMJA = { minzoom: 5, maxzoom: 14, version: 'v10' } as const;

// ---------------------------------------------------------------------------
// Radio — émetteurs (useMapInit.ts:432-530, littéraux de `paint` NOMMÉS)
// ---------------------------------------------------------------------------

export const TEINTES_RADIO = {
  /** Couleur du point selon la portée de l'émetteur (`match` sur `portee`). */
  portee: { nationale: '#3b82f6', locale: '#22c55e', autoroute: '#eab308' } as Record<string, string>,
  /** Portée inconnue (valeur par défaut du `match`). */
  porteeInconnue: '#6b7280',
  /** Rayon des grappes : `step` sur `point_count` — [défaut, [seuil, rayon]…]. */
  rayonGrappes: { defaut: 14, paliers: [[10, 18], [50, 24], [200, 32]] as ReadonlyArray<readonly [number, number]> },
  /** Rayon du point selon la puissance en W : paires `[puissance, rayon]` d'un `interpolate` linéaire. */
  rayonPoint: [[1, 3], [100, 5], [10000, 7], [100000, 10]] as ReadonlyArray<readonly [number, number]>,
  /** Épaisseur du cerne : DAB+ plus épais (`match` sur `systeme`). */
  cernePoint: { 'DAB+': 1.5, defaut: 0.5 } as Record<string, number>,
  /** Poids de la carte de chaleur par puissance : paires `[puissance, poids]`. */
  poidsChaleur: [[0, 0.1], [1000, 0.5], [100000, 1]] as ReadonlyArray<readonly [number, number]>,
  /** Valeurs de la carte de chaleur : paires `[densité, opacité du teal]`, la dernière stop est blanche. */
  densiteChaleur: [[0, 0], [0.15, 0.15], [0.35, 0.35], [0.6, 0.6], [0.85, 0.85]] as ReadonlyArray<readonly [number, number]>,
  /** Opacité des couvertures. */
  couverture: { fill: 0.06, ligneLargeur: 0.5, ligneOpacite: 0.25 },
  /** Grappes (source GeoJSON groupée). */
  groupement: { clusterMaxZoom: 14, clusterRadius: 50 },
  /** Jetons d'INTERFACE (noms sans `--`, lus par `CouleursService`) : React les écrivait #4ecdc4 / #050505 / #f0f0f0 en dur. */
  jetonGrappes: 'brand-teal',
  jetonTexteGrappes: 'brand-teal-fg',
  jetonCernes: 'bg-level-0',
  jetonChaleurMax: 'text-primary',
} as const;

// ---------------------------------------------------------------------------
// Indicateurs civiques — échelle de l'abstention (CivicIndicatorsLayer.tsx:38-60)
// ---------------------------------------------------------------------------

export type CodeVariableCivique = 'abstention_pres_2022';

export interface MetaVariableCivique {
  label: string;
  unit: string;
  /** Stops [valeur, couleur] de l'`interpolate` MapLibre — vert (forte participation) → rouge (forte abstention). */
  stops: Array<[number, string]>;
  qualifier: (v: number) => string;
}

export const VARIABLES_CIVIQUES: Record<CodeVariableCivique, MetaVariableCivique> = {
  abstention_pres_2022: {
    label: 'Taux d\'abstention 2022',
    unit: '%',
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

// ---------------------------------------------------------------------------
// Santé environnementale (CivicHealthMapLayer.tsx:98-106)
// ---------------------------------------------------------------------------

/**
 * Jetons des six niveaux (1 à 6) et du niveau 0 (indisponible) de chaque jeu : ILS VARIENT selon le
 * thème (`--pollen-level-*`, `--atmo-level-*`), donc des NOMS de jeton, jamais des hexadécimaux.
 * React les lisait par `getComputedStyle(documentElement)` avec un repli `#555555` ; Angular passe
 * par `CouleursService` (repli : le jeton inconnu LÈVE).
 */
export const JETONS_NIVEAUX_SANTE: Record<'pollen' | 'atmo', Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>> = {
  pollen: {
    0: 'pollen-level-0', 1: 'pollen-level-1', 2: 'pollen-level-2', 3: 'pollen-level-3',
    4: 'pollen-level-4', 5: 'pollen-level-5', 6: 'pollen-level-6',
  },
  atmo: {
    0: 'atmo-level-na', 1: 'atmo-level-1', 2: 'atmo-level-2', 3: 'atmo-level-3',
    4: 'atmo-level-4', 5: 'atmo-level-5', 6: 'atmo-level-6',
  },
};

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
// IRIS — palettes de la choroplèthe (`app/copilote/_hooks/useMapLayers.ts:93-101`, verbatim, T7)
// Défaut React listé, NON corrigé (parité) : la palette `violet` (et `plasma`) porte des teintes violettes.
// ---------------------------------------------------------------------------

export const IRIS_PALETTES = [
  { id: 'bleu',    label: 'Bleu',    stops: ['#F7FBFF','#C6DBEF','#9ECAE1','#4292C6','#2171B5','#08306B'] },
  { id: 'violet',  label: 'Violet',  stops: ['#F2F0F7','#DADAEB','#BCBDDC','#9E9AC8','#756BB1','#54278F'] },
  { id: 'vert',    label: 'Vert',    stops: ['#F7FCF5','#C7E9C0','#74C476','#41AB5D','#238B45','#00441B'] },
  { id: 'chaleur', label: 'Chaleur', stops: ['#FAEEDA','#FAC775','#EF9F27','#D85A30','#993C1D','#501313'] },
  { id: 'rouge',   label: 'Rouge',   stops: ['#FFF5F0','#FEE0D2','#FCBBA1','#FC9272','#DE2D26','#A50F15'] },
  { id: 'turbo',   label: 'Turbo',   stops: ['#30123b','#4675ed','#1bcfd4','#61fc6c','#f6a91b','#c42503'] },
  { id: 'plasma',  label: 'Plasma',  stops: ['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#f0f921'] },
];

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
  /** Valeurs de la carte de chaleur : paires `[densité, opacité du teal]`, la dernière stop est `coeurChaleur`. */
  densiteChaleur: [[0, 0], [0.15, 0.15], [0.35, 0.35], [0.6, 0.6], [0.85, 0.85]] as ReadonlyArray<readonly [number, number]>,
  /**
   * Le cœur de la carte de chaleur (densité 1) : `#f0f0f0` dans les DEUX thèmes, comme React — une teinte de DONNÉES
   * (B12), pas `--text-primary`, qui le rendrait presque noir en thème clair (ruling T2 → T9).
   */
  coeurChaleur: '#f0f0f0',
  /** Intensité, rayon et opacité de la carte de chaleur par zoom : paires `[zoom, valeur]` (`useMapInit.ts:492-503`). */
  intensiteChaleur: [[0, 0.5], [9, 2]] as ReadonlyArray<readonly [number, number]>,
  rayonChaleur: [[0, 4], [6, 15], [10, 25]] as ReadonlyArray<readonly [number, number]>,
  opaciteChaleur: [[11, 1], [14, 0]] as ReadonlyArray<readonly [number, number]>,
  /** La carte de chaleur s'efface au-delà de ce zoom (`maxzoom`). */
  zoomMaxChaleur: 14,
  /** Opacité des couvertures. */
  couverture: { fill: 0.06, ligneLargeur: 0.5, ligneOpacite: 0.25 },
  /** Grappes : opacité, épaisseur du cerne, taille du compte et sa police (`useMapInit.ts:437-454`). */
  grappes: { opacite: 0.85, cerne: 1, tailleTexte: 11, police: 'Open Sans Bold' },
  /** Points : opacité hors sélection, et quand une radio est choisie (la sienne, les autres) (`useRadioLayer.ts:180-195`). */
  opacitePoints: { normale: 0.9, choisie: 1, autres: 0.35 },
  /** Les émetteurs des AUTRES radios quand une radio est choisie (`useRadioLayer.ts:180`) — gris de données. */
  pointNonChoisi: '#4b5563',
  /** Grappes (source GeoJSON groupée). */
  groupement: { clusterMaxZoom: 14, clusterRadius: 50 },
  /**
   * Jetons d'INTERFACE (noms sans `--`, lus par `CouleursService`) : React les écrivait #4ecdc4 / #050505 en dur.
   * Le sombre `#050505` (cernes, texte des grappes) est INVARIANT chez React : il prend donc `--brand-teal-fg`,
   * invariant lui aussi, et non `--bg-level-0`, qui passerait au blanc en thème clair (ruling T2 → T9).
   */
  jetonGrappes: 'brand-teal',
  jetonTexteGrappes: 'brand-teal-fg',
  jetonCernes: 'brand-teal-fg',
  /** La radio choisie : React écrivait `'var(--brand-teal)'` dans `paint`, que MapLibre REFUSAIT (défaut corrigé, T9). */
  jetonChoisie: 'brand-teal',
} as const;

/**
 * Les couleurs proposées pour la couverture radio (`RADIO_COVERAGE_COLORS`, `RadioSection.tsx:39`). La couleur choisie
 * est une DONNÉE de l'utilisateur (B12), passée telle quelle à MapLibre : des hexadécimaux, jamais `var()`. React posait
 * `'var(--brand-teal)'` en première pastille — MapLibre refusait la couleur, la pastille ne paraissait jamais choisie et
 * le sélecteur natif ne savait pas l'afficher : elle devient la valeur du teal, `#4ecdc4` (défaut corrigé, T9).
 * Défaut React listé, NON corrigé (parité) : la dernière pastille `#8b5cf6` est violette.
 */
export const COULEURS_COUVERTURE_RADIO: readonly string[] = ['#4ecdc4', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
/** La couleur de couverture au départ (`useRadioLayer.ts:49`). */
export const COULEUR_COUVERTURE_DEFAUT = '#4ecdc4';

/**
 * La légende du flux routier (`TMJA_LEGEND`, `TmjaSection.tsx:20-25`) : libellés de React, mais les COULEURS de la carte
 * (`PALIERS_TMJA`) — React affichait `#e5a00d` pour le palier 15 000–40 000 que la carte peint `#f97316` : la légende
 * contredisait la carte (défaut corrigé, T9). `faible` : le palier que « Masquer le trafic faible » estompe.
 */
export const LEGENDE_TMJA: ReadonlyArray<{ couleur: string; libelle: string; faible: boolean }> = [
  { couleur: PALIERS_TMJA[0].couleur, libelle: '< 5 000 véh/j', faible: true },
  { couleur: PALIERS_TMJA[1].couleur, libelle: '5 000 – 15 000 véh/j', faible: false },
  { couleur: PALIERS_TMJA[2].couleur, libelle: '15 000 – 40 000 véh/j', faible: false },
  { couleur: PALIERS_TMJA[3].couleur, libelle: '> 40 000 véh/j', faible: false },
];

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

/**
 * Paliers du dégradé de la légende : `[couleur, poids relatif]` (`ABSTENTION_LEGEND`, `CivicIndicatorsSection.tsx:22-29`,
 * verbatim) — les mêmes six teintes que la carte, chacune large de l'écart de valeurs qu'elle couvre.
 */
export const ABSTENTION_LEGEND: [string, number][] = [
  ['#16a34a', 0.5],
  ['#84cc16', 1],
  ['#eab308', 1],
  ['#f97316', 1],
  ['#dc2626', 1.2],
  ['#7f1d1d', 0.8],
];

/** Les trois repères sous le dégradé (`ABSTENTION_LEGEND_REPERES`, `CivicIndicatorsSection.tsx:32-34`). */
export const ABSTENTION_LEGEND_REPERES: readonly [string, string, string] = [
  '10% (forte particip.)', '30%', '60% (forte abst.)',
];

/**
 * Le contour des codes postaux (`CivicIndicatorsLayer.tsx:243-247`), large de 0,3 px et à 40 %. `couleur` est le
 * `#ffffff` de React, gardé pour le test de parité : Angular peint le jeton `jeton` (`--contour-civique`, blanc en
 * sombre, `#1a1a1a` en clair) — le blanc de React était quasi invisible sur fond clair (défaut corrigé, revue 1).
 */
export const TRAIT_CIVIQUE = { couleur: '#ffffff', jeton: 'contour-civique', largeur: 0.3, opacite: 0.4 } as const;
/** Opacité de l'aplat (`opacity = 0.65`, `CivicIndicatorsLayer.tsx:171`). */
export const OPACITE_CIVIQUE = 0.65;
/** Valeur peinte quand `value` manque (`['coalesce', …, 25]`, `CivicIndicatorsLayer.tsx:226`). */
export const VALEUR_CIVIQUE_PAR_DEFAUT = 25;

// ---------------------------------------------------------------------------
// Santé environnementale (CivicHealthMapLayer.tsx:98-106)
// ---------------------------------------------------------------------------

/** Opacité de l'aplat (`opacity = 0.55`) et trait des zones (`CivicHealthMapLayer.tsx:150,249`). */
export const OPACITE_SANTE = 0.55;
export const TRAIT_SANTE = { largeur: 0.4, opacite: 0.5 } as const;
/** Sous le seuil ou sans donnée : transparent (valeur par défaut du `match`, `CivicHealthMapLayer.tsx:240`). */
export const SANTE_TRANSPARENT = 'rgba(0,0,0,0)';

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

// ---------------------------------------------------------------------------
// Météo (T11) — `app/copilote/_hooks/useMapInit.ts:368-383`
// ---------------------------------------------------------------------------

/**
 * Opacité de l'aplat (`'fill-opacity': 0.55`) et trait des zones (`'line-color': 'rgba(0,0,0,0.45)'`,
 * `'line-width': 0.8`) de `meteo-fill` / `meteo-outline`. Le trait est un NOIR translucide dans les deux
 * thèmes chez React : gardé (B12), il cerne des teintes de DONNÉES qui ne basculent pas non plus. Les teintes
 * de l'aplat sont `METEO_PALETTES` (`logique/meteo/palettes.ts`, B12) ; le `#4ecdc4` de React n'était qu'une
 * valeur de départ « overridée dynamiquement » — la couche Angular naît avec l'expression de la variable.
 */
export const OPACITE_METEO = 0.55;
export const TRAIT_METEO = { couleur: 'rgba(0,0,0,0.45)', largeur: 0.8 } as const;

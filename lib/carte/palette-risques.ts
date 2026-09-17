/**
 * @file lib/carte/palette-risques.ts
 *
 * Palette CATÉGORIELLE des types de risque industriel (ICPE Géorisques).
 *
 * ── Pourquoi QUATRE types, et pas les seize familles de rubriques ──────────
 *
 * Parce que c'est mesuré, pas choisi au goût. Le validateur de palette
 * (skill dataviz, `scripts/validate_palette.js`, mode `--pairs all` — celui
 * qui s'applique à une carte, où n'importe quelles deux couleurs peuvent se
 * toucher) rend un verdict net sur ce jeu de teintes :
 *
 *   7 couleurs → ÉCHEC : orange↔rouge ΔE 7,1 en VISION NORMALE (plancher 15).
 *                Même sans daltonisme, personne ne distingue ces deux points.
 *   6 couleurs → ÉCHEC : magenta↔rouge 7,8.
 *   5 couleurs → le thème clair passe tout, le sombre échoue sur vert↔aqua 11,9.
 *   4 couleurs → TOUT PASSE dans les DEUX thèmes, CVD comprise.
 *
 * Les seize familles de rubriques restent visibles là où elles sont utiles :
 * dans le FILTRE (choix multiple) et dans la popup d'un site. C'est la COULEUR
 * qui est bornée à quatre, parce qu'au-delà elle mentirait — deux points de
 * teintes « différentes » qu'un œil ne sépare pas valent moins qu'une couleur
 * de moins et une légende juste.
 *
 * ── Deux consommateurs, deux formats (même patron que palette-divergente) ──
 *
 *  - le DOM (légende, pastilles du panneau) lit les jetons `--risque-*` de
 *    globals.css : la bascule de thème se fait par la cascade CSS, sans
 *    `useTheme()` ;
 *  - MapLibre ne résout PAS `var()` dans `paint` et doit recevoir des hex
 *    littéraux, indexés par thème — d'où la duplication, verrouillée par
 *    `tests/unit/carte/palette-risques.test.ts`.
 */

/** Les quatre types de risque colorés, plus l'absence d'information. */
export type TypeRisque = 'toxique' | 'inflammable' | 'pollution' | 'autres' | 'non_precise';

/**
 * Préfixe de rubrique ICPE → type de risque coloré.
 *
 * Le regroupement suit la NATURE PHYSIQUE du danger, pas la nomenclature :
 * un explosif et un dépôt de GPL posent le même problème à un riverain comme
 * à un afficheur (incendie, souffle, périmètre d'évacuation), et les séparer
 * par une couleur n'apporterait rien qu'on puisse lire sur une carte.
 */
export const TYPE_PAR_PREFIXE: Record<string, TypeRisque> = {
  '41': 'toxique',      // toxicité aiguë
  '42': 'inflammable',  // explosibles
  '43': 'inflammable',  // gaz et liquides inflammables
  '47': 'inflammable',  // GPL et produits pétroliers
  '14': 'inflammable',  // inflammables, ancienne nomenclature
  '27': 'pollution',    // déchets
  '35': 'pollution',    // déchets (IED)
  '45': 'pollution',    // dangereux pour le milieu aquatique
  '11': 'autres',       // fluides frigorigènes
  '15': 'autres',       // entrepôts et stockages
  '22': 'autres',       // agroalimentaire et divers
  '25': 'autres',       // matériaux et minéraux
  '26': 'autres',       // plastiques et caoutchouc
  '29': 'autres',       // combustion et refroidissement
  '34': 'autres',       // chimie (IED)
};

export const LIBELLE_TYPE: Record<TypeRisque, string> = {
  toxique: 'Toxique',
  inflammable: 'Inflammable, pétrolier, explosif',
  pollution: 'Déchets et pollution',
  autres: 'Autres activités industrielles',
  non_precise: 'Risque non précisé',
};

/** Ordre d'affichage de la légende : du plus grave au moins, puis l'absence. */
export const ORDRE_TYPES: TypeRisque[] = [
  'toxique',
  'inflammable',
  'pollution',
  'autres',
  'non_precise',
];

/**
 * Hex littéraux pour MapLibre, par thème.
 *
 * Validés par `scripts/validate_palette.js --pairs all` :
 *   clair  (surface #ffffff) : TOUT PASSE — pire paire vision normale
 *                              jaune↔rouge ΔE 20,8
 *   sombre (surface #0a0a0a) : TOUT PASSE — les paliers sombres ne sont PAS
 *                              un éclaircissement automatique des clairs, ils
 *                              ont été re-choisis pour la bande sombre
 *                              (L 0,48-0,67, contraste ≥ 3:1) ; `#e34948`
 *                              devient `#e66767` et `#eda100` devient
 *                              `#b88a00`, faute de quoi jaune↔rouge retombe à
 *                              13,0 sur fond sombre.
 *
 * `non_precise` reprend `--donnee-absente`, le gris NEUTRE des valeurs
 * absentes du projet : 68 % des sites n'ont aucune rubrique exploitable, et
 * leur donner une teinte de la palette ferait lire un type de risque là où il
 * n'y a pas d'information.
 */
export const COULEURS_MAPLIBRE: Record<'dark' | 'light', Record<TypeRisque, string>> = {
  light: {
    toxique: '#e34948',
    inflammable: '#eda100',
    pollution: '#008300',
    autres: '#2a78d6',
    non_precise: '#9aa0a6',
  },
  dark: {
    toxique: '#e66767',
    inflammable: '#b88a00',
    pollution: '#008300',
    autres: '#3987e5',
    non_precise: '#9aa0a6',
  },
};

/** Miroir CSS, pour la légende et les pastilles du panneau. */
export const COULEURS_CSS: Record<TypeRisque, string> = {
  toxique: 'var(--risque-toxique)',
  inflammable: 'var(--risque-inflammable)',
  pollution: 'var(--risque-pollution)',
  autres: 'var(--risque-autres)',
  non_precise: 'var(--donnee-absente)',
};

/**
 * Type de risque d'un site, déduit de ses rubriques.
 *
 * Prend la liste des natures déjà calculées à l'import
 * (`metadata.natures_risque`, produite par
 * `lib/import/georisques/classement.ts`) — jamais les numéros de rubrique
 * bruts, qui ne sont pas renvoyés à la carte.
 */
export function typeRisqueDepuisPrefixes(prefixes: string[] | null | undefined): TypeRisque {
  for (const type of ORDRE_TYPES) {
    if (type === 'non_precise') continue;
    for (const p of prefixes ?? []) {
      if (TYPE_PAR_PREFIXE[p] === type) return type;
    }
  }
  return 'non_precise';
}

/**
 * Libellé de nature (tel qu'il est stocké dans `metadata.libelle_nature`) →
 * type de risque coloré.
 *
 * Pourquoi passer par le libellé et non par le numéro de rubrique : c'est le
 * libellé que la base porte en clair et que le filtre carte interroge déjà
 * (`.in('metadata->>libelle_nature', …)` dans /api/map/pois). Dériver la
 * COULEUR de la même clé que le FILTRE est ce qui garantit qu'un point filtré
 * « toxique » se peint en toxique — deux clés différentes finiraient par se
 * contredire sur un cas limite.
 */
export function typeRisqueDepuisLibelle(
  libelle: string | null | undefined,
  familles: Array<{ prefixe: string; libelle: string }>,
): TypeRisque {
  const l = (libelle ?? '').trim();
  if (!l) return 'non_precise';
  const famille = familles.find((f) => f.libelle === l);
  if (!famille) return 'non_precise';
  return TYPE_PAR_PREFIXE[famille.prefixe] ?? 'non_precise';
}

/**
 * Libellés de nature appartenant à un type de risque — ce que le serveur passe
 * au `.in()` quand l'utilisateur filtre sur un type.
 */
export function librellesDuType(
  type: TypeRisque,
  familles: Array<{ prefixe: string; libelle: string }>,
): string[] {
  return familles.filter((f) => TYPE_PAR_PREFIXE[f.prefixe] === type).map((f) => f.libelle);
}

/** Couleur d'un type, pour le DOM qui a besoin d'un hex (popup MapLibre). */
export function couleurDuType(type: TypeRisque, theme: 'dark' | 'light'): string {
  return COULEURS_MAPLIBRE[theme][type] ?? COULEURS_MAPLIBRE[theme].non_precise;
}

/**
 * Expression MapLibre `match` qui colore une couche d'après la propriété
 * `type_risque` d'une feature. Écrite ici et nulle part ailleurs : le point et
 * son halo doivent porter EXACTEMENT la même couleur, et deux expressions
 * recopiées divergent au premier ajout de type.
 */
export function expressionCouleurRisque(theme: 'dark' | 'light'): unknown[] {
  const c = COULEURS_MAPLIBRE[theme];
  return [
    'match',
    ['get', 'type_risque'],
    'toxique', c.toxique,
    'inflammable', c.inflammable,
    'pollution', c.pollution,
    'autres', c.autres,
    c.non_precise, // valeur par défaut, y compris pour `non_precise`
  ];
}

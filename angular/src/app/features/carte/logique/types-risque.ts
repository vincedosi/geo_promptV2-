/**
 * Copie Angular (lot 4, P6) de `lib/carte/palette-risques.ts:1-223`, verrouillee par
 * tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 *
 * Corps VERBATIM pour la LOGIQUE (types, prefixes, libelles, ordre, classement). Les COULEURS
 * ne sont pas recopiees : React les portait en hexadecimal par theme (`COULEURS_MAPLIBRE`,
 * `COULEURS_CSS`, `couleurDuType`, `expressionCouleurRisque`, `CONTOUR_POINT`) ; Angular les
 * lit dans les jetons CSS par `CouleursService` (jamais `var()` dans un `paint` MapLibre, jamais
 * un hexadecimal recopie). `JETON_TYPE` donne le NOM du jeton de chaque type, sans `--`.
 * `--contour-point` (jeton) remplace `CONTOUR_POINT`.
 *
 * Ne pas corriger un defaut ici sans le corriger dans React. Defaut connu, GARDE pour la
 * parite : `librellesDuType` porte une faute de frappe (`librelles`) dans son nom.
 *
 * @file Palette CATEGORIELLE des types de risque industriel (ICPE Georisques).
 *
 * ── Pourquoi QUATRE types, et pas les seize familles de rubriques ──────────
 *
 * Parce que c'est mesure, pas choisi au gout. Le validateur de palette (skill
 * dataviz, mode `--pairs all`) rend un verdict net : a 7 couleurs, orange et
 * rouge ne se distinguent pas (delta E 7,1 pour un plancher de 15) ; a 4
 * couleurs, tout passe dans les DEUX themes, CVD comprise.
 *
 * Les seize familles de rubriques restent visibles la ou elles sont utiles :
 * dans le FILTRE (choix multiple) et dans la popup d'un site. C'est la COULEUR
 * qui est bornee a quatre, parce qu'au-dela elle mentirait.
 */

/** Les quatre types de risque colores, plus l'absence d'information. */
export type TypeRisque = 'toxique' | 'inflammable' | 'pollution' | 'autres' | 'non_precise';

/**
 * Prefixe de rubrique ICPE → type de risque colore.
 *
 * Le regroupement suit la NATURE PHYSIQUE du danger, pas la nomenclature :
 * un explosif et un depot de GPL posent le meme probleme a un riverain comme
 * a un afficheur (incendie, souffle, perimetre d'evacuation), et les separer
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
 * Nom du jeton CSS (sans `--`) de chaque type, lu par `CouleursService.palette()`.
 * Ecart de FORME avec React (qui portait des hexadecimaux par theme) : meme couleur, lue
 * dans `styles/jetons.css`. `non_precise` reprend `--donnee-absente`, le gris NEUTRE des
 * valeurs absentes du projet : 68 % des sites n'ont aucune rubrique exploitable, et leur
 * donner une teinte de la palette ferait lire un type de risque la ou il n'y a pas
 * d'information.
 */
export const JETON_TYPE: Record<TypeRisque, string> = {
  toxique: 'risque-toxique',
  inflammable: 'risque-inflammable',
  pollution: 'risque-pollution',
  autres: 'risque-autres',
  non_precise: 'donnee-absente',
};

/**
 * Type de risque d'un site, deduit de ses rubriques.
 *
 * Prend la liste des natures deja calculees a l'import
 * (`metadata.natures_risque`, produite par
 * `lib/import/georisques/classement.ts`) — jamais les numeros de rubrique
 * bruts, qui ne sont pas renvoyes a la carte.
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
 * Libelle de nature (tel qu'il est stocke dans `metadata.libelle_nature`) →
 * type de risque colore.
 *
 * Pourquoi passer par le libelle et non par le numero de rubrique : c'est le
 * libelle que la base porte en clair et que le filtre carte interroge deja
 * (`.in('metadata->>libelle_nature', …)` dans /api/map/pois). Deriver la
 * COULEUR de la meme cle que le FILTRE est ce qui garantit qu'un point filtre
 * « toxique » se peint en toxique — deux cles differentes finiraient par se
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
 * Libelles de nature appartenant a un type de risque — ce que le serveur passe
 * au `.in()` quand l'utilisateur filtre sur un type.
 */
export function librellesDuType(
  type: TypeRisque,
  familles: Array<{ prefixe: string; libelle: string }>,
): string[] {
  return familles.filter((f) => TYPE_PAR_PREFIXE[f.prefixe] === type).map((f) => f.libelle);
}

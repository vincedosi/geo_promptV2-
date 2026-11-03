/**
 * @file lib/zones/recette.ts — la recette d'une zone (spec carte-en-parcours § 16.3, décisions du 14/10).
 *
 * À l'étape ③, toute sélection devient UNE zone (`custom_geo_zones`) qui garde la recette qui l'a produite, pour être
 * recalculée. La recette est stockée telle quelle dans `custom_geo_zones.recette` (migration `*_zones_a_recette.sql`,
 * CHECK sur `v` et `type`). Une recette « figée » (dessin, import, isochrone, capture) garde sa trace mais n'est pas
 * rejouée (arbitrage A-3). Validée côté serveur par `lib/zones/recette-schema.ts` (Zod).
 *
 * Copie Angular : angular/src/app/features/carte/logique/zones/recette.ts, identique hors de cet en-tête (parité
 * verrouillée par tests/unit/angular/recette-paritaire.test.ts).
 */
import { formaterNombre } from '@/lib/format/nombre';

export const VERSION_RECETTE = 1;

export const TYPES_RECETTE = [
  'rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
  'dessin', 'import', 'isochrone', 'combinaison', 'capture', 'pays',
] as const;
export type TypeRecette = (typeof TYPES_RECETTE)[number];

/**
 * Rejouées par l'exécuteur serveur pour RECALCULER une zone. Pas la combinaison (arbitrage de la revue finale du
 * lot 3) : ses opérandes sont figés au moment de la création, la rejouer rendrait la même forme.
 */
export const TYPES_RECALCULABLES: readonly TypeRecette[] = ['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux'];
/** La forme vient du client (validée, réparée, découpée sur la France) ; toutes les autres sont calculées par le serveur. */
const TYPES_GEOMETRIE_CLIENTE: readonly TypeRecette[] = ['dessin', 'import', 'isochrone', 'capture'];
/** Coûteuses : bornées par le périmètre de ①, refusent la France entière (spec § 16.2-5). */
export const TYPES_BORNES_PAR_PERIMETRE: readonly TypeRecette[] = ['rayon_poi', 'seuil_carreaux', 'seuil_territoire'];

export const TYPES_PERIMETRE = ['region', 'departement', 'commune', 'cp', 'zone', 'france'] as const;
export type TypePerimetre = (typeof TYPES_PERIMETRE)[number];
export interface PerimetreRecette {
  readonly type: TypePerimetre;
  /** Code INSEE, code postal, UUID de zone ; `FR` pour la France entière, `METRO` pour la France métropolitaine. */
  readonly code: string;
}
/** Les seuls codes d'un périmètre `france` (schéma serveur ; `zone_rayon_poi` reconnaît `METRO`, sql/285). */
export const CODES_FRANCE = ['FR', 'METRO'] as const;
/**
 * Les codes d'une zone PAYS (④ finitions, T2, A-3) : `{ v: 1, type: 'pays', code }`, FIGÉE, forme = union des régions
 * (`zone_pays_geometrie`, sql/296), chiffrée par les dénominateurs nationaux sans lire un carreau. Une zone pays se
 * reconnaît à sa RECETTE, jamais à sa surface.
 */
export const CODES_PAYS = ['METRO', 'FR'] as const;
type CodePays = (typeof CODES_PAYS)[number];

/*
 * Les plafonds sont ceux des RPC de recette : un dépassement est un REFUS dit à l'utilisateur, jamais une troncature.
 */
export const RAYON_POI_MIN_M = 100;
export const RAYON_POI_MAX_M = 50_000;
/** Rayon autour d'un point posé à la main : jusqu'à 100 km (le rayon de ③, un seul cercle, sans lecture de table). */
export const RAYON_POINT_MAX_M = 100_000;
/**
 * B8 (ARB-5, Vincent, 31/10) : le rayon MINIMAL d'une nouvelle recette « rayon autour d'un point » — 250 m. Sous ce
 * rayon, le disque est plus petit qu'un carreau Filosofi (200 m de côté) : sa population ne veut plus rien dire, et
 * aucune plateforme ne l'achète exactement (DV360 et Meta : 1 km au moins). Une recette déjà enregistrée sous ce
 * rayon (100 m le permettaient) n'est PAS modifiée : le schéma la relit encore (`RAYON_POI_MIN_M`), sql/314 l'a
 * comptée et marquée, son libellé le dit et son recalcul est refusé (`rayon_sous_minimum`) — on la recrée.
 * Décision du 02/11 : c'est aussi le minimum d'ACTIVATION de tout rayon, point ou POI (`rayonNonActivable`).
 */
export const RAYON_POINT_MIN_M = 250;
/**
 * Borne du seuil sur carreaux : la plus grande valeur qu'un indicateur de la liste puisse prendre est la densité
 * (individus / 0,04 km²), qui reste sous 100 000 hab./km² ; une part est sous 100 %.
 */
export const SEUIL_CARREAUX_MAX = 100_000;
/**
 * Borne (en valeur absolue) du seuil sur territoires. Les indicateurs IRIS / CP sont des parts, des taux, des
 * revenus en euros ou des effectifs : aucun ne dépasse dix millions. Une borne écrite plutôt que « n'importe quel
 * nombre fini » : un seuil de 1e300 n'est jamais une intention, c'est une faute de frappe.
 */
export const SEUIL_TERRITOIRE_MAX_ABS = 10_000_000;
/**
 * « Autour des POI », sur tout périmètre (local comme France métropolitaine) : capacité SYNCHRONE mesurée, pas une
 * borne produit (Vincent, 26/10, Q-1 ; relecture 1, I-4 : une seule constante, elle remplace les 5 000 POI du local).
 * Le coût suit le nombre de points, quel que soit le périmètre (union des cercles + découpe). Mesures du 26/10, base
 * locale, union + découpe + GeoJSON : lycées de métropole (5 324 POI, la plus grosse catégorie commune) 0,4 s à 20 km
 * et 2,2 s / 3,7 Mo à 100 m ; 10 000 sites ICPE 9,8 s / 7,7 Mo à 100 m ; 97 133 sites ICPE 47 s / 70 Mo à 100 m.
 * Refaite en base (sql/285) ; au-delà, le calcul se fera en tâche de fond (lot « calculs longs »).
 */
export const CAPACITE_SYNCHRONE_POI_RAYON = 10_000;
export const MAX_CARREAUX_SEUIL = 20_000;
/**
 * Seuil sur carreaux : le minimum de ménages d'un carreau retenu (V-2, Q-2 tranchée le 29/10). Sous 11 ménages,
 * l'INSEE IMPUTE les valeurs du carreau (secret statistique) : un carreau de 0,4 ménage passait « 100 % de ménages
 * pauvres ». Valeur proposée par l'écran à une NOUVELLE recette. Toute recette enregistrée PORTE sa valeur (A5,
 * sql/310) : les recettes d'avant sql/292 ont reçu `min_menages = 0` explicitement, la base l'exige (CHECK) et le
 * schéma aussi — aucun défaut implicite. Borne haute refaite en base (`zone_seuil_carreaux_min`, sql/292).
 * Le minimum de la CONVERSION (⑤, ARB-4) n'est pas celui-ci : réglage `min_menages_cible` de `reglages_conversion`.
 */
export const MIN_MENAGES_CARREAUX_DEFAUT = 11;
export const MIN_MENAGES_CARREAUX_MAX = 1_000;
/** Le plafond d'indicateurs du score composite (`MAX_INDICATEURS` de `/api/custom-geo/source/score`), repris par sa recette. */
export const MAX_INDICATEURS_SCORE = 6;
/** D30 round 1 (sql/335) : 7 000 unités, IRIS de quartier et communes entières (région 44 : 6 113). */
export const MAX_TERRITOIRES_SEUIL = 7_000;
/**
 * D30 (sql/333) — à l'IRIS, chaque commune non découpée (IRIS communal Z, code 0000 ; 33 044, 27 316 564 hab. au 03/11)
 * est UNE unité « commune entière » ; une unité sans valeur est « non évaluable » : jamais retenue, jamais comptée à 0.
 */
export const UNITE_COMMUNE_ENTIERE = { type_iris: 'Z', suffixe_code: '0000' } as const;
/** D30 — les deux mentions de l'aperçu d'un seuil sur territoires à l'IRIS ; `null` à 0. */
export function mentionCommunesEntieres(n: number): string | null {
  return n > 0 ? `${formaterNombre(n)} ${n > 1 ? 'communes entières traitées chacune' : 'commune entière traitée'} comme un seul IRIS` : null;
}
export function mentionNonEvaluables(n: number): string | null {
  return n > 0 ? `${formaterNombre(n)} ${n > 1 ? 'unités non évaluables (valeur absente), jamais retenues' : 'unité non évaluable (valeur absente), jamais retenue'}` : null;
}
export const MAX_SOMMETS_FORME = 20_000;
export const MAX_CODES_POSTAUX = 3_000;
/** Zones d'une combinaison (union, intersection, différence) : 2 à 20 (schéma, `zone_intersection_toutes`, sql/325). */
export const MAX_ZONES_COMBINAISON = 20;
/** Ne refuse en pratique que la France entière (la plus grande région : 84 617 km²). */
export const SURFACE_MAX_PERIMETRE_KM2 = 100_000;
/** Seuil sur carreaux : une zone-périmètre au plus grande qu'un département (Gironde : 10 000 km²). */
export const SURFACE_MAX_PERIMETRE_CARREAUX_KM2 = 12_000;

/**
 * Les types de périmètre qu'admet chaque recette bornée. Le seuil sur carreaux s'arrête au DÉPARTEMENT : il lit le
 * jsonb de chaque carreau du périmètre, 433 000 buffers sur une région contre 69 000 sur la Gironde (mesure du
 * 14/10, spec § 16.6 ; l'ouverture à la région est la question Q-G de Vincent). La même liste est écrite dans les RPC
 * de recette (migration `*_zone_seuil_carreaux.sql` et suivantes) : la base refait la garde.
 */
export const PERIMETRES_ADMIS: Readonly<Partial<Record<TypeRecette, readonly TypePerimetre[]>>> = {
  rayon_poi: ['region', 'departement', 'commune', 'cp', 'zone'],
  seuil_territoire: ['region', 'departement', 'commune', 'cp', 'zone'],
  seuil_carreaux: ['departement', 'commune', 'cp', 'zone'],
};

export type OperateurSeuil = '>=' | '<=';

/**
 * La PROVENANCE d'une zone créée par le score composite (V-6, Q-4 tranchée le 29/10, arbitrage A-6) : ce que l'outil
 * envoie à `/api/custom-geo/source/score`, gardé dans la recette `capture` pour savoir d'où vient la zone. Elle reste
 * FIGÉE : le score n'est jamais rejoué. Le score se calcule toujours au code postal (`maille: 'cp'`).
 */
export interface ParametresScore {
  readonly indicateurs: readonly { readonly code: string; readonly poids: number; readonly sens: 'croissant' | 'decroissant' }[];
  readonly maille: 'cp';
  readonly seuil_score: number;
}

/**
 * Les indicateurs d'un seuil sur carreaux Filosofi 200 m — liste FERMÉE, la même que le `case` de
 * `zone_seuil_carreaux` (migration `*_zone_seuil_carreaux.sql`, verrouillée par un test qui la lit). Une part est en %
 * (numérateur / ménages ou individus du carreau) ; la densité en habitants par km² (individus / 0,04 km²).
 */
export const INDICATEURS_SEUIL_CARREAUX: readonly { readonly id: string; readonly libelle: string; readonly unite: '%' | 'hab./km²' }[] = [
  { id: 'part_men_pauv', libelle: 'Part des ménages pauvres', unite: '%' },
  { id: 'part_men_1ind', libelle: 'Part des ménages d’une personne', unite: '%' },
  { id: 'part_men_5ind', libelle: 'Part des ménages de 5 personnes ou plus', unite: '%' },
  { id: 'part_men_prop', libelle: 'Part des ménages propriétaires', unite: '%' },
  { id: 'part_men_fmp', libelle: 'Part des familles monoparentales', unite: '%' },
  { id: 'part_men_coll', libelle: 'Part des ménages en logement collectif', unite: '%' },
  { id: 'part_ind_18_24', libelle: 'Part des 18-24 ans', unite: '%' },
  { id: 'part_ind_25_39', libelle: 'Part des 25-39 ans', unite: '%' },
  { id: 'part_ind_40_54', libelle: 'Part des 40-54 ans', unite: '%' },
  { id: 'part_ind_55_64', libelle: 'Part des 55-64 ans', unite: '%' },
  { id: 'part_ind_65_79', libelle: 'Part des 65-79 ans', unite: '%' },
  { id: 'part_ind_80p', libelle: 'Part des 80 ans et plus', unite: '%' },
  { id: 'densite_ind', libelle: 'Densité d’habitants', unite: 'hab./km²' },
];

/**
 * B15 : les unités ENTIÈRES dont la zone est l'union — IRIS ou CP d'un seuil sur territoires (posées par le serveur,
 * `zone_seuil_territoire`), CP d'une capture de score, codes d'une liste de CP (posés par la base depuis `codes`). La
 * zone est exacte dans CETTE maille (`exactitude`). `groupes_partiels` : les groupes de CP indiscernables présents en
 * partie dans `codes`, posé par la BASE à chaque écriture (trigger) ; absent = inconnu, donc non exacte.
 * Round 1 (I-2, sql/321) : STOCKÉES dans la colonne `custom_geo_zones.unites_constitutives`, JAMAIS dans le JSON
 * `recette` (d'autres branches le relisent en `.strict()`) ; le serveur les joint à la recette EN MÉMOIRE à la lecture
 * (`recetteVue`) — c'est cette vue que lisent ⑤ et l'extraction.
 */
export interface UnitesConstitutives {
  readonly maille: 'cp' | 'iris';
  readonly codes: readonly string[];
  readonly groupes_partiels?: number;
}

export type Recette =
  // `part_retenue` (0 à 1) : la part du disque retenue sur le territoire français, posée par la BASE à chaque écriture
  // de la zone (trigger, sql/307) — une valeur du client est écrasée. 1 = disque entier, seul cas où le cercle est
  // exact (A3, `exactitude`) ; absente (zone jamais réécrite) : inconnue, donc non exacte.
  | { readonly v: 1; readonly type: 'rayon_point'; readonly lon: number; readonly lat: number; readonly rayon_m: number; readonly part_retenue?: number }
  | { readonly v: 1; readonly type: 'rayon_poi'; readonly categorie: string; readonly rayon_m: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'seuil_carreaux'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null; readonly min_menages: number }
  | { readonly v: 1; readonly type: 'seuil_territoire'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null; readonly unites_constitutives?: UnitesConstitutives }
  | { readonly v: 1; readonly type: 'codes_postaux'; readonly codes: readonly string[]; readonly unites_constitutives?: UnitesConstitutives }
  | { readonly v: 1; readonly type: 'dessin' }
  | { readonly v: 1; readonly type: 'import'; readonly format: 'geojson' | 'kml'; readonly fichier: string }
  | { readonly v: 1; readonly type: 'isochrone'; readonly parametres: Readonly<Record<string, string | number | boolean>> }
  | { readonly v: 1; readonly type: 'combinaison'; readonly operation: 'union' | 'intersection' | 'difference'; readonly zones: readonly string[] }
  | { readonly v: 1; readonly type: 'capture'; readonly source_type: string; readonly parametres?: ParametresScore; readonly unites_constitutives?: UnitesConstitutives }
  | { readonly v: 1; readonly type: 'pays'; readonly code: CodePays };

/** Les refus que rend une RPC de recette (`{ refus }`) ou que l'écran pose avant d'appeler. */
export type RefusRecette =
  | 'perimetre_absent' | 'perimetre_national_refuse' | 'perimetre_inconnu' | 'perimetre_trop_grand'
  | 'perimetre_non_admis' | 'commune_ambigue'
  | 'trop_de_poi' | 'trop_de_carreaux' | 'trop_de_territoires' | 'trop_de_sommets'
  | 'trop_de_poi_metropole' | 'seuil_metropole_differe'
  | 'indicateur_inconnu' | 'zone_introuvable' | 'zone_referencee' | 'forme_vide' | 'intersection_vide' | 'forme_figee'
  | 'operande_pays' | 'rayon_sous_minimum';

export const MESSAGES_REFUS: Readonly<Record<RefusRecette, string>> = {
  perimetre_absent: 'Choisissez un périmètre à l’étape ① avant ce calcul.',
  perimetre_national_refuse: 'Ce calcul ne se lance pas sur la France entière : choisissez un périmètre plus petit à l’étape ①.',
  perimetre_inconnu: 'Le périmètre de l’étape ① est introuvable ou n’appartient pas à cet espace.',
  perimetre_trop_grand: 'Le périmètre est trop grand pour ce calcul : resserrez-le à l’étape ①.',
  perimetre_non_admis: 'Ce calcul se fait sur un département au plus : choisissez un département, une commune, un code postal ou une zone à l’étape ①.',
  commune_ambigue: 'Plusieurs communes portent ce nom : tapez son code INSEE (ex. 93066) ou choisissez son code postal à l’étape ①.',
  trop_de_poi: `Plus de ${formaterNombre(CAPACITE_SYNCHRONE_POI_RAYON)} POI dans le périmètre : `
    + 'ce calcul dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond dès le lot « calculs longs » ; '
    + 'en attendant, resserrez le périmètre à l’étape ①.',
  trop_de_carreaux: `Plus de ${formaterNombre(MAX_CARREAUX_SEUIL)} carreaux retenus : resserrez le périmètre ou relevez le seuil.`,
  // Repli seulement : le serveur dit le nombre retenu et le conseil selon l'opérateur (`messageTropDeTerritoires`).
  trop_de_territoires: `Plus de ${formaterNombre(MAX_TERRITOIRES_SEUIL)} territoires retenus : changez le seuil ou resserrez le périmètre à l’étape ①.`,
  trop_de_sommets: `La forme dépasse ${formaterNombre(MAX_SOMMETS_FORME)} sommets : simplifiez-la avant de l’importer.`,
  trop_de_poi_metropole: `Plus de ${formaterNombre(CAPACITE_SYNCHRONE_POI_RAYON)} POI dans toute la France métropolitaine : `
    + 'ce calcul dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond dès le lot « calculs longs » ; '
    + 'en attendant, choisissez une région ou un département à l’étape ①.',
  seuil_metropole_differe: 'Le seuil sur toute la France métropolitaine arrive bientôt, en calcul de fond. En attendant, '
    + 'choisissez à l’étape ① un département (carreaux) ou une région (territoires).',
  indicateur_inconnu: 'Cet indicateur n’est pas disponible pour un seuil.',
  zone_introuvable: 'Zone introuvable dans cet espace.',
  zone_referencee: 'Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être recalculée.',
  forme_vide: 'Aucun territoire français dans cette forme : rien à enregistrer.',
  // C20 round 1 : une intersection vide de zones françaises n'est pas une forme hors de France.
  intersection_vide: 'Les zones cochées n’ont aucune partie commune.',
  forme_figee: 'Cette zone a une forme figée (dessin, import, isochrone, capture, combinaison ou zone nationale) : elle ne se recalcule pas.',
  // C21 : « zone nationale moins zones locales » est admise ; tout autre emploi d'une zone nationale est refusé.
  operande_pays: 'Une zone nationale (France métropolitaine ou entière) ne se combine qu’en première zone d’une soustraction, '
    + 'moins des zones locales : elle ne se fusionne pas, ne se restreint pas et ne se retire pas.',
  rayon_sous_minimum: `Le rayon autour d’un point est de ${formaterNombre(RAYON_POINT_MIN_M)} m au moins depuis le 31/10 `
    + '(sous ce rayon, le disque est plus petit qu’un carreau de population) : cette zone, enregistrée avec un rayon plus petit, '
    + `n’est pas modifiée et ne se recalcule plus ; recréez-la avec un rayon d’au moins ${formaterNombre(RAYON_POINT_MIN_M)} m.`,
};

/** D30 round 1 (sql/335) : retenues ET plafond (règle 5), conseil selon l'opérateur ; sans retenues, « plus de ». */
export function messageTropDeTerritoires(r: { retenues: number | null; plafond: number; operateur: OperateurSeuil }): string {
  const conseil = `${r.operateur === '>=' ? 'relevez' : 'baissez'} le seuil ou resserrez le périmètre à l’étape ①.`;
  return r.retenues !== null
    ? `${formaterNombre(r.retenues)} territoires retenus, plafond ${formaterNombre(r.plafond)} : ${conseil}`
    : `Plus de ${formaterNombre(r.plafond)} territoires retenus : ${conseil}`;
}

export function estRecalculable(r: Recette): boolean {
  return TYPES_RECALCULABLES.includes(r.type);
}

/** Vrai quand la forme vient du client (dessin, import, isochrone, capture) ; une combinaison est calculée par le serveur. */
export function exigeGeometrie(r: Recette): boolean {
  return TYPES_GEOMETRIE_CLIENTE.includes(r.type);
}

export function exigePerimetre(r: Recette): boolean {
  return TYPES_BORNES_PAR_PERIMETRE.includes(r.type);
}

/**
 * Le refus que l'écran pose AVANT tout appel ; la surface, l'appartenance d'une zone et la résolution d'une commune
 * se vérifient en base (`resoudre_perimetre`, migration `*_zones_a_recette.sql`).
 *
 * France métropolitaine (`METRO`, retours du 26/10) : « Autour des POI » se lance (sa capacité est refaite en base,
 * sql/285) ; les deux seuils attendent le calcul en tâche de fond. La France entière (`FR`) reste refusée partout.
 * B8 (ARB-5) : un rayon autour d'un point sous `RAYON_POINT_MIN_M` est refusé AVANT le périmètre (`rayon_sous_minimum`).
 */
export function refusPerimetreLocal(r: Recette): RefusRecette | null {
  // B8 (ARB-5) : une recette sous le rayon minimal ne se calcule plus (création ou recalcul) ; jamais relevée en silence.
  if (r.type === 'rayon_point' && r.rayon_m < RAYON_POINT_MIN_M) return 'rayon_sous_minimum';
  if (!exigePerimetre(r) || !('perimetre' in r)) return null;
  if (!r.perimetre) return 'perimetre_absent';
  if (r.perimetre.type === 'france') {
    if (r.perimetre.code !== 'METRO') return 'perimetre_national_refuse';
    return r.type === 'rayon_poi' ? null : 'seuil_metropole_differe';
  }
  const admis = PERIMETRES_ADMIS[r.type];
  if (admis && !admis.includes(r.perimetre.type)) return 'perimetre_non_admis';
  return null;
}

/**
 * Décision du 02/11 (chef de produit) : un rayon, autour d'un point ou de POI, sous `RAYON_POINT_MIN_M` est plus fin
 * que les carreaux INSEE (200 m de côté). En ANALYSE il reste admis et calculé (rayon POI dès `RAYON_POI_MIN_M`),
 * chiffres dits estimatifs (`mentionEstimatif`) ; il n'est JAMAIS activé (⑤ : bilan, enregistrement du jeu,
 * extraction — `refusActivation`), et jamais relevé en silence au minimum d'une plateforme. Rend le rayon, ou `null`.
 */
export function rayonNonActivable(r: Recette | null): number | null {
  return (r?.type === 'rayon_point' || r?.type === 'rayon_poi') && r.rayon_m < RAYON_POINT_MIN_M ? r.rayon_m : null;
}

/** Une zone de l'espace telle qu'une liste (ou le serveur) la connaît : son nom, sa recette lue. */
export interface ZoneConnue { readonly name: string; readonly recette: Recette | null }

/**
 * Tour 3 (N-2) : ce qui empêche d'activer la recette — elle-même (`nom` null), ou, pour une COMBINAISON (union,
 * intersection, différence : toutes), la première de ses zones sources, à toute profondeur, de rayon trop fin (son
 * nom). Seules les sources de `zones` sont vues : l'écran passe sa liste, le serveur les lit (`activation-serveur.ts`).
 */
function zoneTropFine(r: Recette | null, zones: ReadonlyMap<string, ZoneConnue> = new Map()): { nom: string | null; rayon: number } | null {
  const vues = new Set<string>();
  const chercher = (x: Recette | null, nom: string | null): { nom: string | null; rayon: number } | null => {
    const rayon = rayonNonActivable(x);
    if (rayon !== null) return { nom, rayon };
    if (x?.type !== 'combinaison') return null;
    for (const id of x.zones) {
      const z = zones.get(id);
      if (!z || vues.has(id)) continue;
      vues.add(id);
      const t = chercher(z.recette, z.name);
      if (t) return t;
    }
    return null;
  };
  return chercher(r, null);
}

/** Le refus d'activer une telle zone (⑤, export DSP), avec sa valeur — et la zone fautive d'une combinaison ; `null` si elle s'active. */
export function refusActivation(r: Recette | null, zones?: ReadonlyMap<string, ZoneConnue>): string | null {
  const t = zoneTropFine(r, zones);
  if (!t) return null;
  const minimum = `minimum ${formaterNombre(RAYON_POINT_MIN_M)} m`;
  return t.nom === null
    ? `Rayon de ${formaterNombre(t.rayon)} m : trop fin pour être activé (${minimum}). Gardé pour l’analyse uniquement.`
    : `La zone « ${t.nom} » (rayon de ${formaterNombre(t.rayon)} m) est trop fine pour être activée (${minimum}) : `
      + 'cette combinaison est gardée pour l’analyse uniquement.';
}

/** La mention posée à côté des chiffres d'une telle zone en analyse (③, ④, « Mes zones ») ; `null` sinon. */
export function mentionEstimatif(r: Recette | null, zones?: ReadonlyMap<string, ZoneConnue>): string | null {
  const t = zoneTropFine(r, zones);
  if (!t) return null;
  const objet = t.nom === null ? `un rayon de ${formaterNombre(t.rayon)} m est`
    : `cette combinaison contient la zone « ${t.nom} », de rayon ${formaterNombre(t.rayon)} m,`;
  return `Chiffres estimatifs : ${objet} plus fin que les carreaux INSEE de 200 m. `
    + `Zone gardée pour l’analyse, jamais activée (minimum ${formaterNombre(RAYON_POINT_MIN_M)} m).`;
}

/** La liste d'un écran (id, nom, recette) en zones connues, pour `refusActivation` / `mentionEstimatif` d'une combinaison. */
export function zonesParId(liste: readonly { readonly id: string; readonly name: string; readonly recette?: Recette | null }[]): ReadonlyMap<string, ZoneConnue> {
  return new Map(liste.map((z) => [z.id, { name: z.name, recette: z.recette ?? null }]));
}

function km(m: number): string {
  return m >= 1000 ? `${Math.round(m / 100) / 10} km`.replace('.', ',') : `${m} m`;
}

const OPERATIONS = { union: 'Union', intersection: 'Intersection', difference: 'Différence' } as const;

/**
 * Un indicateur du catalogue des territoires (`GET /api/cibles/indicators`), réduit à ce que le libellé lit. Écrit ici
 * en forme STRUCTURELLE (non exportée : `IndicateurRegistre` côté Angular s'y conforme) — ce fichier est recopié tel
 * quel côté Angular, qui n'a pas les types du serveur.
 */
interface IndicateurLibelle {
  readonly indicator_code: string;
  readonly label: string;
  readonly unit?: string | null;
}

/** « Carreaux où part des ménages pauvres ≥ 40 % » : le libellé (initiale en minuscule), l'opérateur, le seuil. */
function ligneSeuil(objet: string, nom: string, operateur: OperateurSeuil, seuil: number, unite: string | null | undefined): string {
  return `${objet} où ${nom} ${operateur === '>=' ? '≥' : '≤'} ${formaterNombre(seuil)} ${unite ?? ''}`.trim();
}

function minusculeInitiale(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Une ligne lisible, sans le nom de la zone (affichée dans « Mes zones »). Le seuil est mis en forme par
 * `formaterNombre` (« 20 000 », « 12,5 »). Un seuil sur territoires prend le libellé et l'unité de `indicateurs` (le
 * catalogue, quand l'écran l'a lu) ; sans catalogue, ou indicateur retiré du registre, son identifiant plutôt que rien.
 */
export function libelleRecette(r: Recette, indicateurs: readonly IndicateurLibelle[] = []): string {
  switch (r.type) {
    case 'rayon_point': return `Rayon de ${km(r.rayon_m)} autour d’un point${r.rayon_m < RAYON_POINT_MIN_M ? ` — sous le minimum de ${km(RAYON_POINT_MIN_M)}, ne se recalcule plus` : ''}`;
    case 'rayon_poi': return `Rayon de ${km(r.rayon_m)} autour des POI « ${r.categorie} »`;
    case 'seuil_carreaux': {
      const i = INDICATEURS_SEUIL_CARREAUX.find((x) => x.id === r.indicateur);
      const ligne = ligneSeuil('Carreaux', i ? minusculeInitiale(i.libelle) : r.indicateur, r.operateur, r.seuil, i?.unite);
      // A5 : la valeur TOUJOURS dite, 0 compris (une recette migrée affiche « minimum de ménages : 0 »).
      return `${ligne} · minimum de ménages : ${formaterNombre(r.min_menages)}`;
    }
    case 'seuil_territoire': {
      const i = indicateurs.find((x) => x.indicator_code === r.indicateur);
      return ligneSeuil('Territoires', i ? minusculeInitiale(i.label) : r.indicateur, r.operateur, r.seuil, i?.unit);
    }
    case 'codes_postaux': return `${r.codes.length} ${r.codes.length > 1 ? 'codes postaux' : 'code postal'}`;
    case 'dessin': return 'Dessin à main levée';
    case 'import': return `Import ${r.format === 'kml' ? 'KML' : 'GeoJSON'} (${r.fichier})`;
    case 'isochrone': return 'Isochrones';
    case 'combinaison': return `${OPERATIONS[r.operation]} de ${r.zones.length} zones`;
    case 'capture': return 'Capture de la carte';
    case 'pays': return r.code === 'METRO' ? 'France métropolitaine' : 'France entière';
  }
}

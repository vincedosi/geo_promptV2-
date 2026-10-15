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
export const VERSION_RECETTE = 1;

export const TYPES_RECETTE = [
  'rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
  'dessin', 'import', 'isochrone', 'combinaison', 'capture',
] as const;
export type TypeRecette = (typeof TYPES_RECETTE)[number];

/** Rejouées par l'exécuteur serveur. */
export const TYPES_RECALCULABLES: readonly TypeRecette[] = ['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux', 'combinaison'];
/** Coûteuses : bornées par le périmètre de ①, refusent la France entière (spec § 16.2-5). */
export const TYPES_BORNES_PAR_PERIMETRE: readonly TypeRecette[] = ['rayon_poi', 'seuil_carreaux', 'seuil_territoire'];

export const TYPES_PERIMETRE = ['region', 'departement', 'commune', 'cp', 'zone', 'france'] as const;
export type TypePerimetre = (typeof TYPES_PERIMETRE)[number];
export interface PerimetreRecette {
  readonly type: TypePerimetre;
  /** Code INSEE, code postal, UUID de zone ; `FR` pour la France. */
  readonly code: string;
}

/*
 * Les plafonds sont ceux des RPC de recette : un dépassement est un REFUS dit à l'utilisateur, jamais une troncature.
 */
export const RAYON_POI_MIN_M = 100;
export const RAYON_POI_MAX_M = 50_000;
export const MAX_POI_RAYON = 5_000;
export const MAX_CARREAUX_SEUIL = 20_000;
export const MAX_TERRITOIRES_SEUIL = 5_000;
export const MAX_SOMMETS_FORME = 20_000;
export const MAX_CODES_POSTAUX = 3_000;
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

export type Recette =
  | { readonly v: 1; readonly type: 'rayon_point'; readonly lon: number; readonly lat: number; readonly rayon_m: number }
  | { readonly v: 1; readonly type: 'rayon_poi'; readonly categorie: string; readonly rayon_m: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'seuil_carreaux'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'seuil_territoire'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'codes_postaux'; readonly codes: readonly string[] }
  | { readonly v: 1; readonly type: 'dessin' }
  | { readonly v: 1; readonly type: 'import'; readonly format: 'geojson' | 'kml'; readonly fichier: string }
  | { readonly v: 1; readonly type: 'isochrone'; readonly parametres: Readonly<Record<string, string | number | boolean>> }
  | { readonly v: 1; readonly type: 'combinaison'; readonly operation: 'union' | 'intersection' | 'difference'; readonly zones: readonly string[] }
  | { readonly v: 1; readonly type: 'capture'; readonly source_type: string };

/** Les refus que rend une RPC de recette (`{ refus }`) ou que l'écran pose avant d'appeler. */
export type RefusRecette =
  | 'perimetre_absent' | 'perimetre_national_refuse' | 'perimetre_inconnu' | 'perimetre_trop_grand'
  | 'perimetre_non_admis' | 'commune_ambigue'
  | 'trop_de_poi' | 'trop_de_carreaux' | 'trop_de_territoires' | 'trop_de_sommets'
  | 'indicateur_inconnu' | 'zone_introuvable' | 'zone_referencee' | 'forme_vide' | 'forme_figee';

export const MESSAGES_REFUS: Readonly<Record<RefusRecette, string>> = {
  perimetre_absent: 'Choisissez un périmètre à l’étape ① avant ce calcul.',
  perimetre_national_refuse: 'Ce calcul ne se lance pas sur la France entière : choisissez une région, un département ou une zone à l’étape ①.',
  perimetre_inconnu: 'Le périmètre de l’étape ① est introuvable ou n’appartient pas à cet espace.',
  perimetre_trop_grand: 'Le périmètre est trop grand pour ce calcul : resserrez-le à l’étape ①.',
  perimetre_non_admis: 'Ce calcul se fait sur un département au plus : choisissez un département, une commune, un code postal ou une zone à l’étape ①.',
  commune_ambigue: 'Plusieurs communes portent ce nom : tapez son code INSEE (ex. 93066) ou choisissez son code postal à l’étape ①.',
  trop_de_poi: 'Plus de 5 000 POI dans le périmètre : resserrez le périmètre.',
  trop_de_carreaux: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.',
  trop_de_territoires: 'Plus de 5 000 territoires retenus : resserrez le périmètre ou relevez le seuil.',
  trop_de_sommets: 'La forme dépasse 20 000 sommets : simplifiez-la avant de l’importer.',
  indicateur_inconnu: 'Cet indicateur n’est pas disponible pour un seuil.',
  zone_introuvable: 'Zone introuvable dans cet espace.',
  zone_referencee: 'Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.',
  forme_vide: 'Aucun territoire français dans cette forme : rien à enregistrer.',
  forme_figee: 'Cette zone a une forme figée (dessin, import, isochrone ou capture) : elle ne se recalcule pas.',
};

export function estRecalculable(r: Recette): boolean {
  return TYPES_RECALCULABLES.includes(r.type);
}

export function exigePerimetre(r: Recette): boolean {
  return TYPES_BORNES_PAR_PERIMETRE.includes(r.type);
}

/**
 * Le refus que l'écran pose AVANT tout appel ; la surface, l'appartenance d'une zone et la résolution d'une commune
 * se vérifient en base (`resoudre_perimetre`, migration `*_zones_a_recette.sql`).
 */
export function refusPerimetreLocal(r: Recette): RefusRecette | null {
  if (!exigePerimetre(r) || !('perimetre' in r)) return null;
  if (!r.perimetre) return 'perimetre_absent';
  if (r.perimetre.type === 'france') return 'perimetre_national_refuse';
  const admis = PERIMETRES_ADMIS[r.type];
  if (admis && !admis.includes(r.perimetre.type)) return 'perimetre_non_admis';
  return null;
}

function km(m: number): string {
  return m >= 1000 ? `${Math.round(m / 100) / 10} km`.replace('.', ',') : `${m} m`;
}

const OPERATIONS = { union: 'Union', intersection: 'Intersection', difference: 'Différence' } as const;

/** Une ligne lisible, sans le nom de la zone (affichée dans « Mes zones »). */
export function libelleRecette(r: Recette): string {
  switch (r.type) {
    case 'rayon_point': return `Rayon de ${km(r.rayon_m)} autour d’un point`;
    case 'rayon_poi': return `Rayon de ${km(r.rayon_m)} autour des POI « ${r.categorie} »`;
    case 'seuil_carreaux': {
      const i = INDICATEURS_SEUIL_CARREAUX.find((x) => x.id === r.indicateur);
      const nom = i ? i.libelle.charAt(0).toLowerCase() + i.libelle.slice(1) : r.indicateur;
      return `Carreaux où ${nom} ${r.operateur === '>=' ? '≥' : '≤'} ${String(r.seuil).replace('.', ',')} ${i?.unite ?? ''}`.trim();
    }
    case 'seuil_territoire': return `Territoires où ${r.indicateur} ${r.operateur === '>=' ? '≥' : '≤'} ${String(r.seuil).replace('.', ',')}`;
    case 'codes_postaux': return `${r.codes.length} ${r.codes.length > 1 ? 'codes postaux' : 'code postal'}`;
    case 'dessin': return 'Dessin à main levée';
    case 'import': return `Import ${r.format === 'kml' ? 'KML' : 'GeoJSON'} (${r.fichier})`;
    case 'isochrone': return 'Isochrones';
    case 'combinaison': return `${OPERATIONS[r.operation]} de ${r.zones.length} zones`;
    case 'capture': return 'Capture de la carte';
  }
}

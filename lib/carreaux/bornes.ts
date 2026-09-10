/**
 * @file lib/carreaux/bornes.ts
 *
 * Bornes NATIONALES fixes de l'echelle de couleurs des carreaux INSEE.
 *
 * Avant : l'echelle etait relative au viewport — `queryRenderedFeatures` +
 * p5/p95 sur ce qui etait a l'ecran, recalcules a chaque `idle`/`moveend`. En se
 * deplacant de Paris a la Lozere a zoom constant, les bornes se recalaient sur
 * la plage locale : la zone rurale se recolorait sur elle-meme et paraissait
 * aussi contrastee que Paris. Deux territoires ne pouvaient pas etre compares.
 *
 * Apres : les bornes ne dependent plus de ce qui est affiche. Une densite donne
 * toujours la meme couleur, ou qu'on soit sur la carte et quel que soit le
 * palier de maille servi (la tache 1 a rendu les valeurs comparables entre
 * paliers, celle-ci rend les bornes stables entre zones).
 *
 * ── Provenance des valeurs ─────────────────────────────────────────────────
 * Percentiles 5 et 95 mesures le **2026-09-10** sur `carreaux_5km` (22 058
 * lignes, projet vkkdbygwbrxyogqosten), sur les valeurs **normalisees** : les
 * effectifs divises par 25 km2 (superficie d'un carreau 5 km), `revenu_median`
 * par `ind`, `surface_moyenne` par `men` — exactement ce que calcule
 * `lib/carreaux/normalisation.ts` cote carte. Les carreaux de valeur ou de
 * denominateur nul sont exclus du calcul, comme le fait `normaliser`.
 *
 * Le palier 5 km est choisi parce qu'il est petit : un percentile exige un tri
 * complet, donc un full scan, et `carreaux_filosofi` compte 2 298 582 lignes —
 * ce que le budget I/O de Supabase Nano interdit. Les valeurs etant
 * normalisees, les bornes du 5 km valent pour les trois paliers.
 *
 * Requete rejouable et correspondance id ↔ colonne SQL (qui n'est PAS
 * l'identite : `population_totale` = `ind`, `revenu_median` = `ind_snv`…) :
 * `sql/123_carreaux_bornes_nationales.sql`. A rejouer apres tout re-import
 * Filosofi.
 *
 * ── Unites ─────────────────────────────────────────────────────────────────
 * Effectifs : par km2. `revenu_median` : euros par habitant.
 * `surface_moyenne` : m2 par menage.
 */

/** Bornes basse et haute de l'echelle d'un indicateur, en valeur normalisee. */
export interface BornesIndicateur {
  p5: number;
  p95: number;
}

/**
 * Une entree par id de `CARREAUX_INDICATEURS` — 28 au total. L'absence d'un id
 * du catalogue est un defaut, verrouille par `tests/unit/carreaux/bornes.test.ts`.
 */
export const BORNES_NATIONALES: Record<string, BornesIndicateur> = {
  // Population — personnes/km²
  population_totale:       { p5:     2.2200, p95:   369.1120 },
  population_inconnue:     { p5:     0.0320, p95:     1.6760 },
  ind_0_3:                 { p5:     0.0600, p95:    14.4992 },
  ind_4_5:                 { p5:     0.0400, p95:     8.1680 },
  ind_6_10:                { p5:     0.0920, p95:    22.2012 },
  ind_11_17:               { p5:     0.1320, p95:    32.6164 },
  ind_18_24:               { p5:     0.1120, p95:    27.8176 },
  ind_25_39:               { p5:     0.2480, p95:    59.3954 },
  ind_40_54:               { p5:     0.3936, p95:    72.8472 },
  ind_55_64:               { p5:     0.3788, p95:    50.1412 },
  ind_65_79:               { p5:     0.4800, p95:    61.2912 },
  ind_80p:                 { p5:     0.1560, p95:    22.5922 },
  // Ménages — ménages/km², sauf surface_moyenne (m²/ménage)
  menages_total:           { p5:     1.0880, p95:   165.5352 },
  menages_pauvres:         { p5:     0.1840, p95:    22.4870 },
  menages_1_personne:      { p5:     0.3840, p95:    57.4044 },
  menages_5_plus:          { p5:     0.0440, p95:     9.4772 },
  menages_proprietaires:   { p5:     0.8120, p95:   102.7108 },
  familles_monoparentales: { p5:     0.0840, p95:    18.6040 },
  menages_maison:          { p5:     0.9440, p95:   108.8872 },
  menages_collectif:       { p5:     0.0360, p95:    62.1488 },
  surface_moyenne:         { p5:    82.4312, p95:   124.8391 },
  // Revenus — €/habitant (ind_snv / ind)
  revenu_median:           { p5: 20045.5577, p95: 28795.3640 },
  // Logements — logements/km²
  logements_avant_1945:    { p5:     0.4600, p95:    32.7914 },
  logements_1945_1970:     { p5:     0.0440, p95:    25.4728 },
  logements_1970_1990:     { p5:     0.1280, p95:    45.8440 },
  logements_apres_1990:    { p5:     0.1600, p95:    59.9290 },
  logements_sociaux:       { p5:     0.0440, p95:    50.7800 },
  logements_inconnus:      { p5:     0.0200, p95:     0.6430 },
};

/**
 * Repli pour un id hors catalogue. Les deux seules proprietes qui comptent :
 * p95 > p5 strictement — une expression `interpolate` de MapLibre a bornes non
 * strictement croissantes est rejetee EN SILENCE, la couche restant alors sans
 * couleur et sans erreur — et des valeurs finies.
 */
const REPLI: BornesIndicateur = { p5: 0, p95: 1 };

/**
 * Bornes d'un indicateur.
 *
 * `Object.prototype.hasOwnProperty.call` (meme garde que
 * `lib/carreaux/normalisation.ts`) : sans lui, `bornesDe('constructor')`
 * renverrait la fonction `Object` heritee du prototype, qui traverserait
 * jusqu'a `interpolate` sous forme de `NaN`.
 *
 * @returns les bornes nationales de l'indicateur, ou `REPLI` si l'id est
 *          inconnu — jamais `undefined`, pour qu'aucun appelant n'ait a tester.
 */
export function bornesDe(id: string): BornesIndicateur {
  return Object.prototype.hasOwnProperty.call(BORNES_NATIONALES, id)
    ? BORNES_NATIONALES[id]
    : REPLI;
}

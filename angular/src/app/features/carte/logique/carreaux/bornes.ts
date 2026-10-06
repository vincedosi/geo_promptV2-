/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/carreaux/bornes.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
/**
 * @file lib/carreaux/bornes.ts
 *
 * Bornes NATIONALES fixes de l'echelle de couleurs des carreaux INSEE,
 * exprimees en **log10 de la valeur normalisee**.
 *
 * ── Pourquoi des bornes fixes (ronde 1) ────────────────────────────────────
 * L'echelle etait relative au viewport — `queryRenderedFeatures` + p5/p95 sur
 * ce qui etait a l'ecran, recalcules a chaque `idle`/`moveend`. En se deplacant
 * de Paris a la Lozere a zoom constant, les bornes se recalaient sur la plage
 * locale : la zone rurale se recolorait sur elle-meme et paraissait aussi
 * contrastee que Paris. Deux territoires ne pouvaient pas etre compares.
 *
 * ── Pourquoi une echelle LOGARITHMIQUE (ronde 2) ───────────────────────────
 * Des bornes fixes lineaires mesurees sur le palier 5 km ont produit un defaut
 * pire que celui d'origine : mesure en base le 2026-09-10, avec une borne haute
 * lineaire, **99,5 % des carreaux de Paris en maille 200 m saturaient** (densite
 * mediane 19 775 hab/km2 contre une borne a quelques centaines), et 78,7 % de la
 * France. La carte devenait un aplat monochrome au zoom >= 10, exactement la ou
 * un media-planneur travaille.
 *
 * La cause n'est pas la normalisation : elle rend les UNITES comparables, pas
 * les DISTRIBUTIONS. Un carreau de 5 km moyenne le coeur dense avec les parcs et
 * les zones laches ; un carreau de 200 m en plein 11e est de la densite pure. La
 * meme grandeur s'etend sur plus de 4 decades selon le palier et le territoire —
 * une interpolation lineaire ne peut pas couvrir ca. En log10, 4 decades
 * deviennent 4 unites d'echelle : chaque palier recupere un vrai degrade et une
 * couleur garde le meme sens partout.
 *
 * ── Provenance des valeurs ─────────────────────────────────────────────────
 * Mesures le **2026-09-10**, projet vkkdbygwbrxyogqosten, sur les valeurs
 * **normalisees** (`lib/carreaux/normalisation.ts`) puis passees au log10.
 * Requetes rejouables et correspondance id ↔ colonne SQL (qui n'est PAS
 * l'identite : `population_totale` = `ind`, `revenu_median` = `ind_snv`…) :
 * `sql/123_carreaux_bornes_nationales.sql`.
 *
 * `min` — le plancher de l'echelle. Pris sur le palier le plus GROSSIER servi
 * (5 km, 22 058 lignes, mesure exhaustive), car c'est lui qui descend le plus
 * bas : une maille de 25 km2 moyenne de vastes zones vides, quand une maille de
 * 200 m habitee vaut au minimum 25 hab/km2. Sans ce plancher bas, la vue
 * nationale au zoom 6-7 serait presque entierement au ras de l'echelle.
 *
 * `max` — le plafond. Pris sur le palier le plus FIN servi (200 m), seul a
 * porter la queue urbaine dense, sur un echantillon `TABLESAMPLE SYSTEM (1)`
 * (~23 000 lignes) : un percentile exige un tri complet, donc un full scan, et
 * `carreaux_filosofi` compte 2 298 582 lignes — interdit par le budget I/O de
 * Supabase Nano.
 *
 * Le quantile haut retenu differe par classe d'indicateur, et c'est mesure :
 *  - **effectifs** (densites, queue droite non bornee) → **p99,9 du 200 m**.
 *    Avec le p95, 89,8 % des carreaux de Paris saturaient encore malgre le log ;
 *    avec le p99,9, 31,3 % — pour un cout national de 0,1 % de carreaux satures.
 *  - **`revenu_median` et `surface_moyenne`** (ratios bornes) → **p95 du 200 m**.
 *    Leur distribution entiere tient dans ~0,23 decade ; prendre leur p99,9
 *    (4,7125 pour le revenu, soit 51 600 €/hab) etirerait l'echelle sur un
 *    aberrant et tasserait toute la France dans le bas du degrade.
 *
 * ── Unites ─────────────────────────────────────────────────────────────────
 * `min`/`max` sont des LOGARITHMES. Toute valeur montree a l'utilisateur doit
 * repasser par {@link versValeurReelle} : effectifs en /km2, `revenu_median` en
 * €/habitant, `surface_moyenne` en m2/menage.
 */

/**
 * Bornes basse et haute de l'echelle d'un indicateur, en **log10 de la valeur
 * normalisee**.
 *
 * Nommees `min`/`max` et non `p5`/`p95` : le plafond vient du p99,9 pour les
 * effectifs et du p95 pour les deux ratios, et les deux bornes ne sont meme pas
 * mesurees sur le meme palier. Un nom de percentile ici serait faux.
 */
export interface BornesEchelle {
  min: number;
  max: number;
}

/**
 * Une entree par id de `CARREAUX_INDICATEURS` — 28 au total. L'absence d'un id
 * du catalogue est un defaut, verrouille par `tests/unit/carreaux/bornes.test.ts`.
 *
 * Le commentaire de fin de ligne donne les bornes en unite reelle, pour qu'une
 * relecture puisse juger de leur plausibilite sans calculer d'exponentielle.
 */
export const BORNES_NATIONALES: Record<string, BornesEchelle> = {
  // Population — log10(personnes/km²)
  population_totale:       { min:  0.3464, max: 4.4670 }, //      2,22 →  29 310 hab/km²
  population_inconnue:     { min: -1.4949, max: 2.8856 }, //      0,03 →     768
  ind_0_3:                 { min: -1.2218, max: 3.2537 }, //      0,06 →   1 793
  ind_4_5:                 { min: -1.3979, max: 3.0279 }, //      0,04 →   1 066
  ind_6_10:                { min: -1.0362, max: 3.3537 }, //      0,09 →   2 258
  ind_11_17:               { min: -0.8794, max: 3.4426 }, //      0,13 →   2 771
  ind_18_24:               { min: -0.9508, max: 3.3843 }, //      0,11 →   2 423
  ind_25_39:               { min: -0.6055, max: 3.8538 }, //      0,25 →   7 142
  ind_40_54:               { min: -0.4049, max: 3.7807 }, //      0,39 →   6 035
  ind_55_64:               { min: -0.4216, max: 3.4949 }, //      0,38 →   3 125
  ind_65_79:               { min: -0.3188, max: 3.5218 }, //      0,48 →   3 325
  ind_80p:                 { min: -0.8069, max: 3.2309 }, //      0,16 →   1 702
  // Ménages — log10(ménages/km²), sauf surface_moyenne (log10(m²/ménage))
  menages_total:           { min:  0.0366, max: 4.1095 }, //      1,09 →  12 870 mén./km²
  menages_pauvres:         { min: -0.7352, max: 3.5896 }, //      0,18 →   3 887
  menages_1_personne:      { min: -0.4157, max: 3.8101 }, //      0,38 →   6 458
  menages_5_plus:          { min: -1.3565, max: 3.1673 }, //      0,04 →   1 470
  menages_proprietaires:   { min: -0.0904, max: 3.7255 }, //      0,81 →   5 315
  familles_monoparentales: { min: -1.0757, max: 3.2933 }, //      0,08 →   1 965
  menages_maison:          { min: -0.0250, max: 3.3802 }, //      0,94 →   2 400
  menages_collectif:       { min: -1.4437, max: 4.2437 }, //      0,04 →  17 530
  surface_moyenne:         { min:  1.8940, max: 2.1434 }, //     78,3  →     139 m²/ménage
  // Revenus — log10(€/habitant) : ind_snv / ind
  revenu_median:           { min:  4.2809, max: 4.5103 }, // 19 100    →  32 380 €/hab
  // Logements — log10(logements/km²)
  logements_avant_1945:    { min: -0.3372, max: 3.7332 }, //      0,46 →   5 410
  logements_1945_1970:     { min: -1.3565, max: 3.7863 }, //      0,04 →   6 114
  logements_1970_1990:     { min: -0.8928, max: 3.7543 }, //      0,13 →   5 679
  logements_apres_1990:    { min: -0.7959, max: 3.7394 }, //      0,16 →   5 488
  logements_sociaux:       { min: -1.3565, max: 4.2200 }, //      0,04 →  16 600
  logements_inconnus:      { min: -1.6990, max: 2.5675 }, //      0,02 →     369
};

/**
 * Repli pour un id hors catalogue, en log10 : une decade, de 1 a 10. Les deux
 * seules proprietes qui comptent : `max > min` strictement — une expression
 * `interpolate` de MapLibre a bornes non strictement croissantes est rejetee EN
 * SILENCE, la couche restant alors sans couleur et sans erreur — et des valeurs
 * finies.
 */
const REPLI: BornesEchelle = { min: 0, max: 1 };

/**
 * Plancher applique a la valeur normalisee AVANT le log10, cote expression
 * MapLibre comme cote JS.
 *
 * `log10(0)` vaut `-Infinity`, qu'`interpolate` rejette sans lever
 * d'exception — meme piege silencieux que la division par zero que
 * `carreauxNormaliseExpr` neutralise deja. 1e-6 (soit -6 en log) est plusieurs
 * decades sous le plus bas `min` du catalogue (-1,699) : un carreau vide est
 * donc clampe sur la couleur la plus pale, jamais perdu.
 */
export const PLANCHER_LOG = 1e-6;

/**
 * Bornes d'un indicateur, en log10.
 *
 * `Object.prototype.hasOwnProperty.call` (meme garde que
 * `lib/carreaux/normalisation.ts`) : sans lui, `bornesDe('constructor')`
 * renverrait la fonction `Object` heritee du prototype, qui traverserait
 * jusqu'a `interpolate` sous forme de `NaN`.
 *
 * @returns les bornes nationales de l'indicateur, ou `REPLI` si l'id est
 *          inconnu — jamais `undefined`, pour qu'aucun appelant n'ait a tester.
 */
export function bornesDe(id: string): BornesEchelle {
  return Object.prototype.hasOwnProperty.call(BORNES_NATIONALES, id)
    ? BORNES_NATIONALES[id]
    : REPLI;
}

/**
 * Repasse une borne de l'echelle en unite reelle (hab/km², €/hab, m²/ménage).
 *
 * L'echelle est logarithmique, la legende ne l'est pas : elle annonce des
 * densites, pas des logarithmes. C'est l'inverse exact du `log10` applique dans
 * l'expression de couleur.
 */
export function versValeurReelle(borneLog: number): number {
  return 10 ** borneLog;
}

/**
 * Bornes **en log10** du palier `index` d'une echelle decoupee en `nPaliers`
 * tranches egales.
 *
 * Unique definition du decoupage, partagee par les deux legendes et par le
 * filtre par palier (`fill-opacity`). Les trois lisaient auparavant la meme
 * formule recopiee trois fois : une tranche de legende pouvait designer d'autres
 * carreaux que ceux que le filtre selectionnait, sans qu'aucune erreur ne soit
 * levee.
 */
export function palierEchelle(
  bornes: BornesEchelle,
  index: number,
  nPaliers: number,
): BornesEchelle {
  const pas = (bornes.max - bornes.min) / nPaliers;
  return { min: bornes.min + index * pas, max: bornes.min + (index + 1) * pas };
}

/**
 * Formate une valeur en unite reelle pour la legende.
 *
 * Precision adaptative, et c'est necessaire : les bornes basses valent jusqu'a
 * 0,02 log./km². Un arrondi a l'entier affichait « 0 – 0 » sur les deux
 * premieres tranches de `logements_inconnus`.
 */
export function formaterValeur(v: number): string {
  const a = Math.abs(v);
  if (!Number.isFinite(v)) return '—';
  if (a === 0)         return '0';
  if (a >= 1_000_000)  return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000)     return `${Math.round(v / 1_000)}k`;
  if (a >= 1_000)      return `${(v / 1_000).toFixed(1)}k`;
  if (a >= 100)        return String(Math.round(v));
  if (a >= 10)         return v.toFixed(1);
  if (a >= 1)          return v.toFixed(1);
  return Number(v.toPrecision(2)).toString();
}

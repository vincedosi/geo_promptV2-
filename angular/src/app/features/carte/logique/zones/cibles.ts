/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/custom-geo/cibles.ts` (imports relatifs seuls changes),
 * verrouillee par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 * Ne pas corriger un defaut ici sans le corriger dans React.
 */
/**
 * Cibles d'audience du plan média — source unique de vérité.
 *
 * Consommé par le composant (ZoneMediaPlanPanel : select groupé + libellés/unités),
 * la route de persistance (schéma Zod de geo_strategy.media_plan) et aligné sur
 * les clés `values` de la RPC compute_zone_items_audience (sql/090). Une seule
 * liste ici évite la dérive : historiquement le Zod ne connaissait que les
 * tranches d'âge, rejetant en 400 un plan ciblant ménages/logement.
 */

export type CibleKey =
  | 'total' | '0_17' | '18_24' | '25_39' | '40_54' | '55_64' | '65_79' | '80_plus'
  | 'men' | 'men_prop' | 'men_fmp' | 'men_pauv' | 'log_soc';

/** Cibles groupées par unité de volume (hab. / ménages / logements). */
export const CIBLE_GROUPS: Array<{ group: string; unit: string; options: Array<[CibleKey, string]> }> = [
  { group: 'Population (habitants)', unit: 'hab.', options: [
    ['total', 'Population totale'],
    ['0_17', '0-17 ans'], ['18_24', '18-24 ans'], ['25_39', '25-39 ans'],
    ['40_54', '40-54 ans'], ['55_64', '55-64 ans'], ['65_79', '65-79 ans'], ['80_plus', '80 ans et plus'],
  ]},
  { group: 'Ménages', unit: 'ménages', options: [
    ['men', 'Tous les ménages'],
    ['men_prop', 'Propriétaires'],
    ['men_fmp', 'Familles monoparentales'],
    ['men_pauv', 'Ménages pauvres'],
  ]},
  { group: 'Logement', unit: 'logements', options: [
    ['log_soc', 'Logements sociaux (HLM)'],
  ]},
];

/** Toutes les clés de cible, dans l'ordre — pour construire l'enum Zod côté route. */
export const CIBLE_KEYS: CibleKey[] = CIBLE_GROUPS.flatMap(g => g.options.map(([k]) => k));

export const CIBLE_UNIT: Record<CibleKey, string> = Object.fromEntries(
  CIBLE_GROUPS.flatMap(g => g.options.map(([k]) => [k, g.unit])),
) as Record<CibleKey, string>;

export const CIBLE_LABEL: Record<CibleKey, string> = Object.fromEntries(
  CIBLE_GROUPS.flatMap(g => g.options.map(([k, l]) => [k, l])),
) as Record<CibleKey, string>;

/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/carreaux/catalogue.ts` — les INDICATEURS seulement : les six palettes
 * sont déjà copiées au lot 3 (`risques/logique/palettes-donnees.ts`, ré-exportées par `palettes-donnees-carte.ts`).
 * Verrouillée par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 étendu à /map).
 * Ne pas corriger un défaut ici sans le corriger dans React.
 */

export interface CarreauxIndicateur {
  id: string;
  label: string;
  unit?: string;
  group: string;
}

export const CARREAUX_INDICATEURS: CarreauxIndicateur[] = [
  // Population
  { id: 'population_totale',       label: 'Population totale',       unit: 'pers.', group: 'Population' },
  { id: 'population_inconnue',     label: 'Population inconnue',     unit: 'pers.', group: 'Population' },
  { id: 'ind_0_3',                 label: '0-3 ans',                 unit: 'pers.', group: 'Population' },
  { id: 'ind_4_5',                 label: '4-5 ans',                 unit: 'pers.', group: 'Population' },
  { id: 'ind_6_10',                label: '6-10 ans',                unit: 'pers.', group: 'Population' },
  { id: 'ind_11_17',               label: '11-17 ans',               unit: 'pers.', group: 'Population' },
  { id: 'ind_18_24',               label: 'Jeunes 18-24 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_25_39',               label: 'Actifs 25-39 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_40_54',               label: 'Actifs 40-54 ans',        unit: 'pers.', group: 'Population' },
  { id: 'ind_55_64',               label: '55-64 ans',               unit: 'pers.', group: 'Population' },
  { id: 'ind_65_79',               label: 'Seniors 65-79 ans',       unit: 'pers.', group: 'Population' },
  { id: 'ind_80p',                 label: 'Seniors 80 ans et +',     unit: 'pers.', group: 'Population' },
  // Ménages
  { id: 'menages_total',           label: 'Ménages total',           unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_pauvres',         label: 'Ménages pauvres',         unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_1_personne',      label: 'Ménages 1 personne',      unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_5_plus',          label: 'Ménages 5+ personnes',    unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_proprietaires',   label: 'Ménages propriétaires',   unit: 'mén.',  group: 'Ménages' },
  { id: 'familles_monoparentales', label: 'Familles monoparent.',    unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_maison',          label: 'Ménages en maison',       unit: 'mén.',  group: 'Ménages' },
  { id: 'menages_collectif',       label: 'Ménages en collectif',    unit: 'mén.',  group: 'Ménages' },
  { id: 'surface_moyenne',         label: 'Surface moyenne par ménage', unit: 'm²',    group: 'Ménages' },
  // Revenus
  { id: 'revenu_median',           label: 'Revenu moyen par habitant',  unit: '€',     group: 'Revenus' },
  // Logements
  { id: 'logements_avant_1945',    label: 'Logements avant 1945',   unit: 'log.',  group: 'Logements' },
  { id: 'logements_1945_1970',     label: 'Logements 1945-1970',    unit: 'log.',  group: 'Logements' },
  { id: 'logements_1970_1990',     label: 'Logements 1970-1990',    unit: 'log.',  group: 'Logements' },
  { id: 'logements_apres_1990',    label: 'Logements après 1990',   unit: 'log.',  group: 'Logements' },
  { id: 'logements_sociaux',       label: 'Logements sociaux',      unit: 'log.',  group: 'Logements' },
  { id: 'logements_inconnus',      label: 'Logements inconnus',     unit: 'log.',  group: 'Logements' },
];

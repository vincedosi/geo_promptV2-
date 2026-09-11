/**
 * @file lib/carreaux/catalogue.ts
 *
 * Catalogue des indicateurs de carreaux et palettes de couleurs.
 *
 * Ces deux constantes vivaient dans `components/CarreauxPMTilesLayer.tsx`, un
 * composant qui n'a JAMAIS ete monte nulle part. Le fichier etait donc mort
 * comme composant mais vivant comme module : la legende reelle
 * (`CarreauxSection`), le chemin de rendu vivant (`useMapLayers`), `MapPanel`
 * et un test importaient ses catalogues. Ce double statut avait deja coute une
 * journee — un chantier entier avait ete mene dans le composant mort en
 * croyant modifier la carte.
 *
 * Le composant a ete supprime le 2026-09-11 ; ses catalogues vivent ici.
 *
 * RAPPEL : les couleurs restent en hexadecimal. Le moteur de rendu MapLibre ne
 * resout pas les variables CSS dans les expressions de peinture — c'est
 * l'exception documentee a la regle « jamais de hex en dur » du DESIGN_SYSTEM.
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

export interface CarreauxPalette {
  id: string;
  label: string;
  stops: string[]; // 6 couleurs, min → max
}

export const CARREAUX_PALETTES: CarreauxPalette[] = [
  {
    id: 'rouge',
    label: 'Rouge',
    stops: ['#FFF5F0', '#FEE0D2', '#FCBBA1', '#FC9272', '#DE2D26', '#A50F15'],
  },
  {
    id: 'bleu',
    label: 'Bleu',
    stops: ['#F7FBFF', '#C6DBEF', '#9ECAE1', '#4292C6', '#2171B5', '#08306B'],
  },
  {
    id: 'vert',
    label: 'Vert',
    stops: ['#F7FCF5', '#C7E9C0', '#74C476', '#41AB5D', '#238B45', '#00441B'],
  },
  {
    id: 'violet',
    label: 'Violet',
    stops: ['#F2F0F7', '#DADAEB', '#BCBDDC', '#9E9AC8', '#756BB1', '#54278F'],
  },
  {
    id: 'turbo',
    label: 'Turbo',
    stops: ['#30123B', '#4675ED', '#1BD0D5', '#71F656', '#FAC829', '#B10326'],
  },
  {
    id: 'plasma',
    label: 'Plasma',
    stops: ['#0D0887', '#6A00A8', '#B12A90', '#E16462', '#FCA636', '#F0F921'],
  },
];

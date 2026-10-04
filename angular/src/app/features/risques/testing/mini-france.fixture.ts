import type { Bandes } from '../data/profil-risque.api';

/**
 * Contours SYNTHÉTIQUES pour les tests de la mini-carte : des carrés de 0,4° posés sur une grille de la métropole, et
 * deux régions d'outre-mer à leur vraie place (Martinique 02, La Réunion 04). Les tests portent sur QUELS codes sont
 * dessinés, avec QUELLES valeurs — jamais sur la silhouette, que `mini-france.spec.ts` couvre déjà.
 */
function carre(code: string, nom: string, lon: number, lat: number, cote = 0.4): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { code, nom },
    geometry: {
      type: 'Polygon',
      coordinates: [[[lon, lat], [lon + cote, lat], [lon + cote, lat + cote], [lon, lat + cote], [lon, lat]]],
    },
  };
}

/** Les 96 départements métropolitains (01-95 sans 20, plus 2A et 2B). */
export const CODES_DEPTS_METRO: string[] = [
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter((c) => c !== '20'),
  '2A', '2B',
];

export const CONTOURS_DEPARTEMENTS: GeoJSON.Feature[] = CODES_DEPTS_METRO.map((code, i) =>
  carre(code, `Département ${code}`, -4.5 + (i % 12) * 1.1, 42.5 + Math.floor(i / 12) * 1.0));

const REGIONS_METRO = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94'];
export const CONTOURS_REGIONS: GeoJSON.Feature[] = [
  ...REGIONS_METRO.map((code, i) => carre(code, `Région ${code}`, -4 + (i % 5) * 2.5, 43 + Math.floor(i / 5) * 2.5, 2)),
  carre('02', 'Martinique', -61.2, 14.4, 0.4),
  carre('04', 'La Réunion', 55.2, -21.4, 0.6),
];

/** Les départements de l'Île-de-France, tels que le référentiel les range. */
export const DEPTS_IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];

/** Un résultat exploré de l'Île-de-France à la maille département — totaux SYNTHÉTIQUES, dénominateurs compris. */
export const BANDES_IDF: Bandes = {
  maille: 'departement', cible: 'ind', parent: null, region: '11', n_unites: 8, tronquee: false, n_carreaux: 800,
  total: 3600, par_classe: { 'haut:1': 3600 }, hors_zone: 0, n_codes_postaux: 40, population_reference: 0,
  pop_unites_touchees: null,
  unites: DEPTS_IDF.map((code, i) => ({
    unite: code, nom: `Département ${code}`, total: 100 * (i + 1), classes: { 'haut:1': 100 * (i + 1) },
    pop_totale: 10_000, surface_km2: 1_000,
  })),
};

/** Un résultat au CODE POSTAL : aucun dénominateur (le référentiel postal surcompte de 10,5 %). */
export const BANDES_CODES_POSTAUX: Bandes = {
  ...BANDES_IDF, maille: 'code_postal', n_unites: 2,
  unites: [
    { unite: '13001', nom: 'Marseille 1er', total: 500, classes: {}, pop_totale: null, surface_km2: null },
    { unite: '13002', nom: 'Marseille 2e', total: 200, classes: {}, pop_totale: null, surface_km2: null },
  ],
};

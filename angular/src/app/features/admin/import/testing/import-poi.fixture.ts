import type { ParseResult } from '../../logique/types/import-poi';

/**
 * Réponse de `POST /api/admin/import-poi/parse` pour `tests/fixtures/admin/poi-essai.csv` (10 POI
 * `[ESSAI lot 6]`), forme EXACTE de la route (`parse/route.ts:211-223`), colonnes et suggestion calculées
 * par `detectColumns` / `suggestMapping` (`lib/import/column-detector.ts`) sur ce fichier : `reference_panneau`
 * tombe sur `code_postal` (le candidat `code` est cherché en sous-chaîne — défaut de la route, constaté).
 * Verrouillée contre la route par `tests/unit/angular/admin-poi-fixture.test.ts`.
 */
export const ANALYSE_POI_ESSAI: ParseResult = {
  success: true,
  fileName: 'poi-essai.csv',
  fileSize: 856,
  format: 'csv',
  encoding: 'utf-8',
  separator: ';',
  totalRows: 10,
  columns: [
    { name: 'nom', sampleValues: ['[ESSAI lot 6] POI 01', '[ESSAI lot 6] POI 02', '[ESSAI lot 6] POI 03', '[ESSAI lot 6] POI 04', '[ESSAI lot 6] POI 05'], nullCount: 0 },
    { name: 'adresse', sampleValues: ['Place de l’Hôtel de Ville', 'Place Bellecour', 'Quai du Port', 'Place du Capitole', 'Place de la Comédie'], nullCount: 0 },
    { name: 'code_postal', sampleValues: ['75004', '69002', '13002', '31000', '34000'], nullCount: 0 },
    { name: 'ville', sampleValues: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Montpellier'], nullCount: 0 },
    { name: 'latitude', sampleValues: ['48.8566', '45.7578', '43.2965', '43.6045', '43.6086'], nullCount: 0 },
    { name: 'longitude', sampleValues: ['2.3522', '4.8320', '5.3698', '1.4440', '3.8798'], nullCount: 0 },
    { name: 'capacite', sampleValues: ['120', '80', '45', '200', '60'], nullCount: 0 },
    { name: 'statut', sampleValues: ['ouvert', 'ferme'], nullCount: 0 },
  ],
  preview: [
    { nom: '[ESSAI lot 6] POI 01', adresse: 'Place de l’Hôtel de Ville', code_postal: '75004', ville: 'Paris', latitude: '48.8566', longitude: '2.3522', capacite: '120', statut: 'ouvert' },
    { nom: '[ESSAI lot 6] POI 02', adresse: 'Place Bellecour', code_postal: '69002', ville: 'Lyon', latitude: '45.7578', longitude: '4.8320', capacite: '80', statut: 'ouvert' },
    { nom: '[ESSAI lot 6] POI 03', adresse: 'Quai du Port', code_postal: '13002', ville: 'Marseille', latitude: '43.2965', longitude: '5.3698', capacite: '45', statut: 'ferme' },
    { nom: '[ESSAI lot 6] POI 04', adresse: 'Place du Capitole', code_postal: '31000', ville: 'Toulouse', latitude: '43.6045', longitude: '1.4440', capacite: '200', statut: 'ouvert' },
    { nom: '[ESSAI lot 6] POI 05', adresse: 'Place de la Comédie', code_postal: '34000', ville: 'Montpellier', latitude: '43.6086', longitude: '3.8798', capacite: '60', statut: 'ouvert' },
  ],
  suggestedMapping: {
    nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'code_postal', departement: null, region: null,
    lat: 'latitude', lng: 'longitude', x: null, y: null, reference_panneau: 'code_postal', type_panneau: null, categorie: null,
  },
  fileId: '11111111-2222-3333-4444-555555555555',
};

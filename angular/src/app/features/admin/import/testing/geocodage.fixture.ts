import type { DryRunResult, GeocodeDetailedResult } from '../../logique/types/import-poi';
import type { ReponseGeocodage } from '../data/import-poi.api';

/** Un résultat de géocodage, aux champs de `GeocodeDetailedResult` (`lib/import/geocoder.ts`). */
function resultat(rowIndex: number, r: Partial<GeocodeDetailedResult>): GeocodeDetailedResult {
  return {
    rowIndex, inputAddress: '', lat: null, lng: null, score: 0, resultLabel: '', resultType: '',
    resultCity: '', resultPostcode: '', status: 'red', manualOverride: false, ...r,
  };
}

/**
 * Réponse de `POST /api/admin/geocode/batch` pour quatre lignes, une par statut et une adresse vide —
 * forme EXACTE de la route (`geocode/batch/route.ts:102-108`), dans l'ordre du fichier (la route ne trie
 * pas : c'est l'écran qui place les échecs en tête).
 */
export const GEOCODAGE_ESSAI: ReponseGeocodage = {
  success: true,
  geocodeId: '1b2c3d4e-5f60',
  totalRows: 4,
  results: [
    resultat(0, {
      inputAddress: 'Place Bellecour 69002 Lyon', lat: 45.7578, lng: 4.832, score: 0.93,
      resultLabel: 'Place Bellecour 69002 Lyon', resultType: 'street', resultCity: 'Lyon', resultPostcode: '69002', status: 'green',
    }),
    resultat(1, {
      inputAddress: 'Quai du Port 13002 Marseille', lat: 43.2965, lng: 5.3698, score: 0.45,
      resultLabel: 'Quai du Port 13002 Marseille', resultType: 'street', resultCity: 'Marseille', resultPostcode: '13002', status: 'orange',
    }),
    resultat(2, { inputAddress: 'Lieu-dit inconnu 99999', score: 0.12, status: 'red' }),
    resultat(3, { inputAddress: '', score: 0, status: 'red' }),
  ],
  stats: { green: 1, orange: 1, red: 2 },
};

/**
 * Réponse de `POST /api/admin/import-poi/dry-run` (forme de `dry-run/route.ts:84-96`) : 10 lignes testées,
 * dont 9 valides et 1 sans coordonnées, deux points d'aperçu et une erreur.
 */
export const ESSAI_A_BLANC: DryRunResult = {
  success: true,
  stats: { totalRows: 1234, testedRows: 10, validRows: 9, invalidRows: 0, missingCoords: 1 },
  samplePoints: [
    { lat: 48.8566, lng: 2.3522, nom: '[ESSAI lot 6] POI 01', ville: 'Paris' },
    { lat: 45.7578, lng: 4.832, nom: '[ESSAI lot 6] POI 02', ville: 'Lyon' },
  ],
  errors: [{ row: 7, field: 'coords', message: 'Coordonnees manquantes' }],
};

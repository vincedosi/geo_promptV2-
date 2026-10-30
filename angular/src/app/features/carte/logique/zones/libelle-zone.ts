import { TYPES_RECETTE, type TypeRecette } from './recette';
import { getSourceTypeLabel } from './source-type-labels';

/**
 * Ce que « Mes zones » affiche de la SOURCE d'une zone à recette (lot 3, T12).
 *
 * `recette.ts` et `source-type-labels.ts` sont des copies VERBATIM verrouillées par des tests de parité : on ne les
 * modifie pas ici. Ce fichier-ci les COMPLÈTE côté Angular seulement : le libellé des `source_type` que pose
 * `creer_zone_recette` (sql/253 : `'recette_' || type`, que la table de React ignore et rendait bruts, en mono).
 *
 * Le libellé d'une RECETTE (seuil sur territoires compris, avec le catalogue d'indicateurs) est `libelleRecette` de
 * `recette.ts` (revue finale du lot 3, X1) : l'ancien `libelleRecetteAffiche` d'ici, qui le doublait, est retiré.
 */

/** Le type d'une recette, en clair — puces de filtre et ligne de source. */
export const LIBELLES_TYPE_RECETTE: Readonly<Record<TypeRecette, string>> = {
  rayon_point: 'Rayon autour d’un point',
  rayon_poi: 'Rayon autour des POI',
  seuil_carreaux: 'Seuil sur carreaux',
  seuil_territoire: 'Seuil sur territoires',
  codes_postaux: 'Codes postaux',
  dessin: 'Dessin',
  import: 'Import',
  isochrone: 'Isochrones',
  combinaison: 'Combinaison',
  capture: 'Capture',
  pays: 'Zone nationale',
};

const PREFIXE = 'recette_';

/** Comme `getSourceTypeLabel`, plus les `recette_*` ; un type inconnu reste brut (`isReadable: false`). */
export function libelleSource(sourceType: string): { label: string; isReadable: boolean } {
  if (sourceType.startsWith(PREFIXE)) {
    const type = sourceType.slice(PREFIXE.length);
    if ((TYPES_RECETTE as readonly string[]).includes(type)) return { label: LIBELLES_TYPE_RECETTE[type as TypeRecette], isReadable: true };
  }
  return getSourceTypeLabel(sourceType);
}

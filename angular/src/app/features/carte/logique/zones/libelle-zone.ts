import type { IndicateurRegistre } from '../analyses/score';
import { type Recette, TYPES_RECETTE, type TypeRecette, libelleRecette } from './recette';
import { getSourceTypeLabel } from './source-type-labels';

/**
 * Ce que « Mes zones » affiche d'une zone à recette (lot 3, T12).
 *
 * `recette.ts` et `source-type-labels.ts` sont des copies VERBATIM verrouillées par des tests de parité : on ne les
 * modifie pas. Ce fichier-ci les COMPLÈTE côté Angular seulement : le libellé des `source_type` que pose
 * `creer_zone_recette` (sql/253 : `'recette_' || type`, que la table de React ignore et rendait bruts, en mono), et le
 * libellé d'un seuil sur territoires avec le nom du catalogue d'indicateurs et son unité (`libelleRecette` n'a que
 * l'identifiant : il ne lit aucun catalogue).
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

/**
 * `libelleRecette`, sauf pour un seuil sur territoires dont l'indicateur est au catalogue : son libellé (initiale en
 * minuscule, comme le seuil sur carreaux) et son unité. Sans catalogue (pas encore lu, ou indicateur retiré du
 * registre), le libellé de base — l'identifiant — plutôt que rien.
 */
export function libelleRecetteAffiche(r: Recette, catalogue: readonly IndicateurRegistre[]): string {
  if (r.type !== 'seuil_territoire') return libelleRecette(r);
  const i = catalogue.find((x) => x.indicator_code === r.indicateur);
  if (!i) return libelleRecette(r);
  const nom = i.label.charAt(0).toLowerCase() + i.label.slice(1);
  const seuil = String(r.seuil).replace('.', ',');
  return `Territoires où ${nom} ${r.operateur === '>=' ? '≥' : '≤'} ${seuil} ${i.unit ?? ''}`.trim();
}

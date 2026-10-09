/**
 * lib/espaces/nom-espace.ts
 * Le nom d'un espace tel qu'on l'AFFICHE.
 *
 * « GENESIS (Global) » est l'organisation qui possède les données de
 * dentsu.explore. Renommée à l'affichage seulement (décision Q1 du
 * 2026-10-08) : la base garde son nom et son slug, que des scripts et la démo
 * (lib/demo/constants.ts) lisent. Un seul endroit pour cette règle — l'écran
 * ne la réécrit pas, il lit `nom_affiche`.
 */
export const SLUG_ORGANISATION_INTERNE = 'genesis-global';

export function nomAffiche(org: { name: string; slug: string }): string {
  return org.slug === SLUG_ORGANISATION_INTERNE ? 'dentsu.explore (interne)' : org.name;
}

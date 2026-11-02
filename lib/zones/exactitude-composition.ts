/**
 * @file lib/zones/exactitude-composition.ts — B15 : l'exactitude PAR COMPOSITION. Une zone qui est l'union d'unités
 * entières (`unites_constitutives` de la recette : un seuil sur territoires, une capture de score au CP, une liste de
 * CP) est exacte dans la maille de ces unités, quel que soit le type de recette. Logique PURE, sans I/O, aux mêmes
 * contraintes que `conversion.ts`.
 *
 * Copie Angular : angular/src/app/features/carte/logique/jeu/exactitude-composition.ts, identique hors de cet en-tête
 * et des chemins d'import (parité verrouillée par tests/unit/angular/conversion-paritaire.test.ts).
 */
// Cycle assumé avec `conversion.ts` (qui importe `exacteParComposition`) : fonctions seules, lues à l'appel.
import { estRetenue, type Avertissement, type LigneSeuil } from './conversion';
import type { PlateformeGeo } from './plateformes';
import type { Recette, UnitesConstitutives } from './recette';

type Maille = PlateformeGeo['maille'];

/** Les unités constitutives de la recette, ou `null` (forme dessinée, rayon, zone d'avant B15 : aucune liste gardée). */
export function unitesConstitutives(recette: Recette | null): UnitesConstitutives | null {
  if (recette?.type !== 'seuil_territoire' && recette?.type !== 'capture' && recette?.type !== 'codes_postaux') return null;
  const u = recette.unites_constitutives;
  return u && u.codes.length > 0 ? u : null;
}

/**
 * La zone est-elle EXACTEMENT l'union d'unités de cette maille ? Au CP, seulement si aucun groupe de CP indiscernables
 * n'est présent en partie : la plateforme achète le groupe entier (A2), la liste n'est plus la zone achetée. Le compte
 * `groupes_partiels` est posé par la base (sql/320) ; absent, il est inconnu et la zone n'est pas certifiée exacte.
 */
export function exacteParComposition(recette: Recette | null, maille: Maille): boolean {
  const u = unitesConstitutives(recette);
  if (!u || u.maille !== maille) return false;
  return maille !== 'cp' || u.groupes_partiels === 0;
}

/**
 * L'ajustement d'une liste de CP qui contient un groupe indiscernable en partie, dit avant/après (règle 5) : `limite`
 * les codes de la liste (avant), `valeur` ces codes PLUS les membres que les groupes partiels ajoutent (après), `n` les
 * groupes complétés. Round 1 (M-1) : les CP voisins retenus par le seuil ne sont pas comptés — seules les unités
 * retenues dont un membre est dans la liste et un autre absent. Rien hors du CP, ou sans groupe partiel.
 */
export function avertissementsComposition(
  recette: Recette | null, maille: Maille, lignes: readonly LigneSeuil[], seuil: number,
): Avertissement[] {
  const u = unitesConstitutives(recette);
  if (maille !== 'cp' || u?.maille !== 'cp' || !u.groupes_partiels) return [];
  const liste = new Set(u.codes);
  let n = 0;
  let ajoutes = 0;
  for (const l of lignes) {
    if (!estRetenue(l, seuil)) continue;
    const absents = (l.membres ?? []).filter((m) => !liste.has(m)).length;
    if (absents === 0 || absents === (l.membres ?? []).length) continue;
    n += 1;
    ajoutes += absents;
  }
  return n === 0 ? [] : [{ code: 'groupes_cp_partiels', limite: liste.size, valeur: liste.size + ajoutes, n }];
}

/**
 * ⑤ Jeu de zones — B15 : l'exactitude par composition (unités constitutives de la recette). COPIE de
 * `lib/zones/exactitude-composition.ts` : `tests/unit/angular/conversion-paritaire.test.ts` exige le même corps, mot
 * pour mot ; seuls cet en-tête et les chemins d'import diffèrent. Aucun import d'Angular.
 */
import type { Avertissement, Resume } from './conversion';
import type { PlateformeGeo } from './plateformes';
import type { Recette, UnitesConstitutives } from '../zones/recette';

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
 * les codes de la liste (avant), `valeur` les codes achetés (après, groupes développés, `n_codes` du bilan calculé),
 * `n` les groupes complétés. Rien pour une autre maille, une maille exacte, ou sans groupe partiel.
 */
export function avertissementsComposition(recette: Recette | null, maille: Maille, resume: Resume): Avertissement[] {
  const u = unitesConstitutives(recette);
  if (resume.exacte || maille !== 'cp' || u?.maille !== 'cp' || !u.groupes_partiels) return [];
  return [{ code: 'groupes_cp_partiels', limite: new Set(u.codes).size, valeur: resume.n_codes ?? resume.n_unites, n: u.groupes_partiels }];
}

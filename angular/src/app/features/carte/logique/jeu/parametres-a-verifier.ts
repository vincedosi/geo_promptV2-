/**
 * ⑤ Jeu de zones — les BORNES d'une ligne de `plateformes_geo` déclarées « à vérifier » (`parametres_a_verifier`,
 * amendement E9), chacune à côté de sa valeur, ou « non relevé » quand la base n'en porte aucune (C28 : DV360, CP par
 * liste, cercles par liste de proximité, rayon maximal). Logique PURE, affichage seulement : aucune règle n'en dépend
 * (la sûreté d'une maille se lit dans `mailleSure`, conversion-defaut.ts). Les règles qui ne sont pas des bornes
 * (`poids_groupe_cp`, comportements des minimums) ne s'y disent pas : elles ont leur propre avertissement.
 */
import { formaterNombre } from '../../../../core/format/nombre';
import { M_PAR_KM } from './ecran';
import type { PlateformeGeo } from './plateformes';

type Borne = keyof PlateformeGeo['limites'];

/** Les bornes dites, dans l'ordre d'affichage ; `max_unites` prend le nom des unités de la maille. */
const BORNES: readonly Borne[] = ['max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe'];

const LIBELLES: Record<Exclude<Borne, 'max_unites'>, string> = {
  rayon_min_m: 'rayon minimal', rayon_max_m: 'rayon maximal', pop_min_unite: 'population minimale par unité',
  pop_min_groupe: 'population minimale par groupe', max_sommets: 'sommets maximaux',
};

const UNITES_PAR_LISTE: Partial<Record<PlateformeGeo['maille'], string>> = {
  cp: 'codes postaux par liste', cercle: 'cercles par liste', commune: 'communes par groupe',
  departement: 'départements par groupe', iris: 'IRIS par liste',
};

function valeur(b: Borne, v: number | undefined): string {
  if (v === undefined) return 'non relevé';
  return b === 'rayon_min_m' || b === 'rayon_max_m' ? `${formaterNombre(v / M_PAR_KM)} km` : formaterNombre(v);
}

/** « À vérifier : cercles par liste, non relevé ; rayon maximal, non relevé. » ; `null` si aucune borne n'est à vérifier. */
export function texteParametresAVerifier(ligne: PlateformeGeo | undefined): string | null {
  const verifier: readonly string[] = ligne?.parametres_a_verifier ?? [];
  if (!ligne) return null;
  const morceaux = BORNES.filter((b) => verifier.includes(b)).map((b) => {
    const nom = b === 'max_unites' ? UNITES_PAR_LISTE[ligne.maille] ?? 'unités par liste' : LIBELLES[b];
    return `${nom}, ${valeur(b, ligne.limites[b])}`;
  });
  return morceaux.length ? `À vérifier : ${morceaux.join(' ; ')}.` : null;
}

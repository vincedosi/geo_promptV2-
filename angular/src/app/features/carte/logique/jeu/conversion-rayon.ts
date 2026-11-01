/**
 * ⑤ Jeu de zones — B8 (ARB-5) : le rayon d'une recette hors des bornes d'une plateforme, dit avant/après. COPIE de
 * `lib/zones/conversion-rayon.ts` : `tests/unit/angular/conversion-paritaire.test.ts` exige le même corps, mot pour
 * mot ; seuls cet en-tête et les chemins d'import diffèrent. Aucun import d'Angular.
 */
import { rayonAdmis, type Avertissement } from './conversion';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from '../zones/recette';

/**
 * Le rayon de la recette (autour d'un point ou de POI) hors des bornes de rayon de la ligne cercle de la plateforme
 * (`limites.rayon_min_m` / `rayon_max_m`) : les cercles achetés n'ont pas le rayon de la recette (`rayonChoisi`, sinon
 * la borne — le défaut de l'écran, `rayonParDefaut`). La recette n'est PAS modifiée : l'avertissement dit l'avant
 * (`valeur`), l'après (`rayon_m`), la borne (`limite`) et la plateforme ; `exactitude` rend « calculée »
 * (`rayonAdmis`) — la perte est celle du pavage (`paver_cercles`, sql/311), la même que pour tout cercle calculé.
 * Une recette 500 m sur DV360 (minimum 1 km) : `rayon_min`, 500 → 1 000. « À vérifier » : porté par le PARAMÈTRE de
 * la borne (`parametres_a_verifier`, amendement E9). Rien pour une autre maille, une recette sans rayon, une ligne
 * absente ou un rayon dans les bornes.
 */
export function avertissementsRayon(
  recette: Recette | null, maille: PlateformeGeo['maille'], ligne?: PlateformeGeo, rayonChoisi?: number,
): Avertissement[] {
  if (maille !== 'cercle' || !ligne || (recette?.type !== 'rayon_point' && recette?.type !== 'rayon_poi')) return [];
  if (rayonAdmis(recette.rayon_m, ligne)) return [];
  const { rayon_min_m, rayon_max_m } = ligne.limites;
  const sousMin = rayon_min_m !== undefined && recette.rayon_m < rayon_min_m;
  // Hors bornes et pas sous le minimum : au-dessus du maximum, qui existe donc.
  const borne = (sousMin ? rayon_min_m : rayon_max_m) as number;
  const parametre = sousMin ? 'rayon_min_m' : 'rayon_max_m';
  return [{
    code: sousMin ? 'rayon_min' : 'rayon_max', limite: borne, valeur: recette.rayon_m, rayon_m: rayonChoisi ?? borne,
    plateforme: ligne.plateforme, ...(ligne.parametres_a_verifier?.includes(parametre) ? { a_verifier: true as const } : {}),
  }];
}

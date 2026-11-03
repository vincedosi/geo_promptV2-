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
 *
 * C29 : la ligne lue est celle de {@link regleCategorieSpeciale} — en catégorie d'annonces spéciale, le minimum est la
 * borne spéciale, et l'avertissement le dit (`categorie_speciale`, « à vérifier » de CE paramètre). Et un rayon CHOISI
 * hors des bornes (toute recette : une zone dessinée pavée à 5 km quand la case relève le minimum à 15 km) se dit
 * aussi, en `refus` (l'extraction refuse ce choix, `refusDuChoix`) : avant le choisi, après la borne.
 */
export function avertissementsRayon(
  recette: Recette | null, maille: PlateformeGeo['maille'], ligne?: PlateformeGeo, rayonChoisi?: number,
): Avertissement[] {
  if (maille !== 'cercle' || !ligne || !recette) return [];
  const aRayon = recette.type === 'rayon_point' || recette.type === 'rayon_poi';
  if (aRayon && !rayonAdmis(recette.rayon_m, ligne)) return [horsBornes(ligne, recette.rayon_m, rayonChoisi)];
  if (rayonChoisi !== undefined && !rayonAdmis(rayonChoisi, ligne)) return [{ ...horsBornes(ligne, rayonChoisi), refus: true }];
  return [];
}

/** L'avertissement d'un rayon hors des bornes de la ligne : la borne franchie, l'avant (`valeur`), l'après (`rayon_m`). */
function horsBornes(ligne: PlateformeGeo, valeur: number, rayonChoisi?: number): Avertissement {
  const { rayon_min_m, rayon_max_m, rayon_min_categorie_speciale } = ligne.limites;
  const sousMin = rayon_min_m !== undefined && valeur < rayon_min_m;
  // Hors bornes et pas sous le minimum : au-dessus du maximum, qui existe donc.
  const borne = (sousMin ? rayon_min_m : rayon_max_m) as number;
  // C29 : le minimum est la borne spéciale (posée par `regleCategorieSpeciale`) — c'est elle qui est dite.
  const speciale = sousMin && rayon_min_categorie_speciale === borne;
  const parametre = speciale ? 'rayon_min_categorie_speciale' : sousMin ? 'rayon_min_m' : 'rayon_max_m';
  return {
    code: sousMin ? 'rayon_min' : 'rayon_max', limite: borne, valeur, rayon_m: rayonChoisi ?? borne,
    plateforme: ligne.plateforme, ...(ligne.parametres_a_verifier?.includes(parametre) ? { a_verifier: true as const } : {}),
    ...(speciale ? { categorie_speciale: true as const } : {}),
  };
}

/**
 * C29 : la ligne telle que la règle de rayon minimum la lit pour un jeu coché « catégorie spéciale »
 * (`zone_sets.categorie_speciale`, sql/329) — rayon minimal effectif = le plus grand de `rayon_min_m` et de
 * `limites.rayon_min_categorie_speciale` (Meta : 15 km, relevé du 24/10). Case décochée, ligne sans borne spéciale, ou
 * borne spéciale déjà couverte par le minimum ordinaire : la ligne TELLE QUELLE (même objet). Appliquée là où la ligne
 * se lit (registre de l'écran, règles de l'extraction et de l'enregistrement), pour que toute règle qui lit
 * `rayon_min_m` (bornes, exactitude, réglette, rayon par défaut) suive sans le savoir.
 */
export function regleCategorieSpeciale(ligne: PlateformeGeo, categorieSpeciale: boolean): PlateformeGeo {
  const { rayon_min_categorie_speciale: speciale, rayon_min_m: ordinaire } = ligne.limites;
  if (!categorieSpeciale || speciale === undefined || (ordinaire !== undefined && ordinaire >= speciale)) return ligne;
  return { ...ligne, limites: { ...ligne.limites, rayon_min_m: speciale } };
}

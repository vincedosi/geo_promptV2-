/**
 * @file lib/isochrones/borne-nationale.ts — ce qu'une bataille d'isochrones peut calculer EN DIRECT quand elle n'a
 * aucun territoire (France métropolitaine ou France entière ; retours du 26/10, T2).
 *
 * Aucune borne PRODUIT sur le nombre de points (Vincent, 26/10, Q-1 : « on limite pas ! »). Les deux bornes ci-dessous
 * sont TECHNIQUES et ne refusent jamais un besoin : au-delà, le message promet le calcul en tâche de fond (lot différé
 * « calculs longs »). Une bataille ne se découpe pas en paquets : le territoire de chaque point dépend des autres.
 *
 * Sans I/O. `formaterNombre` est importé en chemin RELATIF : le fichier est recopié côté Angular, seuls les imports
 * changent (parité verrouillée par `tests/unit/angular/borne-nationale-paritaire.test.ts`, lot T4).
 */
import { formaterNombre } from '../format/nombre';

/**
 * Anneaux (points × paliers) que `get_isochrone_battle` calcule sous les 60 s de Kong. Mesures du 26/10, base locale :
 * CIRFA 95 × 3 = 285 anneaux → 7,1 s ; BMW 160 × 4 = 640 → 28,3 s ; CIRFA 95 × 7 = 665 → 44,7 s (80 Mo de fichiers
 * temporaires). Le coût croît plus vite que le nombre d'anneaux.
 */
export const CAPACITE_SYNCHRONE_ANNEAUX = 700;

/**
 * POI lus par la route V2 et par la vérification du cache (`limit`). Au-delà, le compte lu est faux (tronqué) : on
 * écrit « 500 POI ou plus », et le calcul ne part pas en direct.
 */
export const PLAFOND_LECTURE_POI = 500;

/** Le territoire d'une bataille, tel que le reçoivent les routes (`filtre_ville`, `filtre_regions`, `filtre_depts`). */
export interface TerritoireBataille {
  readonly filtre_ville?: string | null;
  readonly filtre_regions?: readonly string[] | null;
  readonly filtre_depts?: readonly (string | number)[] | null;
}

/** Vrai quand la bataille n'a ni ville, ni région, ni département : la borne ne s'applique qu'alors. */
export function sansTerritoire(t: TerritoireBataille): boolean {
  return !t.filtre_ville?.trim() && !t.filtre_regions?.length && !t.filtre_depts?.length;
}

/**
 * Le message quand la bataille dépasse ce qu'on calcule en direct, sinon `null`.
 *
 * @param points  POI lus (au plus `PLAFOND_LECTURE_POI`).
 * @param paliers Paliers demandés.
 * @param anneaux Anneaux réellement trouvés en cache (route V2, après lecture) ; par défaut `points × paliers` (écran,
 *                avant lecture). Un palier absent du cache n'est pas calculé : seul le compte lu fait foi.
 */
export function refusBorneNationale(points: number, paliers: number, anneaux: number = points * paliers): string | null {
  const lectureTronquee = points >= PLAFOND_LECTURE_POI;
  if (!lectureTronquee && anneaux <= CAPACITE_SYNCHRONE_ANNEAUX) return null;

  const ouPlus = lectureTronquee ? ' ou plus' : '';
  const p = `${formaterNombre(paliers)} ${paliers > 1 ? 'paliers' : 'palier'}`;
  const a = `${formaterNombre(anneaux)} anneaux`;
  const calcul = anneaux === points * paliers
    ? `${formaterNombre(points)} POI${ouPlus} × ${p} = ${a}${ouPlus}`
    : `${formaterNombre(points)} POI${ouPlus} × ${p} : ${a} en cache`;
  return `Ce calcul (${calcul}) dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond dès le lot `
    + '« calculs longs » ; en attendant, retirez des paliers ou choisissez une région.';
}

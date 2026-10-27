/**
 * Copie Angular (retours du 26/10, T4) VERBATIM de `lib/isochrones/borne-nationale.ts` (hors cet en-tête ; seul le
 * chemin d'import de `formaterNombre` change), verrouillée par `tests/unit/angular/borne-nationale-paritaire.test.ts`.
 * Ne pas l'éditer seule : modifier le serveur, puis recopier.
 *
 * @file borne-nationale.ts — ce qu'une bataille d'isochrones peut calculer EN DIRECT. L'écran (`ContexteBatailleService
 * .verifierBorne`) se règle sur `points × paliers` : il prévoit la bataille COMPLÈTE, là où la route V2 ne compte que les
 * anneaux trouvés en cache (relecture 1, point 2).
 */
import { formaterNombre } from '../../../../core/format/nombre';

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
 * Bataille SANS territoire : le message quand elle dépasse ce qu'on calcule en direct, sinon `null`. Deux limites :
 * la lecture tronquée (500 POI lus) et la capacité de 700 anneaux.
 *
 * @param points  POI lus (au plus `PLAFOND_LECTURE_POI`).
 * @param paliers Paliers demandés.
 * @param anneaux Anneaux réellement trouvés en cache (route V2, après lecture) ; par défaut `points × paliers` (écran,
 *                avant lecture). Un palier absent du cache n'est pas calculé : seul le compte lu fait foi.
 */
export function refusBorneNationale(points: number, paliers: number, anneaux: number = points * paliers): string | null {
  return points >= PLAFOND_LECTURE_POI ? messageTacheDeFond(points, paliers, anneaux) : refusCapaciteAnneaux(points, paliers, anneaux);
}

/**
 * TOUT périmètre (local comme national ; relecture 1, I-2) : le message quand les anneaux dépassent la capacité
 * synchrone, sinon `null`. La capacité décrit le calcul (`get_isochrone_battle`), pas le périmètre : une bataille
 * locale de 150 lycées × 7 paliers (1 050 anneaux) passe les 60 s de Kong comme une nationale.
 */
export function refusCapaciteAnneaux(points: number, paliers: number, anneaux: number = points * paliers): string | null {
  return anneaux > CAPACITE_SYNCHRONE_ANNEAUX ? messageTacheDeFond(points, paliers, anneaux) : null;
}

/** « Ce calcul (N POI × P paliers = A anneaux) dépasse ce qu'on peut calculer en direct… » (Vincent, 26/10, Q-1). */
function messageTacheDeFond(points: number, paliers: number, anneaux: number): string {
  const ouPlus = points >= PLAFOND_LECTURE_POI ? ' ou plus' : '';
  const p = `${formaterNombre(paliers)} ${paliers > 1 ? 'paliers' : 'palier'}`;
  const a = `${formaterNombre(anneaux)} anneaux`;
  const calcul = anneaux === points * paliers
    ? `${formaterNombre(points)} POI${ouPlus} × ${p} = ${a}${ouPlus}`
    : `${formaterNombre(points)} POI${ouPlus} × ${p} : ${a} en cache`;
  return `Ce calcul (${calcul}) dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond dès le lot `
    + '« calculs longs » ; en attendant, retirez des paliers ou choisissez une région.';
}

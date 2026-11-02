/**
 * ⑤ Jeu de zones — B13 : les minimums de population par unité et par groupe, comportement lu dans le registre. COPIE
 * de `lib/zones/conversion-population.ts` : `tests/unit/angular/conversion-paritaire.test.ts` exige le même corps, mot
 * pour mot ; seuls cet en-tête et les chemins d'import diffèrent. Aucun import d'Angular.
 */
import type { Avertissement } from './conversion';
import type { COMPORTEMENTS_POPULATION, PlateformeGeo } from './plateformes';

/** Un comportement de minimum (`COMPORTEMENTS_POPULATION`, CHECK `plateformes_geo_pop_min_comportements`, sql/318). */
type ComportementPopulation = (typeof COMPORTEMENTS_POPULATION)[number];

/** Un minimum de la ligne : sa valeur, son comportement, et s'il est « à vérifier » (valeur OU comportement, E9). */
interface Minimum { limite: number; comportement: ComportementPopulation; a_verifier: boolean }

/**
 * Le minimum de la ligne pour une portée, ou `null` si la plateforme n'en a pas (Meta). Un comportement absent (ligne
 * d'avant sql/318, ou limite posée sans lui — la base l'admet pour le rejeu du seed) vaut `avertissement` : jamais un
 * refus que le registre ne dit pas, jamais un minimum tu.
 */
export function minimumPopulation(ligne: PlateformeGeo, portee: 'unite' | 'groupe'): Minimum | null {
  const limite = portee === 'unite' ? ligne.limites.pop_min_unite : ligne.limites.pop_min_groupe;
  if (limite === undefined) return null;
  const lu = portee === 'unite' ? ligne.pop_min_unite_comportement : ligne.pop_min_groupe_comportement;
  const verifier: readonly string[] = ligne.parametres_a_verifier ?? [];
  return {
    limite,
    comportement: lu ?? 'avertissement',
    a_verifier: verifier.includes(`pop_min_${portee}`) || verifier.includes(`pop_min_${portee}_comportement`),
  };
}

/**
 * `p_pop_min` de `paver_cercles` : le minimum par unité quand il REFUSE (la cellule sous le minimum n'est pas
 * retenue, filtre dur), sinon `undefined` — la RPC garde son défaut (0), et `controlerPopulation` dit les cercles
 * sous le minimum.
 */
export function popMinPavage(ligne: PlateformeGeo): number | undefined {
  const m = minimumPopulation(ligne, 'unite');
  return m?.comportement === 'refus' ? m.limite : undefined;
}

/** Ce que les minimums disent d'un bilan : un refus (le premier rencontré), ou des avertissements. */
export interface ControlePopulation { refus: Avertissement | null; avertissements: Avertissement[] }

/**
 * LE contrôle des minimums, le même pour toutes les mailles, cercle exact unique compris (B13) :
 * - par unité : `populations` sont celles des unités RETENUES (une par cercle, une pour le cercle exact ou le
 *   polygone, une par territoire) ; une population inconnue (`null`, A4) ou absente ne se compare à rien. Les unités
 *   sous le minimum sont dites en une fois : `n` unités, `valeur` la moins peuplée, `limite` le minimum ;
 * - par groupe : `achetee`, la diffusion achetée entière. Une diffusion qui compte des unités à population inconnue
 *   (`n_inconnues`, A4) n'a pas de population connue : aucune comparaison (relecture A4, M-1 — sinon « 0 personne
 *   achetée » sur une sélection entièrement non carroyée).
 * Le comportement du registre décide : `refus` (marqué `refus: true`, l'extraction est refusée) ou `avertissement`.
 */
export function controlerPopulation(
  bilan: { achetee: number; n_inconnues?: number }, populations: readonly (number | null | undefined)[], ligne: PlateformeGeo,
): ControlePopulation {
  const sortie: ControlePopulation = { refus: null, avertissements: [] };
  const dire = (a: Avertissement, m: Minimum) => {
    const complet: Avertissement = { ...a, plateforme: ligne.plateforme, ...(m.a_verifier ? { a_verifier: true as const } : {}) };
    if (m.comportement === 'avertissement') sortie.avertissements.push(complet);
    else sortie.refus ??= { ...complet, refus: true };
  };
  const unite = minimumPopulation(ligne, 'unite');
  if (unite) {
    const sous = populations.filter((p): p is number => typeof p === 'number' && p < unite.limite);
    if (sous.length > 0) dire({ code: 'pop_min_unite', limite: unite.limite, valeur: Math.min(...sous), n: sous.length }, unite);
  }
  const groupe = minimumPopulation(ligne, 'groupe');
  if (groupe && !bilan.n_inconnues && bilan.achetee < groupe.limite) {
    dire({ code: 'pop_min_groupe', limite: groupe.limite, valeur: bilan.achetee }, groupe);
  }
  return sortie;
}

/**
 * Règle 5 : les cercles que le minimum par cercle a ÉCARTÉS au pavage (`ecartes_pop_min` de `paver_cercles`, sql/318)
 * — `n` cercles qui passaient le seuil, `valeur` le plus peuplé de leurs disques, `limite` le minimum. Rien si aucun
 * n'a été écarté (ou réponse d'avant sql/318).
 */
export function avertissementsEcartes(
  ecartes: { n_cercles: number; population_max: number | null } | undefined, ligne: PlateformeGeo,
): Avertissement[] {
  const m = minimumPopulation(ligne, 'unite');
  if (!m || !ecartes || ecartes.n_cercles === 0) return [];
  return [{
    code: 'pop_min_unite', limite: m.limite, valeur: ecartes.population_max ?? 0, n: ecartes.n_cercles, ecartes: true,
    plateforme: ligne.plateforme, ...(m.a_verifier ? { a_verifier: true as const } : {}),
  }];
}

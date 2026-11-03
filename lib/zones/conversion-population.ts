/**
 * @file lib/zones/conversion-population.ts — B13 : les minimums de population d'une plateforme, PAR UNITÉ
 * (`limites.pop_min_unite`) et PAR GROUPE (`limites.pop_min_groupe`, la diffusion achetée entière), chacun avec son
 * comportement LU dans le registre (`pop_min_unite_comportement`, `pop_min_groupe_comportement`, sql/318) : `refus` ou
 * `avertissement`. Logique PURE, sans I/O, aux mêmes contraintes que `conversion.ts` (types seulement à l'import ;
 * aucune limite ni aucun comportement de plateforme écrit ici).
 *
 * Copie Angular : angular/src/app/features/carte/logique/jeu/conversion-population.ts, identique hors de cet en-tête
 * et des chemins d'import (parité verrouillée par tests/unit/angular/conversion-paritaire.test.ts).
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
 *   polygone, une par territoire) ; absente (`undefined` : liste de CP) = rien à comparer. Les unités sous le minimum
 *   sont dites en une fois : `n` unités, `valeur` la moins peuplée, `limite` le minimum. Une population INCONNUE
 *   (`null`, ARB-3 / A4 — territoire non carroyé) ne se compare pas : `non_verifiable`, `n` unités, toujours un
 *   avertissement (jamais un refus, ni un « 0 habitant », sur une donnée absente — relecture B13, I-1) ;
 * C24 round 1 (I-1) : populations et diffusion en POPULATION TOTALE (l'audience réelle de la plateforme), jamais dans la
 *   cible — l'appelant passe `pop_totale_ind` / `population_ind` quand ils existent.
 * - par groupe : `achetee`, la diffusion achetée CONNUE (`diffusion_population_totale` si la part est sur une cible). Avec des unités à population inconnue (`n_inconnues`), la
 *   part connue qui atteint déjà le minimum le valide ; sinon `non_verifiable` (`valeur` la part connue, `n` les
 *   unités inconnues), toujours un avertissement (relecture B13, I-2 ; ruling du contrôleur).
 *   B14 round 1 (I-1) : une maille découpée en blocs (`decoupage`, ARB-6) envoie chaque BLOC comme un groupe — le
 *   minimum se contrôle bloc par bloc (`bloc` nomme le bloc), jamais sur la maille entière ; aucun rééquilibrage.
 * Le comportement du registre décide du reste : `refus` (marqué `refus: true`, l'extraction est refusée) ou
 * `avertissement`.
 */
export function controlerPopulation(
  bilan: {
    achetee: number; diffusion_population_totale?: number; n_inconnues?: number;
    decoupage?: { blocs: readonly { numero: number; achetee: number; diffusion_population_totale?: number; n_inconnues?: number }[] };
  },
  populations: readonly (number | null | undefined)[], ligne: PlateformeGeo,
): ControlePopulation {
  const sortie: ControlePopulation = { refus: null, avertissements: [] };
  const dire = (a: Avertissement, m: Minimum) => {
    const complet: Avertissement = { ...a, plateforme: ligne.plateforme, ...(m.a_verifier ? { a_verifier: true as const } : {}) };
    if (m.comportement === 'avertissement') sortie.avertissements.push(complet);
    else sortie.refus ??= { ...complet, refus: true };
  };
  // Une population inconnue : toujours un avertissement, quel que soit le comportement du registre.
  const nonVerifiable = (a: Avertissement, m: Minimum) => sortie.avertissements.push({
    ...a, non_verifiable: true, plateforme: ligne.plateforme, ...(m.a_verifier ? { a_verifier: true as const } : {}),
  });
  const unite = minimumPopulation(ligne, 'unite');
  if (unite) {
    const sous = populations.filter((p): p is number => typeof p === 'number' && p < unite.limite);
    if (sous.length > 0) dire({ code: 'pop_min_unite', limite: unite.limite, valeur: Math.min(...sous), n: sous.length }, unite);
    const inconnues = populations.filter((p) => p === null).length;
    if (inconnues > 0) nonVerifiable({ code: 'pop_min_unite', limite: unite.limite, valeur: 0, n: inconnues }, unite);
  }
  const groupe = minimumPopulation(ligne, 'groupe');
  const groupes = bilan.decoupage?.blocs ?? [{ ...bilan, numero: undefined }];
  for (const g of groupe ? groupes : []) {
    // C24 round 1 (I-1) : l'audience RÉELLE — la diffusion en population totale quand la part est sur une cible.
    const diffusion = g.diffusion_population_totale ?? g.achetee;
    if (!groupe || diffusion >= groupe.limite) continue;
    const a: Avertissement = { code: 'pop_min_groupe', limite: groupe.limite, valeur: diffusion, ...(g.numero !== undefined ? { bloc: g.numero } : {}) };
    if (g.n_inconnues) nonVerifiable({ ...a, n: g.n_inconnues }, groupe);
    else dire(a, groupe);
  }
  return sortie;
}

/**
 * La population d'une forme achetée telle quelle (cercle exact, polygone) : `null` — INCONNUE, jamais 0 (ARB-3) — dès
 * que la forme touche un territoire non carroyé (`motif_vide`, `territoires_non_carroyes` de `couverture_zone`) : sa
 * population carroyée n'en compte alors qu'une partie, ou rien (relecture B13, I-1).
 */
export function populationDeForme(
  f: { population: number; motif_vide?: string | null; territoires_non_carroyes?: readonly unknown[] | null },
): number | null {
  return f.motif_vide === 'territoire_non_carroye' || (f.territoires_non_carroyes?.length ?? 0) > 0 ? null : f.population;
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

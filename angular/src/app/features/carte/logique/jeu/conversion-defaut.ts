/**
 * ⑤ Jeu de zones — B9 (ARB-7 = A, amendement E1) : la maille par défaut sur les bilans SIMULÉS des mailles candidates.
 * COPIE de `lib/zones/conversion-defaut.ts` : `tests/unit/angular/conversion-paritaire.test.ts` exige le même corps,
 * mot pour mot ; seuls cet en-tête et les chemins d'import diffèrent. Aucun import d'Angular.
 */
import { exactitude, mailleSansObjet, type Resume } from './conversion';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from '../zones/recette';

type Maille = PlateformeGeo['maille'];
type Plateforme = PlateformeGeo['plateforme'];

/** Les deux réglages de la règle (`reglages_conversion`, sql/315) : en % de la population de la zone, en points de taux utile. */
export interface ReglagesDefaut {
  couverture_cible: number;
  ecart_departage: number;
}

/**
 * Le REPLI, et lui seul : les valeurs que sql/315 pose en base, prises quand la lecture des réglages échoue ou qu'une
 * clé manque (la route le dit au journal, `lireReglagesDefaut`). La règle lit toujours ce qu'on lui passe.
 */
export const REGLAGES_DEFAUT_REPLI: ReglagesDefaut = { couverture_cible: 80, ecart_departage: 5 };

/** Le bilan simulé d'une maille : sa couverture (part de la population de la zone retenue, en %) et son taux utile. */
export interface Simulation {
  couverture: number;
  taux_utile: number | null;
}

/** Les simulations lues d'une plateforme, par maille ; `refusee` : lecture refusée ou en échec, la maille sort de la course. */
export type Simulations = Partial<Record<Maille, Simulation | 'refusee'>>;

/** La simulation d'un bilan : couverture = habitants couverts ÷ population de la zone (`manques + couverte`), au dixième. */
export function simulationDe(resume: Resume): Simulation {
  const population = resume.manques + resume.couverte;
  return {
    couverture: population > 0 ? Math.round((resume.couverte / population) * 1000) / 10 : 0,
    taux_utile: resume.taux_utile,
  };
}

/** Le bilan d'une maille EXACTE pour la recette (A-6) : rien n'est perdu, aucune lecture n'est nécessaire. */
const EXACTE: Simulation = { couverture: 100, taux_utile: 100 };

/**
 * Amendement E9 : les paramètres « à vérifier » qui conditionnent la MAILLE — bornes de rayon et plafond d'unités ;
 * « achetable » est la ligne entière (`a_verifier`). La plage de poids (`poids_groupe_cp`) n'en est pas : DV360 / CP,
 * dont seule la plage est à vérifier, reste une maille sûre.
 */
const PARAMETRES_DE_MAILLE = ['max_unites', 'rayon_min_m', 'rayon_max_m'] as const;

/** La maille est-elle sûre (E9) ? Ni la ligne, ni aucun paramètre qui la conditionne, n'est « à vérifier ». */
export function mailleSure(l: PlateformeGeo): boolean {
  return !l.a_verifier && !(l.parametres_a_verifier ?? []).some((p) => (PARAMETRES_DE_MAILLE as readonly string[]).includes(p));
}

/**
 * De la plus fine à la plus grossière. Le cercle avant la commune : son rayon se règle, une commune ne se découpe
 * pas. L'IRIS n'est acheté par aucune plateforme au 24/10 (A-5) ; il prend son rang si une ligne le porte un jour.
 * Le pays en DERNIER (⑤ finitions, A-4) : il n'est jamais le défaut d'une zone qui n'est pas nationale.
 */
const FINESSE: readonly Maille[] = ['polygone', 'iris', 'cp', 'cercle', 'commune', 'departement', 'pays'];

/**
 * Le DÉPARTAGE de deux mailles (négatif : `a` d'abord). Il ordonne les mailles à taux utile égal à ± l'écart de
 * départage, et c'est tout l'ordre du défaut provisoire (simulations pas encore lues). Celui de la règle est
 * `departageParPoussee` (B16) ; un appelant peut en passer un autre.
 */
export type Departage = (a: PlateformeGeo, b: PlateformeGeo, recette: Recette) => number;

/**
 * Le départage d'avant B16, l'ordre de finesse d'A-4 : une maille sûre (E9) avant une maille « à vérifier », puis une
 * maille exacte pour la recette avant une maille calculée, puis la plus fine ; le pays devant tout (Q-1 du 30/10 : le
 * ciblage pays d'office d'une zone nationale — il n'est candidat que pour elle, `mailleSansObjet`).
 */
export const departageParFinesse: Departage = (a, b, recette) => {
  const rang = (l: PlateformeGeo) => [
    mailleSure(l) ? 0 : 1,
    exactitude(recette, l.maille, l) === 'exacte' ? 0 : 1,
    l.maille === 'pays' ? -1 : FINESSE.indexOf(l.maille),
  ];
  const ra = rang(a);
  const rb = rang(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
};

/**
 * B16 : un mécanisme de poids d'une maille, réduit à ce que lit le mode de poussée — une ligne de `plateformes_poids`
 * (sql/305, amendement E2 ; le serveur la valide par `PlateformePoidsSchema`). `mecanisme` vaut `aucun` quand la maille
 * ne transmet aucun poids à la plateforme.
 */
export interface MecanismePoussee {
  plateforme: Plateforme;
  maille: Maille;
  mecanisme: string;
  branche: boolean;
}

/**
 * B16 : comment la maille part chez la plateforme — `api` (tout est poussé par API), `ciblage_api` (le ciblage géo est
 * poussé par API, les poids du plan partent en export manuel), `manuel` (export manuel). Lu dans le registre seul :
 * `plateformes_geo.poussee_branchee` (sql/322) pour le ciblage, puis — pour une maille qui porte des poids, c.-à-d. un
 * mécanisme autre que `aucun` — `plateformes_poids.branche` (E2) : un seul mécanisme branché suffit.
 */
export type ModePoussee = 'api' | 'ciblage_api' | 'manuel';

export function modePoussee(l: PlateformeGeo, poids: readonly MecanismePoussee[]): ModePoussee {
  if (!l.poussee_branchee) return 'manuel';
  const mecanismes = poids.filter((p) => p.plateforme === l.plateforme && p.maille === l.maille && p.mecanisme !== 'aucun');
  return mecanismes.length === 0 || mecanismes.some((p) => p.branche) ? 'api' : 'ciblage_api';
}

const RANG_POUSSEE: Readonly<Record<ModePoussee, number>> = { api: 0, ciblage_api: 1, manuel: 2 };

/**
 * B16 (ruling du 02/11) : LE départage de la règle — une maille sûre (E9) d'abord, puis la poussée branchée (`api`,
 * puis `ciblage_api`, puis `manuel`), puis l'ordre de `departageParFinesse` (exacte, plus fine, pays devant). Sans
 * aucune poussée au registre, il rend exactement l'ordre de `departageParFinesse`.
 */
export function departageParPoussee(poids: readonly MecanismePoussee[]): Departage {
  return (a, b, recette) => (mailleSure(a) ? 0 : 1) - (mailleSure(b) ? 0 : 1)
    || RANG_POUSSEE[modePoussee(a, poids)] - RANG_POUSSEE[modePoussee(b, poids)]
    || departageParFinesse(a, b, recette);
}

/** Les mailles candidates : natives, disponibles, et qui ont un sens pour la recette (`mailleSansObjet`, A-3). */
function candidates(lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette): PlateformeGeo[] {
  return lignes.filter((l) => l.plateforme === plateforme && l.natif && l.disponible && mailleSansObjet(recette, l.maille) === null);
}

const estExacte = (l: PlateformeGeo, recette: Recette) => exactitude(recette, l.maille, l) === 'exacte';

/**
 * Le défaut PROVISOIRE, par le seul départage (A-4) — tant que les simulations ne sont pas lues, ou qu'aucune ne
 * peut l'être. `null` si la plateforme n'a aucune maille achetable.
 */
export function mailleParDefaut(
  lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette, poids: readonly MecanismePoussee[] = [],
  departage: Departage = departageParPoussee(poids),
): Maille | null {
  return [...candidates(lignes, plateforme, recette)].sort((a, b) => departage(a, b, recette))[0]?.maille ?? null;
}

/**
 * Les mailles à SIMULER pour décider (dans l'ordre du registre) : les candidates calculées qui peuvent encore passer
 * devant la meilleure maille exacte. Une exacte vaut 100 % / 100 % : une calculée ne la bat qu'à l'écart de départage
 * près ET si le départage la met devant — donc, sans exacte, toutes ; sinon celles que le départage place avant elle.
 * C'est ce qui garde les lectures au strict nécessaire : rien pour une zone pays (pays exact et sûr), rien pour TTD
 * (polygone exact, tout « à vérifier »), les cercles seuls pour une liste de CP sur Meta (CP exact, « à vérifier »).
 */
export function simulationsRequises(
  lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette, poids: readonly MecanismePoussee[] = [],
  departage: Departage = departageParPoussee(poids),
): Maille[] {
  const toutes = candidates(lignes, plateforme, recette);
  const exacte = toutes.filter((l) => estExacte(l, recette)).sort((a, b) => departage(a, b, recette))[0];
  return toutes.filter((l) => !estExacte(l, recette) && (!exacte || departage(l, exacte, recette) < 0)).map((l) => l.maille);
}

/**
 * Le défaut retenu et sa raison, pour la ligne d'explication de l'écran (Q7 = A : les deux chiffres) :
 * - `couverture_cible` : la maille de taux utile maximal parmi celles qui atteignent la cible ;
 * - `couverture_max` : aucune ne l'atteint, celle de couverture maximale ;
 * - `en_attente` : une simulation requise n'est pas encore lue — défaut provisoire par le départage ;
 * - `sans_simulation` : aucune ne peut l'être (toutes refusées) — le départage parmi les autres.
 * `comparee` : la meilleure des autres mailles simulées (« contre 10 % / 95 % en CP »), absente s'il n'y en a pas.
 * `poussee` (B16) : le mode de poussée de la maille, et de la comparée — la ligne d'explication le dit.
 */
export interface DefautExplique {
  maille: Maille;
  poussee: ModePoussee;
  critere: 'couverture_cible' | 'couverture_max' | 'en_attente' | 'sans_simulation';
  couverture_cible: number;
  simulation?: Simulation;
  comparee?: { maille: Maille; poussee: ModePoussee; simulation: Simulation };
}

/**
 * LA règle de la maille par défaut (ARB-7 = A, E1). Parmi les candidates (natives, disponibles, avec un sens pour la
 * recette), celles dont la couverture simulée atteint la couverture cible ; parmi elles, le taux utile maximal, à
 * ± `ecart_departage` points près départagé par `departage` (B16 : sûre, puis poussée branchée, puis finesse — les
 * mécanismes de poids `poids` en entrent). Si aucune n'atteint la
 * cible : la couverture maximale (départagée à égalité). Une maille exacte vaut 100 % / 100 % sans lecture ; une
 * maille dont la simulation n'est pas requise (`simulationsRequises`) ne peut pas gagner et n'est pas comparée.
 * Le « à vérifier » n'écarte plus une maille (relecture du ticket : une liste de CP sur Meta, CP « à vérifier », doit
 * rester au CP) : il entre dans le départage, par paramètre (E9). `null` sans maille achetable.
 */
export function choisirDefaut(
  lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette, simulations: Simulations,
  reglages: ReglagesDefaut, poids: readonly MecanismePoussee[] = [], departage: Departage = departageParPoussee(poids),
): DefautExplique | null {
  const toutes = candidates(lignes, plateforme, recette);
  if (toutes.length === 0) return null;
  const cible = reglages.couverture_cible;
  const poussee = (m: Maille) => modePoussee(toutes.find((l) => l.maille === m) as PlateformeGeo, poids);
  const requises = simulationsRequises(lignes, plateforme, recette, poids, departage);
  if (requises.some((m) => simulations[m] === undefined)) {
    const maille = mailleParDefaut(lignes, plateforme, recette, poids, departage) as Maille;
    return { maille, poussee: poussee(maille), critere: 'en_attente', couverture_cible: cible };
  }
  const simulees = toutes.flatMap((l) => {
    const s = estExacte(l, recette) ? EXACTE : simulations[l.maille];
    return requises.includes(l.maille) || estExacte(l, recette) ? (s && s !== 'refusee' ? [{ l, s }] : []) : [];
  });
  if (simulees.length === 0) {
    const restantes = toutes.filter((l) => simulations[l.maille] !== 'refusee');
    const maille = mailleParDefaut(restantes.length > 0 ? restantes : toutes, plateforme, recette, poids, departage) as Maille;
    return { maille, poussee: poussee(maille), critere: 'sans_simulation', couverture_cible: cible };
  }
  const taux = (s: Simulation) => s.taux_utile ?? 0;
  const atteint = simulees.filter((x) => x.s.couverture >= cible);
  let groupe: typeof simulees;
  if (atteint.length > 0) {
    const meilleur = Math.max(...atteint.map((x) => taux(x.s)));
    groupe = atteint.filter((x) => taux(x.s) >= meilleur - reglages.ecart_departage);
  } else {
    const meilleure = Math.max(...simulees.map((x) => x.s.couverture));
    groupe = simulees.filter((x) => x.s.couverture === meilleure);
  }
  const retenue = [...groupe].sort((a, b) => departage(a.l, b.l, recette))[0];
  // La comparée : la meilleure des autres au même classement — la cible atteinte d'abord, par taux, puis par couverture.
  const classement = (x: { s: Simulation }) => (x.s.couverture >= cible ? [0, -taux(x.s)] : [1, -x.s.couverture]);
  const autre = simulees.filter((x) => x !== retenue).sort((a, b) => {
    const ca = classement(a);
    const cb = classement(b);
    return ca[0] - cb[0] || ca[1] - cb[1] || departage(a.l, b.l, recette);
  })[0];
  return {
    maille: retenue.l.maille, poussee: modePoussee(retenue.l, poids),
    critere: atteint.length > 0 ? 'couverture_cible' : 'couverture_max', couverture_cible: cible, simulation: retenue.s,
    ...(autre ? { comparee: { maille: autre.l.maille, poussee: modePoussee(autre.l, poids), simulation: autre.s } } : {}),
  };
}

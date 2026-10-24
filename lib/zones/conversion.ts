/**
 * @file lib/zones/conversion.ts — la conversion d'une zone dans une maille (lot 5, T5) : seuil, perte, exactitude,
 * maille par défaut, limites des plateformes. Logique PURE, sans I/O.
 *
 * ⑤ est le SEUL endroit qui traduit une zone dans une maille, et il dit toujours ce que la traduction perd (spec
 * § 16.2-2). Le seuil se rejoue côté écran (une réglette ne lance aucune requête) ET côté serveur à l'extraction : la
 * MÊME fonction, copiée côté Angular en T9 sous un test de parité (A-5). D'où les contraintes de ce fichier : aucun
 * import autre que des TYPES (ni Zod, ni Node, ni Next), des entrées et sorties en objets simples.
 *
 * Aucune limite de plateforme n'est écrite ici (nombre de cercles, bornes de rayon, nombre de lieux…) : elles se LISENT dans la ligne de
 * `plateformes_geo` passée en argument (§ 16.2-3) ; un test le verrouille par grep. Les messages français des
 * avertissements et des refus de conversion relèvent de la route (T8, `MESSAGES_CONVERSION`) : ce module rend des codes.
 */
import type { LigneCouverture } from './couverture';
import type { PlateformeGeo } from './plateformes';
import type { Recette } from './recette';

type Maille = PlateformeGeo['maille'];
type Plateforme = PlateformeGeo['plateforme'];

/** Ce que le seuil lit d'une ligne de `couverture_geometrie` — rien d'autre, pour accepter aussi une ligne figée. */
export type LigneSeuil = Pick<LigneCouverture, 'pop_en_zone' | 'pop_totale' | 'part'>;

/**
 * Le bilan d'une maille calculée. Deux égalités, toujours (Review Focus 1) : `manques + couverte = population de la
 * zone` et `hors_zone + couverte = achetee`.
 */
export interface ResumeMaille {
  exacte: false;
  /** Unités retenues (part ≥ seuil) — ce qui sera acheté. */
  n_unites: number;
  /** Unités touchées par la zone, retenues ou non. */
  n_touchees: number;
  /** Habitants de la zone dans les unités retenues. */
  couverte: number;
  /** Habitants des unités retenues, dans la zone ou non : la diffusion achetée. */
  achetee: number;
  /** Habitants de la zone qui ne seront pas touchés : unités écartées ET hors de tout territoire (on ne l'achète pas). */
  manques: number;
  /** Diffusion achetée hors de la zone. */
  hors_zone: number;
  /** `couverte / achetee` en %, une décimale, sur les SEULES unités retenues ; `null` si rien n'est acheté. */
  taux_utile: number | null;
}

/** Une maille exacte pour la recette (A-6) : zéro perte par construction, aucun calcul. */
export interface ResumeExact {
  exacte: true;
  population: number;
  surface_km2: number;
  couverte: number;
  achetee: number;
  manques: 0;
  hors_zone: 0;
  taux_utile: 100;
}

export type Resume = ResumeMaille | ResumeExact;

/** Un dépassement d'une limite de la plateforme : un avertissement, jamais un refus (A-9). */
export interface Avertissement {
  code: 'max_unites' | 'pop_min_groupe';
  limite: number;
  valeur: number;
}

/**
 * Retient les unités dont la part (en %) atteint le seuil — la borne est retenue, comme dans `appliquer_seuil_zone_set`.
 * Une ligne à `part` NULL (territoire sans dénominateur) n'est jamais retenue : on ne sait pas ce qu'on achèterait.
 * `population` est celle de la zone (`couverture_geometrie.population`), hors-territoire compris.
 */
export function appliquerSeuil(lignes: readonly LigneSeuil[], population: number, seuil: number): ResumeMaille {
  let n_unites = 0;
  let couverte = 0;
  let achetee = 0;
  for (const l of lignes) {
    if (l.part === null || l.part < seuil) continue;
    n_unites += 1;
    couverte += l.pop_en_zone;
    // Une part non nulle a un dénominateur ; `?? 0` ne sert que le typage.
    achetee += l.pop_totale ?? 0;
  }
  return {
    exacte: false,
    n_unites,
    n_touchees: lignes.length,
    couverte,
    achetee,
    manques: population - couverte,
    hors_zone: achetee - couverte,
    // En %, arrondi à une décimale (comme `tauxUtile` de `plan.ts`).
    taux_utile: achetee > 0 ? Math.round((couverte / achetee) * 100 * 10) / 10 : null,
  };
}

/** Le bilan d'une maille exacte (le polygone, ou une maille exacte pour la recette) : la zone telle quelle. */
export function resumeExact(population: number, surface_km2: number): ResumeExact {
  return { exacte: true, population, surface_km2, couverte: population, achetee: population, manques: 0, hors_zone: 0, taux_utile: 100 };
}

/** Le rayon est-il dans les bornes de la plateforme ? Une borne absente ne borne pas. */
function rayonAdmis(rayon_m: number, ligne?: PlateformeGeo): boolean {
  const { rayon_min_m, rayon_max_m } = ligne?.limites ?? {};
  return (rayon_min_m === undefined || rayon_m >= rayon_min_m) && (rayon_max_m === undefined || rayon_m <= rayon_max_m);
}

/**
 * La maille rend-elle la zone EXACTEMENT (A-6) ? Le polygone, toujours ; le CP pour une zone faite de codes postaux ;
 * le cercle pour un rayon autour d'un point, si la plateforme admet ce rayon. Pas `rayon_poi` : sa zone est découpée
 * par le périmètre de ① (obligatoire, `executerRecette`), les cercles entiers en débordent — la perte se calcule.
 */
export function exactitude(recette: Recette, maille: Maille, ligne?: PlateformeGeo): 'exacte' | 'calculee' {
  if (maille === 'polygone') return 'exacte';
  if (maille === 'cp' && recette.type === 'codes_postaux') return 'exacte';
  if (maille === 'cercle' && recette.type === 'rayon_point' && rayonAdmis(recette.rayon_m, ligne)) return 'exacte';
  return 'calculee';
}

/**
 * De la plus fine à la plus grossière. Le cercle avant la commune : son rayon se règle, une commune ne se découpe
 * pas. L'IRIS n'est acheté par aucune plateforme au 24/10 (A-5) ; il prend son rang si une ligne le porte un jour.
 */
const FINESSE: readonly Maille[] = ['polygone', 'iris', 'cp', 'cercle', 'commune', 'departement'];

/**
 * La maille proposée par défaut (A-4) parmi les mailles natives et disponibles de la plateforme : d'abord une maille
 * exacte pour la recette, puis une maille non « à vérifier », puis la plus fine. Si toutes sont « à vérifier » (TTD au
 * 24/10), la plus fine quand même : le badge le dit à l'écran. `null` si la plateforme n'a aucune maille achetable.
 */
export function mailleParDefaut(lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette): Maille | null {
  const rang = (l: PlateformeGeo) => [
    exactitude(recette, l.maille, l) === 'exacte' ? 0 : 1,
    l.a_verifier ? 1 : 0,
    FINESSE.indexOf(l.maille),
  ];
  const candidates = lignes.filter((l) => l.plateforme === plateforme && l.natif && l.disponible);
  candidates.sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  return candidates[0]?.maille ?? null;
}

/**
 * Les limites de la ligne que le bilan dépasse. `max_unites` porte sur les unités retenues (une maille exacte n'en
 * compte pas ici : le polygone est un, un cercle est un, et la liste de CP d'une recette est bornée par ③).
 * `pop_min_groupe` porte sur la diffusion achetée — le palier unique d'A-9.
 */
export function verifierLimites(resume: Resume, ligne: PlateformeGeo): Avertissement[] {
  const { max_unites, pop_min_groupe } = ligne.limites;
  const avertissements: Avertissement[] = [];
  if (!resume.exacte && max_unites !== undefined && resume.n_unites > max_unites) {
    avertissements.push({ code: 'max_unites', limite: max_unites, valeur: resume.n_unites });
  }
  if (pop_min_groupe !== undefined && resume.achetee < pop_min_groupe) {
    avertissements.push({ code: 'pop_min_groupe', limite: pop_min_groupe, valeur: resume.achetee });
  }
  return avertissements;
}

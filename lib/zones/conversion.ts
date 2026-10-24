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
 * `plateformes_geo` passée en argument (§ 16.2-3) ; un test le verrouille par grep. Les refus de `paver_cercles`
 * ont leurs messages français ici (`MESSAGES_CONVERSION`, T8) ; les avertissements restent des codes, que l'écran dit.
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
  /** Unités achetées : une (le polygone, le cercle de la recette), ou une par code d'une liste de codes postaux. */
  n_unites: number;
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
 * LA règle de rétention d'une unité : sa part (en %) atteint le seuil — la borne est retenue, comme dans
 * `appliquer_seuil_zone_set`. Une part NULL (territoire sans dénominateur) ne l'est jamais : on ne sait pas ce qu'on
 * achèterait. Exportée pour que l'extraction marque `retenu` par la MÊME règle que le bilan.
 */
export function estRetenue(ligne: Pick<LigneSeuil, 'part'>, seuil: number): boolean {
  return ligne.part !== null && ligne.part >= seuil;
}

/**
 * Retient les unités dont la part (en %) atteint le seuil ({@link estRetenue}) — la borne est retenue, comme dans `appliquer_seuil_zone_set`.
 * Une ligne à `part` NULL (territoire sans dénominateur) n'est jamais retenue : on ne sait pas ce qu'on achèterait.
 * `population` est celle de la zone (`couverture_geometrie.population`), hors-territoire compris.
 *
 * ⚠ Arrondis : la RPC arrondit à l'entier chaque `pop_en_zone`, `population` et `hors_territoire.population` (sql/275),
 * alors que les populations de carreaux sont fractionnaires (demi-habitants). `manques` (= population − couverte) et
 * la somme « CP écartés + hors territoire » diffèrent donc d'au plus ½ par ligne : −230 habitants sur les 895 CP de la
 * composite (24/10). L'écran affiche `manques` : c'est lui qui boucle avec la population de la zone affichée en tête
 * (`manques + couverte = population`) ; la somme des lignes d'un tableau peut s'en écarter de cet arrondi.
 */
export function appliquerSeuil(lignes: readonly LigneSeuil[], population: number, seuil: number): ResumeMaille {
  let n_unites = 0;
  let couverte = 0;
  let achetee = 0;
  for (const l of lignes) {
    if (!estRetenue(l, seuil)) continue;
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
    // En %, à une décimale : l'arrondi de `tauxUtile` (`plan.ts`), recopié et non importé — ce fichier est copié côté
    // Angular sans dépendance, et `tauxUtile` (non exporté) lit des `CpZone` du moteur risque.
    taux_utile: achetee > 0 ? Math.round((couverte / achetee) * 1000) / 10 : null,
  };
}

/**
 * Le bilan d'une maille exacte (le polygone, ou une maille exacte pour la recette) : la zone telle quelle. `n_unites` :
 * une par défaut ; le nombre de codes d'une recette `codes_postaux` achetée au CP.
 */
export function resumeExact(population: number, surface_km2: number, n_unites = 1): ResumeExact {
  return {
    exacte: true, n_unites, population, surface_km2, couverte: population, achetee: population, manques: 0, hors_zone: 0, taux_utile: 100,
  };
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
 * La maille proposée par défaut (A-4) parmi les mailles natives et disponibles de la plateforme : d'abord écarter les
 * mailles « à vérifier » (une maille exacte mais douteuse ne passe pas devant une maille sûre), puis préférer la maille
 * exacte pour la recette, puis la plus fine. Si toutes sont « à vérifier » (TTD au 24/10), le même ordre parmi elles :
 * le badge le dit à l'écran. `null` si la plateforme n'a aucune maille achetable.
 */
export function mailleParDefaut(lignes: readonly PlateformeGeo[], plateforme: Plateforme, recette: Recette): Maille | null {
  const rang = (l: PlateformeGeo) => [
    l.a_verifier ? 1 : 0,
    exactitude(recette, l.maille, l) === 'exacte' ? 0 : 1,
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
 * Les limites de la ligne que le bilan dépasse. `max_unites` porte sur les unités achetées, maille exacte comprise :
 * une liste de codes postaux exacte au CP peut dépasser le plafond de la plateforme (relecture T5). `pop_min_groupe`
 * porte sur la diffusion achetée — le palier unique d'A-9. `max_sommets` n'est pas vérifié ici : aucune forme n'est
 * simplifiée par ce module (le polygone part tel que ③ l'a enregistré).
 */
export function verifierLimites(resume: Resume, ligne: PlateformeGeo): Avertissement[] {
  const { max_unites, pop_min_groupe } = ligne.limites;
  const avertissements: Avertissement[] = [];
  if (max_unites !== undefined && resume.n_unites > max_unites) {
    avertissements.push({ code: 'max_unites', limite: max_unites, valeur: resume.n_unites });
  }
  if (pop_min_groupe !== undefined && resume.achetee < pop_min_groupe) {
    avertissements.push({ code: 'pop_min_groupe', limite: pop_min_groupe, valeur: resume.achetee });
  }
  return avertissements;
}

/** Les refus de `paver_cercles` (sql/276), tels que la RPC les rend dans `refus`. */
type RefusConversion =
  | 'zone_introuvable' | 'cible_inconnue' | 'zone_trop_vaste' | 'trop_de_candidates' | 'trop_de_cercles' | 'couverture_non_construite';

/**
 * Les refus de la conversion en cercles, en français — même forme que `MESSAGES_REFUS_COUVERTURE`, lue par
 * `repondreCouverture` (statut : 404, 503, sinon 422). Les chiffres (cercles retenus, plafond, rayon) partent à côté
 * du message, dans le corps de la réponse : l'écran les dit, aucun n'est écrit ici.
 *
 * ⚠ COPIE DÉCLARÉE : `zone_introuvable`, `cible_inconnue` et `couverture_non_construite` recopient les messages de la
 * couverture (`lib/zones/couverture.ts`) — ce module n'importe que des types, il est recopié côté Angular.
 * `tests/unit/zones/conversion.test.ts` verrouille l'égalité.
 */
export const MESSAGES_CONVERSION: Readonly<Record<RefusConversion, string>> = {
  zone_introuvable: 'Zone introuvable dans cet espace.',
  cible_inconnue: 'Cette cible n’est pas connue.',
  zone_trop_vaste: 'La zone est trop vaste pour ce rayon : augmentez le rayon ou réduisez la zone.',
  trop_de_candidates: 'La zone touche trop de cellules à paver : augmentez le rayon.',
  trop_de_cercles: 'Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.',
  couverture_non_construite: 'La couverture n’est pas encore construite sur cette base.',
};

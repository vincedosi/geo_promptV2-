import type { Decoupage, ResultatCouverture } from '../analyses/couverture';
import type { Recette } from '../zones/recette';
import { type Avertissement, type Resume, appliquerSeuil, exactitude, resumeExact, verifierLimites } from './conversion';
import type { ChoixMaille, ChoixParPlateforme } from './mailles-url';
import type { Plateforme, PlateformeGeo } from './plateformes';

/**
 * ⑤ Jeu de zones — le bilan d'un choix à partir de ce qui est EN MÉMOIRE (lot 5, T9) : quelle lecture il faut, où
 * elle se range, et ce qu'elle dit une fois lue. Fonctions PURES, sorties de `JeuZonesService` : l'état décide QUAND
 * lire, ce fichier décide QUOI lire et comment le compter. Aucun import d'Angular.
 */

/** La réponse 200 de `GET /api/zones/[id]/cercles` (`paver_cercles`, sql/276) : seuls les cercles RETENUS. */
export interface ResultatCercles {
  zone_id: string;
  cible: string;
  rayon_m: number;
  seuil: number;
  /** Cellules hexagonales examinées — pas des territoires. */
  n_candidates: number;
  n_cercles: number;
  cercles: Array<{ lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }>;
  population: number;
  couverte: number;
  manques: number;
  hors_zone: number;
  achetee: number;
  taux_utile: number | null;
  n_carreaux: number;
  motif_vide: 'territoire_non_carroye' | 'aucun_carreau' | 'aucune_cellule_au_seuil' | null;
}

/** Le bilan d'une plateforme pour son choix courant : la perte (ou « exacte ») et les limites dépassées. */
export interface BilanPlateforme {
  resume: Resume;
  avertissements: Avertissement[];
}

/**
 * Une zone sans recette lisible (d'avant le lot 3) : la règle du serveur à l'extraction est « seule la forme exacte
 * est exacte » — exactement ce que `exactitude` rend pour un dessin. Une seule règle, donc, des deux côtés.
 */
export const SANS_RECETTE: Recette = { v: 1, type: 'dessin' };

/** La maille rend-elle la zone telle quelle (A-6) ? Le rayon CHOISI compte : un autre rayon pave (T8). */
export function estExacte(c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null): boolean {
  return exactitude(recette ?? SANS_RECETTE, c.maille, ligne, c.rayon_m) === 'exacte';
}

/** Ce qu'il faut lire pour chiffrer un choix : un découpage de couverture (la forme pour une maille exacte), ou un pavage. */
export function lectureRequise(c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null): Decoupage | 'cercles' {
  if (estExacte(c, ligne, recette)) return 'forme';
  if (c.maille === 'cercle') return 'cercles';
  return c.maille === 'polygone' ? 'forme' : c.maille;
}

/**
 * La clé d'une couverture en mémoire. `maj` (la date de mise à jour de la zone, donnée par la liste) y entre : une zone
 * recalculée en ③ (même id) revient en ⑤ sous une autre clé, donc se relit.
 */
export function cleCouverture(zone: string, maj: string | null, cible: string, decoupage: Decoupage): string {
  return `${zone}|${maj ?? ''}|${cible}|${decoupage}`;
}

/**
 * Range une couverture lue sous `cle`. Les entrées de la MÊME zone lues sur une AUTRE version de sa forme (`zone_maj`,
 * sql/270) sont retirées — jamais deux formes mêlées dans les bilans ; `purgee` le dit, pour retirer aussi les pavages.
 */
export function rangerCouverture(
  cache: ReadonlyMap<string, ResultatCouverture>, cle: string, r: ResultatCouverture,
): { cache: ReadonlyMap<string, ResultatCouverture>; purgee: boolean } {
  const zone = cle.slice(0, cle.indexOf('|') + 1);
  const suite = new Map<string, ResultatCouverture>();
  let purgee = false;
  for (const [k, v] of cache) {
    if (k.startsWith(zone) && v.zone_maj !== r.zone_maj) purgee = true;
    else suite.set(k, v);
  }
  return { cache: suite.set(cle, r), purgee };
}

/**
 * Le bilan d'un choix à partir de la lecture qu'il requiert (`lu`), ou `null` si elle manque ou est périmée : une
 * maille exacte par `resumeExact` sur la forme, une maille territoriale par `appliquerSeuil` — un seuil déplacé ne
 * requête rien —, un cercle par le pavage s'il est à ce rayon ET à ce seuil (calculés au serveur).
 */
export function bilanDe(
  c: ChoixMaille, ligne: PlateformeGeo, recette: Recette | null, lu: ResultatCouverture | ResultatCercles | undefined,
): BilanPlateforme | null {
  if (!lu) return null;
  let resume: Resume;
  if (lectureRequise(c, ligne, recette) === 'cercles') {
    const k = lu as ResultatCercles;
    if (k.rayon_m !== c.rayon_m || k.seuil !== c.seuil) return null;
    resume = {
      exacte: false, n_unites: k.n_cercles, n_touchees: k.n_candidates, couverte: k.couverte, achetee: k.achetee,
      manques: k.manques, hors_zone: k.hors_zone, taux_utile: k.taux_utile,
    };
  } else {
    const cv = lu as ResultatCouverture;
    // Une liste de codes postaux achetée au CP : une unité par code (comme l'extraction, `convertirExacte`).
    const nCodes = c.maille === 'cp' && recette?.type === 'codes_postaux' ? new Set(recette.codes).size : 1;
    resume = estExacte(c, ligne, recette) ? resumeExact(cv.population, cv.surface_km2, nCodes) : appliquerSeuil(cv.lignes, cv.population, c.seuil);
  }
  return { resume, avertissements: verifierLimites(resume, ligne) };
}

/** Une valeur par plateforme choisie et connue du registre ; les `undefined` sont omis. */
export function parPlateforme<V>(
  choix: ChoixParPlateforme, regle: (p: Plateforme, c: ChoixMaille) => PlateformeGeo | undefined,
  lire: (p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo) => V | null | undefined,
): Partial<Record<Plateforme, V>> {
  const sortie: Partial<Record<Plateforme, V>> = {};
  for (const [p, c] of Object.entries(choix) as [Plateforme, ChoixMaille][]) {
    const ligne = regle(p, c);
    const v = ligne ? lire(p, c, ligne) : undefined;
    if (v !== undefined && v !== null) sortie[p] = v;
  }
  return sortie;
}

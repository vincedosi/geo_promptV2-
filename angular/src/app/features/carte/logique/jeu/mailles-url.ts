import { MODE_PLAN_DEFAUT_ZONE, MODES_PLAN } from '../../../risques/logique/jeu';
import { CIBLE_PAR_DEFAUT } from '../analyses/couverture';
import type { Recette } from '../zones/recette';
import { MAILLES, PLATEFORMES, type Maille, type Plateforme, type PlateformeGeo } from './plateformes';

/**
 * ⑤ Jeu de zones — le choix courant dans l'URL (lot 5, T9 ; arbitrage A-10) : `?mailles=` porte, par plateforme, la
 * maille, le seuil et (cercle) le rayon — `dv360.cp.20,ttd.polygone,meta.cercle.10000.20,tiktok.departement.20`.
 *
 * Ces fonctions ne vivent QUE côté Angular (décision du contrôleur, T5) : le serveur ne lit pas l'URL, il reçoit le
 * choix dans le corps de `POST /api/zones/jeux`. Elles ne lèvent jamais : une entrée illisible est écartée SEULE (la
 * plateforme reprend son défaut), les autres restent. Aucun import d'Angular, aucune limite de plateforme ici (le
 * rayon est un entier positif ; ses bornes sont celles de `plateformes_geo`, vérifiées par le serveur).
 */

/**
 * Les paramètres d'URL de ⑤ — ce que la version du § 18 sérialisera. `?cibleJeu=` et `?modeJeu=` (⑤ finitions, T5,
 * Q-5) : la cible et le mode de plan choisis AVANT enregistrement — un lien partagé les rouvre ; un jeu ouvert porte
 * les siens, ils disparaissent avec `?jeu=`.
 */
export const PARAM_ZONE_JEU = 'zoneJeu';
export const PARAM_JEU = 'jeu';
export const PARAM_MAILLES = 'mailles';
export const PARAM_EXTRACTION = 'x';
export const PARAM_CIBLE_JEU = 'cibleJeu';
export const PARAM_MODE_JEU = 'modeJeu';
const PARAMS = [PARAM_ZONE_JEU, PARAM_JEU, PARAM_MAILLES, PARAM_EXTRACTION, PARAM_CIBLE_JEU, PARAM_MODE_JEU] as const;

/** Les valeurs BRUTES des paramètres (`null` = absent) : l'état ne réécrit l'URL que si elle en diffère. */
export type ParametresJeu = Record<(typeof PARAMS)[number], string | null>;

/** Les paramètres de ⑤ d'un `ParamMap` (ou de tout objet qui sait `get`). */
export function lireParametresJeu(p: { get(cle: string): string | null }): ParametresJeu {
  return Object.fromEntries(PARAMS.map((k) => [k, p.get(k)])) as ParametresJeu;
}

type ModeJeu = (typeof MODES_PLAN)[number];

/** `?modeJeu=` → un des modes de plan, ou `null` (le défaut). Ne lève jamais. */
export function lireModeJeu(brut: string | null | undefined): ModeJeu | null {
  return (MODES_PLAN as readonly (string | null | undefined)[]).includes(brut) ? (brut as ModeJeu) : null;
}

export function memesParametres(a: ParametresJeu, b: ParametresJeu): boolean {
  return (Object.keys(a) as (keyof ParametresJeu)[]).every((k) => a[k] === b[k]);
}

/** Le seuil d'une plateforme sans choix explicite : 20 %, la valeur du module risque (A-4). */
export const SEUIL_PAR_DEFAUT = 20;

/**
 * Le repli du rayon par défaut quand la surface de la zone est inconnue (B10) : 10 km, l'exemple d'A-10 — un réglage
 * d'écran et non une règle de plateforme.
 */
export const RAYON_PAR_DEFAUT_M = 10_000;

/**
 * B10 : R = √(surface / π) / 3 — le rayon du disque de même surface que la zone, divisé par 3 (valeur du brief B10).
 * Une cellule hexagonale de rayon r couvrant ≈ 2,6 r², une zone compacte se pave alors en ≈ 9π / 2,6 ≈ 11 à 14
 * cellules quelle que soit sa taille : assez pour qu'une petite zone retienne des cercles au seuil, assez peu pour
 * qu'une vaste reste sous un plafond de plateforme.
 */
export const DIVISEUR_RAYON_SURFACE = 3;

/** Le pas de la réglette de rayon de ⑤ ; le serveur propose ses rayons au même pas (`PAS_RAYON_PROPOSE_M`, parité). */
export const PAS_RAYON_M = 500;

const M2_PAR_KM2 = 1e6;

type Limites = Pick<PlateformeGeo, 'limites'>;

/**
 * Les bornes de la RÉGLETTE de rayon (tour 1 de B10, I-2) : celles de la ligne ; une borne absente (ligne sans rayon
 * relevé — TTD en cercle) prend la plus large connue du registre (plus petit minimum, plus grand maximum), à défaut
 * rien. UNE règle pour la réglette (`bornesRayon`, `ecran.ts`) et le rayon par défaut : le défaut d'une ligne sans
 * borne ne descend pas sous le minimum que la réglette offre (sous la borne de sécurité de `paver_cercles`, la RPC
 * refuserait). `repli` : la borne vient du registre, pas de la ligne.
 */
export function bornesDeReglette(
  ligne: Limites | undefined, registre: readonly Limites[] = [],
): { min?: number; max?: number; repli_min?: true; repli_max?: true } {
  const mins = registre.map((l) => l.limites.rayon_min_m).filter((v): v is number => v !== undefined);
  const maxs = registre.map((l) => l.limites.rayon_max_m).filter((v): v is number => v !== undefined);
  const min = ligne?.limites.rayon_min_m ?? (mins.length > 0 ? Math.min(...mins) : undefined);
  const max = ligne?.limites.rayon_max_m ?? (maxs.length > 0 ? Math.max(...maxs) : undefined);
  return {
    ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
    ...(min !== undefined && ligne?.limites.rayon_min_m === undefined ? { repli_min: true as const } : {}),
    ...(max !== undefined && ligne?.limites.rayon_max_m === undefined ? { repli_max: true as const } : {}),
  };
}

/**
 * Le rayon par défaut et sa raison (dite à l'écran, commun.md règle 5) : `calcule_m` est l'avant (rayon de la recette,
 * rayon tiré de la surface arrondi à 10 m, ou le repli), `rayon_m` l'après, `borne` la borne qui l'a ramené —
 * `borne_reglette` : celle de la réglette (registre), la ligne n'en posant pas. Le rayon tiré de la surface se règle au
 * pas de la réglette.
 */
export interface RayonDefaut {
  rayon_m: number;
  source: 'recette' | 'surface' | 'repli';
  calcule_m: number;
  surface_km2?: number;
  borne?: 'rayon_min_m' | 'rayon_max_m';
  borne_reglette?: true;
}

/**
 * Le rayon proposé à une plateforme en cercle sans choix explicite : celui de la recette (un rayon autour d'un point
 * ou de POI : la zone le dit ; ramené aux bornes de la LIGNE, son ajustement est dit par `avertissementsRayon`, B8),
 * sinon celui tiré de la surface de la zone (B10), sinon le repli — ramenés aux bornes de la réglette
 * (`bornesDeReglette` : la ligne, à défaut le registre). Aucune borne écrite ici.
 */
export function rayonDefautExplique(
  ligne: Limites | undefined, recette: Recette | null, surface_km2?: number | null, registre: readonly Limites[] = [],
): RayonDefaut {
  const bornerA = (min: number | undefined, max: number | undefined) => (v: number) =>
    Math.min(Math.max(v, min ?? v), max ?? Number.POSITIVE_INFINITY);
  if (recette?.type === 'rayon_point' || recette?.type === 'rayon_poi') {
    const { rayon_min_m: min, rayon_max_m: max } = ligne?.limites ?? {};
    const borne = min !== undefined && recette.rayon_m < min ? { borne: 'rayon_min_m' as const }
      : max !== undefined && recette.rayon_m > max ? { borne: 'rayon_max_m' as const } : {};
    return { rayon_m: bornerA(min, max)(recette.rayon_m), source: 'recette', calcule_m: recette.rayon_m, ...borne };
  }
  const r = bornesDeReglette(ligne, registre);
  const borner = bornerA(r.min, r.max);
  const borne = (v: number): Pick<RayonDefaut, 'borne' | 'borne_reglette'> =>
    r.min !== undefined && v < r.min ? { borne: 'rayon_min_m', ...(r.repli_min ? { borne_reglette: true } : {}) }
      : r.max !== undefined && v > r.max ? { borne: 'rayon_max_m', ...(r.repli_max ? { borne_reglette: true } : {}) } : {};
  if (typeof surface_km2 !== 'number' || !(surface_km2 > 0)) {
    return { rayon_m: borner(RAYON_PAR_DEFAUT_M), source: 'repli', calcule_m: RAYON_PAR_DEFAUT_M, ...borne(RAYON_PAR_DEFAUT_M) };
  }
  const brut = Math.sqrt((surface_km2 * M2_PAR_KM2) / Math.PI) / DIVISEUR_RAYON_SURFACE;
  const auPas = Math.max(PAS_RAYON_M, Math.round(borner(brut) / PAS_RAYON_M) * PAS_RAYON_M);
  return { rayon_m: borner(auPas), source: 'surface', calcule_m: Math.round(brut / 10) * 10, surface_km2, ...borne(brut) };
}

export function rayonParDefaut(
  ligne: Limites | undefined, recette: Recette | null, surface_km2?: number | null, registre?: readonly Limites[],
): number {
  return rayonDefautExplique(ligne, recette, surface_km2, registre).rayon_m;
}

/** Le choix d'UNE plateforme : `rayon_m` pour la maille cercle, et pour elle seule (CHECK `zsp_rayon_cercle`). */
export interface ChoixMaille {
  maille: Maille;
  seuil: number;
  rayon_m?: number;
}

/** Les choix explicites, par plateforme ; une plateforme absente prend son défaut. */
export type ChoixParPlateforme = Partial<Record<Plateforme, ChoixMaille>>;

const estPlateforme = (v: string): v is Plateforme => (PLATEFORMES as readonly string[]).includes(v);
const estMaille = (v: string): v is Maille => (MAILLES as readonly string[]).includes(v);

/** Un nombre décimal écrit simplement (`20`, `12.5`) dans [0, 100], ou `null`. */
function lireSeuil(brut: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(brut)) return null;
  const n = Number(brut);
  return n <= 100 ? n : null;
}

/** Une entrée `plateforme.maille[.rayon][.seuil]` → `[plateforme, choix]`, ou `null` si illisible. */
function lireEntree(entree: string): [Plateforme, ChoixMaille] | null {
  const [plateforme, maille, ...reste] = entree.split('.');
  if (!plateforme || !maille || !estPlateforme(plateforme) || !estMaille(maille)) return null;
  // Le point sépare les champs ET les décimales du seuil (`dv360.cp.12.5`) : le seuil est TOUT ce qui suit les champs
  // qui le précèdent, relu comme un nombre — `lireSeuil` refuse tout le reste.
  if (maille === 'cercle') {
    const [rayon, ...seuilBrut] = reste;
    if (!rayon || !/^[1-9]\d*$/.test(rayon)) return null;
    const seuil = lireSeuil(seuilBrut.join('.'));
    return seuil === null ? null : [plateforme, { maille, seuil, rayon_m: Number(rayon) }];
  }
  // Le polygone et le pays sont exacts (A-6, ⑤ finitions) : leur seuil n'a pas de sens, ils s'écrivent sans ; on
  // l'admet s'il est là.
  if ((maille === 'polygone' || maille === 'pays') && reste.length === 0) return [plateforme, { maille, seuil: SEUIL_PAR_DEFAUT }];
  const seuil = lireSeuil(reste.join('.'));
  return seuil === null ? null : [plateforme, { maille, seuil }];
}

/** `?mailles=` → les choix lisibles. Absent ou illisible : `{}` (tous les défauts). Ne lève jamais. */
export function lireMailles(brut: string | null | undefined): ChoixParPlateforme {
  const choix: ChoixParPlateforme = {};
  if (typeof brut !== 'string') return choix;
  for (const entree of brut.split(',')) {
    const lue = lireEntree(entree.trim());
    // Une plateforme en double : la première gagne (l'URL canonique n'en porte jamais deux).
    if (lue && !choix[lue[0]]) choix[lue[0]] = lue[1];
  }
  return choix;
}

/** La forme canonique de `?mailles=`, dans l'ordre des plateformes ; `null` (paramètre absent) sans choix. */
export function ecrireMailles(choix: ChoixParPlateforme): string | null {
  const entrees = PLATEFORMES.flatMap((p) => {
    const c = choix[p];
    if (!c) return [];
    if (c.maille === 'polygone' || c.maille === 'pays') return [`${p}.${c.maille}`];
    return [c.maille === 'cercle' ? `${p}.cercle.${c.rayon_m}.${c.seuil}` : `${p}.${c.maille}.${c.seuil}`];
  });
  return entrees.length > 0 ? entrees.join(',') : null;
}

/** `?x=` → la version d'une extraction (entier positif), ou `null`. */
export function lireVersion(brut: string | null | undefined): number | null {
  return typeof brut === 'string' && /^[1-9]\d*$/.test(brut) ? Number(brut) : null;
}

/**
 * La forme canonique des paramètres pour un état : `?jeu=` l'emporte (zone et choix sont dedans, `?zoneJeu=`
 * disparaît) ; `?mailles=` seulement avec une zone ou un jeu ; `?x=` seulement avec un jeu ; `?cibleJeu=` et
 * `?modeJeu=` avec une zone SANS jeu, et hors défauts (`avant` : la cible et le mode choisis, `null` = aucun).
 */
export function parametresDe(
  jeu: string | null, zone: string | null, reglages: ChoixParPlateforme, extraction: number | null,
  avant: { cible: string | null; mode: ModeJeu | null } = { cible: null, mode: null },
): ParametresJeu {
  const sansJeu = !jeu && !!zone;
  return {
    [PARAM_ZONE_JEU]: jeu ? null : zone,
    [PARAM_JEU]: jeu,
    [PARAM_MAILLES]: jeu || zone ? ecrireMailles(reglages) : null,
    [PARAM_EXTRACTION]: jeu && extraction !== null ? String(extraction) : null,
    [PARAM_CIBLE_JEU]: sansJeu && avant.cible !== null && avant.cible !== CIBLE_PAR_DEFAUT ? avant.cible : null,
    [PARAM_MODE_JEU]: sansJeu && avant.mode !== null && avant.mode !== MODE_PLAN_DEFAUT_ZONE ? avant.mode : null,
  };
}

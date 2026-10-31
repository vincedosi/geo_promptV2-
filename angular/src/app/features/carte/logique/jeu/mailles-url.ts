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
 * Le rayon proposé à une plateforme en cercle sans choix explicite : celui de la recette (un rayon autour d'un point
 * ou de POI : la zone le dit), sinon 10 km — l'exemple d'A-10, un réglage d'écran et non une règle de plateforme —,
 * ramené dans les bornes de la ligne de `plateformes_geo` (une borne absente ne borne pas).
 */
export const RAYON_PAR_DEFAUT_M = 10_000;

export function rayonParDefaut(ligne: Pick<PlateformeGeo, 'limites'> | undefined, recette: Recette | null): number {
  const voulu = recette?.type === 'rayon_point' || recette?.type === 'rayon_poi' ? recette.rayon_m : RAYON_PAR_DEFAUT_M;
  const { rayon_min_m: min, rayon_max_m: max } = ligne?.limites ?? {};
  return Math.min(Math.max(voulu, min ?? voulu), max ?? Number.POSITIVE_INFINITY);
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

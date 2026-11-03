import { formaterNombre } from '../../../../core/format/nombre';
import type { FiltreActif } from '../filtre';

/**
 * Le score composite, en fonctions PURES (lot 4, T18) — ce que `ScoreCompositeTool.tsx` calculait en ligne : le corps
 * de `POST /api/analyses/score`, l'ajout d'un indicateur, le compte au-dessus du seuil, le nom et les messages de la
 * zone créée — plus le corps du REJEU d'un score enregistré (« Mes analyses »), que React ne savait pas faire.
 */

/** Une ligne du catalogue `GET /api/cibles/indicators` (`cible_indicator_registry`). */
export interface IndicateurRegistre {
  indicator_code: string;
  label: string;
  famille: string | null;
  unit?: string | null;
  /** La maille du registre (`iris` ou `cp`), rendue par `GET /api/cibles/indicators` ; lue par « Par seuil » (C19). */
  scale?: string | null;
  /** A-6 (lot « Catalogue et groupes ») : `espace` si la source de l'indicateur est propre à l'espace actif. */
  origine?: 'espace' | 'commune';
}

export type SensIndicateur = 'croissant' | 'decroissant';

/** Un indicateur retenu, avec son poids et son sens de lecture. */
export interface IndicateurChoisi {
  code: string;
  label: string;
  poids: number;
  sens: SensIndicateur;
}

/** Ce que la route reçoit de chaque indicateur (`IndicateurSchema`). */
export interface ParametreIndicateur {
  code: string;
  poids: number;
  sens: SensIndicateur;
}

/** Une ligne du score : un code postal, sa note 0-100, le nombre d'indicateurs qui la portent. */
export interface ScoreCP {
  code: string;
  score: number;
  n_indicateurs: number;
}

/** La réponse de `POST /api/analyses/score`. */
export interface ResultatScore {
  scores: ScoreCP[];
  indicateurs: { code: string; label: string; calcule_le: string | null }[];
  perimetre: { n_codes_postaux: number; n_scores: number; n_complets: number };
}

/** Le corps de `POST /api/analyses/score` : un périmètre de filtre OU une liste de codes postaux (rejeu). */
export interface CorpsScore {
  indicateurs: ParametreIndicateur[];
  perimetre?: { type: FiltreActif['type']; code: string };
  codes_postaux?: string[];
  enregistrer: boolean;
  /** Absent sur une zone analysée : la route nomme alors le score d'après ses indicateurs (plus parlant qu'un nom unique). */
  nom?: string;
}

/** Au-delà, le score ne se lit plus — même plafond que la route (`MAX_INDICATEURS`). */
export const MAX_INDICATEURS = 6;

/** L'option d'un indicateur dans les listes : « famille — label ». */
export function libelleIndicateur(i: IndicateurRegistre): string {
  return `${i.famille ? `${i.famille} — ` : ''}${i.label}`;
}

/** La liste avec `code` ajouté (poids 1, « Haut = mieux »), ou `null` : inconnu, déjà retenu, ou plafond atteint. */
export function ajouterIndicateur(
  choisis: readonly IndicateurChoisi[], catalogue: readonly IndicateurRegistre[], code: string,
): IndicateurChoisi[] | null {
  const meta = catalogue.find((i) => i.indicator_code === code);
  if (!meta || choisis.some((c) => c.code === code) || choisis.length >= MAX_INDICATEURS) return null;
  return [...choisis, { code, label: meta.label, poids: 1, sens: 'croissant' }];
}

export function parametresIndicateurs(choisis: readonly IndicateurChoisi[]): ParametreIndicateur[] {
  return choisis.map((c) => ({ code: c.code, poids: c.poids, sens: c.sens }));
}

/** Ce sur quoi le score part : le filtre de ①, ou la zone analysée de ④. Jamais aucun des deux (T10 M-1). */
export type PerimetreScore = { readonly filtre: FiltreActif } | { readonly zone: string };

/**
 * Le corps exact de React (`ScoreCompositeTool.tsx:161-166`) : le périmètre est le FILTRE, la route le résout. Lot 4,
 * T10 : une zone analysée (④) prend sa place — la route sait déjà lire `{ type: 'zone' }` — sans nom (la route nomme).
 */
export function corpsScore(choisis: readonly IndicateurChoisi[], p: PerimetreScore, enregistrer: boolean): CorpsScore {
  const base = { indicateurs: parametresIndicateurs(choisis), enregistrer };
  if ('zone' in p) return { ...base, perimetre: { type: 'zone', code: p.zone } };
  return { ...base, perimetre: { type: p.filtre.type, code: p.filtre.code }, nom: `Score composite — ${p.filtre.label}` };
}

/** Ce que le score agrège, en légende : « Revenu médian × Part des 15-29 ans ». */
export function libelleScore(labels: readonly string[]): string {
  return labels.join(' × ');
}

/** Les codes postaux retenus par « Créer une zone » : score ≥ seuil, comme la route sœur. */
export function compteAuDessus(scores: readonly ScoreCP[], seuil: number): number {
  return scores.filter((s) => s.score >= seuil).length;
}

/**
 * « 1 code postal », « 127 codes postaux ». Défaut React corrigé : `postal{n > 1 ? 'ux' : ''}` y écrivait « codes
 * postalux » (carte flottante et compte au-dessus du seuil).
 */
export function libelleCodesPostaux(n: number): string {
  return `${formaterNombre(n)} ${n > 1 ? 'codes postaux' : 'code postal'}`;
}

export function libelleRetenus(n: number): string {
  return `${libelleCodesPostaux(n)} retenu${n > 1 ? 's' : ''}`;
}

/** Le nom de la zone créée, coupé à 200 caractères (le plafond de `/api/custom-geo/save`). */
export function nomZoneScore(seuil: number, choisis: readonly IndicateurChoisi[]): string {
  return `Score ≥ ${seuil} — ${libelleScore(choisis.map((c) => c.label))}`.slice(0, 200);
}

/** Le refus de `POST /api/custom-geo/source/score`, dans les mots de React (`ScoreCompositeTool.tsx:211-215`). */
export function messageZoneScore(e: { status?: number; error?: unknown }): string {
  const corps = (e.error && typeof e.error === 'object' ? e.error : {}) as { error?: unknown; count?: unknown };
  if (corps.error === 'empty_selection') return 'Aucun code postal ne passe ce seuil.';
  if (corps.error === 'selection_too_large') return `Sélection trop large (${formaterNombre(Number(corps.count))} CP). Remontez le seuil.`;
  return `Erreur (${e.status ?? 0})`;
}

/** Ce que rend `POST /api/analyses/[id]/rejouer` sous `rejeu` (les jsonb de la ligne, non typés en base). */
export interface Rejeu {
  type: string;
  nom: string;
  parametres: unknown;
  perimetre: unknown;
}

/**
 * Le corps qui RELANCE un score enregistré : les indicateurs de `parametres`, et la LISTE de codes postaux de
 * `perimetre` — c'est elle que la route enregistre pour être rejouée (un filtre re-résolu plus tard ne rendrait pas
 * forcément les mêmes codes). Repli sur le filtre d'origine pour une ligne qui n'aurait pas de liste. `enregistrer:
 * false` : rejouer n'ajoute pas une ligne à chaque fois. `null` : pas un score, ou des paramètres illisibles.
 */
export function corpsRejeuScore(r: Rejeu): CorpsScore | null {
  if (r.type !== 'score') return null;
  const indicateurs = (r.parametres as { indicateurs?: unknown } | null)?.indicateurs;
  if (!Array.isArray(indicateurs) || indicateurs.length === 0) return null;
  const perimetre = (r.perimetre ?? {}) as { codes_postaux?: unknown; filtre?: { type?: unknown; code?: unknown } | null };
  const corps: CorpsScore = { indicateurs: indicateurs as ParametreIndicateur[], enregistrer: false, nom: r.nom };
  if (Array.isArray(perimetre.codes_postaux) && perimetre.codes_postaux.length > 0) {
    return { ...corps, codes_postaux: perimetre.codes_postaux as string[] };
  }
  const f = perimetre.filtre;
  if (f && typeof f.type === 'string' && typeof f.code === 'string') {
    return { ...corps, perimetre: { type: f.type as FiltreActif['type'], code: f.code } };
  }
  return null;
}

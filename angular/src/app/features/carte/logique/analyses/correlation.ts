import { formaterNombre } from '../../../../core/format/nombre';

/**
 * La corrélation impressions × indicateur, en fonctions PURES (lot 4, T18) — ce que `CorrelationTool.tsx` écrivait en
 * ligne. Le coefficient lui-même est calculé par la route (`lib/analyses/correlation.ts`) : ici, seulement sa LECTURE.
 */

/** Une campagne de `GET /api/digital/campaigns` (la route écarte déjà les simulations). */
export interface CampagneItem {
  id: string;
  name?: string | null;
  nom?: string | null;
}

export interface PointCorrelation {
  code: string;
  x: number;
  y: number;
}

/** La réponse de `GET /api/analyses/correlation`. */
export interface ResultatCorrelation {
  r: number;
  n: number;
  points: PointCorrelation[];
  indicateur: { code: string; label: string; unit: string | null; calcule_le: string | null };
  couverture: { cp_apparies: number; cp_campagne: number | null };
}

/** Sous ce nombre de points, un coefficient ne se commente pas (`N_MIN_INTERPRETATION`). */
const N_MIN_INTERPRETATION = 30;

/** Sous ce nombre de points, le nuage n'est pas dessiné : l'écran le dit (`CorrelationTool.tsx:251`). */
export const N_MIN_NUAGE = 3;

/**
 * Lecture en clair d'un coefficient (`lireCoefficient`, verbatim) : ces seuils empêchent de sur-lire un r = 0,25, ils
 * ne tranchent pas une question scientifique. Sous 30 points, rien n'est commenté — un r = 0,9 sur 5 CP ne dit rien.
 */
export function lireCoefficient(r: number, n: number): string {
  if (n < N_MIN_INTERPRETATION) return `trop peu de points pour interpréter (n = ${n})`;
  const a = Math.abs(r);
  const sens = r >= 0 ? 'positive' : 'négative';
  if (a < 0.1) return 'aucune relation linéaire';
  if (a < 0.3) return `relation ${sens} très faible`;
  if (a < 0.5) return `relation ${sens} faible`;
  if (a < 0.7) return `relation ${sens} modérée`;
  return `relation ${sens} forte`;
}

/** `name`, puis `nom`, sinon « — » (`CorrelationTool.tsx:235-236`). */
export function nomCampagne(campagnes: readonly CampagneItem[], id: string): string {
  const c = campagnes.find((x) => x.id === id);
  return c?.name ?? c?.nom ?? '—';
}

/**
 * `n` et la COUVERTURE ne se séparent jamais : la jointure de la route est interne, elle écarte en silence les CP sans
 * valeur d'indicateur — « 200 CP » ne dit pas la même chose sur une campagne qui en touche 2 041.
 */
export function ligneCouverture(r: ResultatCorrelation): string {
  const sur = r.couverture.cp_campagne != null ? ` sur ${formaterNombre(r.couverture.cp_campagne)} touchés par la campagne` : '';
  return `n = ${formaterNombre(r.n)} codes postaux${sur}`;
}

/** Le chemin de la route, paramètres encodés comme React (`encodeURIComponent`). */
export function urlCorrelation(campagneId: string, variable: string): string {
  return `analyses/correlation?campaignId=${encodeURIComponent(campagneId)}&variable=${encodeURIComponent(variable)}`;
}

/** Les trois lignes de l'infobulle d'un point (`CorrelationTool.tsx:287-289`). */
export function lignesInfobulle(p: PointCorrelation, libelle: string): [string, string, string] {
  return [p.code, `${formaterNombre(p.x)} impressions`, `${libelle} : ${p.y.toFixed(1)}`];
}

/**
 * Les textes de la création de zone — `CreerZoneCodesPostaux.tsx`, `CreerZoneRayon.tsx`, `CreerZoneDessin.tsx`
 * (lot 4, T16), mot pour mot. Logique PURE : les trois composants de « Créer une zone » s'en servent.
 *
 * Les pertes sont dites APRÈS création aussi : c'est le chiffre qu'on reportera au client. Les codes postaux
 * distinguent deux familles qui ne se corrigent pas de la même façon — un jeton qui n'est pas un code (coquille,
 * rejeté par le parseur) et un code bien formé absent du référentiel (Cedex, code périmé, CP étranger).
 */
import { formaterNombre } from '../../../../core/format/nombre';
import { parserCodesPostaux } from './parse-cp';

/** Même plafond que la route — annoncé ici pour éviter un aller-retour perdu. */
export const MAX_CP = 2000;
/** Rejets listés sous l'aperçu : au-delà, « … ». */
const REJETS_AFFICHES = 8;
/**
 * Sous cette PART (0 à 1, l'unité de `part_retenue` des routes), la découpe est dite — les arrondis du clip ne font
 * pas tomber un cercle entier sous 98 %. Seule définition : les créateurs ET le pied de recette de ③ la lisent ; la
 * comparaison se fait en part, la conversion en % n'a lieu qu'à l'affichage.
 */
export const PART_SIGNALEE = 0.98;

const pluriel = (n: number, s = 's') => (n > 1 ? s : '');

/** Ce que l'aperçu affiche pendant la frappe, sans requête — `null` quand il n'y a rien à dire. */
export interface ApercuCodesPostaux {
  nCodes: number;
  reconnus: string;
  rejetes: string | null;
  listeRejetes: string | null;
  /** Plus de `MAX_CP` codes : la création est refusée d'avance. */
  trop: boolean;
}

/** L'aperçu local de la saisie, par le MÊME parseur que la route (`lib/custom-geo/parse-cp.ts`). */
export function apercuCodesPostaux(saisie: string): ApercuCodesPostaux | null {
  const { codes, rejetes, nRejetes } = parserCodesPostaux(saisie);
  if (codes.length === 0 && nRejetes === 0) return null;
  const n = codes.length;
  return {
    nCodes: n,
    reconnus: `${formaterNombre(n)} code${pluriel(n)} reconnu${pluriel(n)}`,
    rejetes: nRejetes > 0 ? `${formaterNombre(nRejetes)} rejeté${pluriel(nRejetes)}` : null,
    listeRejetes: nRejetes > 0 ? rejetes.slice(0, REJETS_AFFICHES).join(', ') + (nRejetes > REJETS_AFFICHES ? '…' : '') : null,
    trop: n > MAX_CP,
  };
}

/** Le nom proposé par un fichier déposé : « Codes postaux — clients » pour `clients.csv`. */
export function nomCodesPostauxFichier(nomFichier: string): string {
  return `Codes postaux — ${nomFichier.replace(/\.[^.]+$/, '')}`;
}

/** Ce que `/api/custom-geo/source/codes-postaux` rend et que le message lit. */
export interface ReponseCodesPostaux { n_codes: number; n_inconnus?: number; n_rejetes?: number }

/**
 * Le message après création. `avertissement` : celui d'un 207 (la zone existe, ses codes postaux n'ont pas été
 * résolus) — il REMPLACE le compte de codes postaux, qui serait faux (« 0 codes postaux »).
 */
export function messageZoneCodesPostaux(geo: ReponseCodesPostaux, countCp: number | undefined, avertissement?: string): string {
  const pertes: string[] = [];
  const inconnus = geo.n_inconnus ?? 0;
  const rejetes = geo.n_rejetes ?? 0;
  if (inconnus) pertes.push(`${formaterNombre(inconnus)} inconnu${pluriel(inconnus)} du référentiel`);
  if (rejetes) pertes.push(`${formaterNombre(rejetes)} rejeté${pluriel(rejetes)}`);
  const debut = avertissement ?? `Zone créée : ${formaterNombre(countCp ?? geo.n_codes)} codes postaux`;
  return debut + (pertes.length ? ` · ${pertes.join(', ')}` : '');
}

/** Ce que `/source/rayon` et `/source/dessin` rendent et que les messages lisent. */
export interface ReponseSurface { surface_km2: number; part_retenue?: number; corrige?: boolean }

/** La part retenue quand elle est à dire (sous `PART_SIGNALEE`), en % arrondi ; `null` sinon. */
const partSignalee = (geo: ReponseSurface): number | null => {
  const p = geo.part_retenue ?? 1;
  return p < PART_SIGNALEE ? Math.round(p * 100) : null;
};
const debutSurface = (geo: ReponseSurface, countCp: number | undefined, avertissement: string | undefined) =>
  `Zone créée : ${formaterNombre(geo.surface_km2)} km² · ${avertissement ?? `${formaterNombre(countCp ?? 0)} codes postaux`}`;

export function messageZoneRayon(geo: ReponseSurface, countCp: number | undefined, avertissement?: string): string {
  const part = partSignalee(geo);
  return debutSurface(geo, countCp, avertissement) + (part !== null ? ` · ${part} % du cercle retenus (le reste est hors territoire)` : '');
}

export function messageZoneDessin(geo: ReponseSurface, countCp: number | undefined, avertissement?: string): string {
  const remarques: string[] = [];
  if (geo.corrige) remarques.push('tracé réparé (il se croisait lui-même)');
  const part = partSignalee(geo);
  if (part !== null) remarques.push(`${part} % retenus, le reste est hors territoire`);
  return debutSurface(geo, countCp, avertissement) + (remarques.length ? ` · ${remarques.join(' · ')}` : '');
}

/** Le nom d'un tracé laissé sans nom : « Tracé de 163,24 km² ». */
export function nomDessinParDefaut(surfaceKm2: number): string {
  return `Tracé de ${formaterNombre(surfaceKm2)} km²`;
}

/**
 * Le message d'un refus de route source : `message` (phrase écrite pour l'utilisateur), puis `error`, puis
 * « Erreur <statut> » (`geo.message ?? geo.error ?? \`Erreur ${status}\``), « Erreur réseau » sans réponse.
 */
export function messageErreurSource(e: { status?: number; error?: unknown }): string {
  const corps = (e.error && typeof e.error === 'object' ? e.error : {}) as { message?: unknown; error?: unknown };
  if (typeof corps.message === 'string' && corps.message) return corps.message;
  if (typeof corps.error === 'string' && corps.error) return corps.error;
  return e.status ? `Erreur ${e.status}` : 'Erreur réseau';
}

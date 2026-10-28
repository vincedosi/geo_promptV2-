/**
 * Groupes d'espaces (lot « Catalogue et groupes », A-9 ; sql/289) — règles PURES, testées sans TestBed.
 *
 * Un groupe n'est qu'un NOM (`organizations.groupe_espace`) saisi dans les Réglages de chaque espace : il range la
 * colonne d'Accès en dossiers et ne porte aucun droit (V9). Pas de table, pas d'écran de gestion (option A de
 * Vincent, 28/10) : la liste des groupes est celle des noms portés par les espaces.
 */
import type { EspaceResume } from './types';

/** Longueur maximale d'un nom de groupe : celle du PATCH (`max(60)`) et du CHECK de la colonne (sql/289). */
export const LONGUEUR_MAX_GROUPE = 60;

/** Un dossier de la colonne d'Accès : un groupe et ses espaces, dans l'ordre du serveur. */
export interface DossierEspaces<T> {
  groupe: string;
  espaces: T[];
}

/** La colonne rangée : les espaces sans groupe d'abord, puis un dossier par groupe. */
export interface ColonneRangee<T> {
  sansGroupe: T[];
  dossiers: DossierEspaces<T>[];
}

/** Le groupe d'un espace, rogné ; `null` s'il n'en a pas (une chaîne blanche n'en est pas un). */
export function groupeDe(e: Pick<EspaceResume, 'groupe_espace'>): string | null {
  const g = e.groupe_espace?.trim() ?? '';
  return g === '' ? null : g;
}

const ordre = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

/**
 * Range des lignes par groupe. L'ordre du serveur (nom affiché, internes en dernier) est gardé à l'intérieur de chaque
 * part ; les dossiers sont triés par nom de groupe (ordre alphabétique français, sans tenir compte de la casse).
 */
export function rangerParGroupe<T>(lignes: readonly T[], groupe: (l: T) => string | null): ColonneRangee<T> {
  const sansGroupe: T[] = [];
  const parGroupe = new Map<string, T[]>();
  for (const l of lignes) {
    const g = groupe(l);
    if (g === null) sansGroupe.push(l);
    else parGroupe.set(g, [...(parGroupe.get(g) ?? []), l]);
  }
  const dossiers = [...parGroupe.keys()].sort(ordre).map((g) => ({ groupe: g, espaces: parGroupe.get(g)! }));
  return { sansGroupe, dossiers };
}

/** Les groupes portés par les AUTRES espaces que `sauf` : les suggestions du champ « Groupe » des Réglages. */
export function groupesDesAutres(espaces: readonly EspaceResume[], sauf: string): string[] {
  const noms = new Set<string>();
  for (const e of espaces) {
    const g = e.id === sauf ? null : groupeDe(e);
    if (g !== null) noms.add(g);
  }
  return [...noms].sort(ordre);
}

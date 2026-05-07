/**
 * Mappings niveau → libellé / couleur pour ATMO et pollen.
 *
 * Les couleurs sont exposées comme tokens CSS (--atmo-level-N, --pollen-level-N)
 * dans app/globals.css, conformément à la règle "no hardcoded colors" du
 * design system MAGELIAN. Les hex ci-dessous servent uniquement de référence.
 *
 * Source des couleurs et qualificatifs : Atmo France
 *   https://www.atmo-france.org/article/lindice-atmo
 *   https://www.atmo-france.org/article/indice-pollen
 */
import type { AtmoLevel, AtmoQualificatif, PollenLevel } from './types';

export const ATMO_LEVEL_LABELS: Record<AtmoLevel, AtmoQualificatif> = {
  1: 'bon',
  2: 'moyen',
  3: 'dégradé',
  4: 'mauvais',
  5: 'très mauvais',
  6: 'extrêmement mauvais',
};

export const POLLEN_LEVEL_LABELS: Record<PollenLevel, string> = {
  0: 'indisponible',
  1: 'très faible',
  2: 'faible',
  3: 'modéré',
  4: 'élevé',
  5: 'très élevé',
  6: 'extrêmement élevé',
};

/** Token CSS du niveau ATMO (à utiliser comme background/color via var()). */
export function atmoLevelToken(level: AtmoLevel | null | undefined): string {
  if (level == null) return 'var(--atmo-level-na)';
  return `var(--atmo-level-${level})`;
}

/** Token CSS du niveau pollen. */
export function pollenLevelToken(level: PollenLevel | null | undefined): string {
  if (level == null) return 'var(--pollen-level-0)';
  return `var(--pollen-level-${level})`;
}

/**
 * Convertit un code numérique (string ou number) en AtmoLevel typé.
 * Renvoie null pour 0 (indisponible) ou valeurs hors plage.
 */
export function parseAtmoLevel(raw: unknown): AtmoLevel | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  return n as AtmoLevel;
}

/** Convertit un code en PollenLevel typé. 0 = indisponible mais reste valide. */
export function parsePollenLevel(raw: unknown): PollenLevel | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return n as PollenLevel;
}

/** Libellé qualificatif d'un AtmoLevel. */
export function atmoQualificatif(level: AtmoLevel): AtmoQualificatif {
  return ATMO_LEVEL_LABELS[level];
}

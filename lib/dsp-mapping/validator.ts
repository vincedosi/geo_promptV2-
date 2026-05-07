/**
 * MAGELIAN — Validation des en-têtes CSV vs mappings configurés.
 */

import type { SourceMapping, ValidationResult } from './types';

/**
 * Normalise une chaîne pour comparaison case-insensitive et trim.
 * Les en-têtes CSV des DSPs ont fréquemment des espaces parasites et
 * varient entre Postal Code / postal_code / postal code.
 */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Vérifie que tous les `source_column` requis pour un DSP donné sont
 * présents dans les en-têtes du CSV uploadé.
 *
 * - `missingRequired` : bloquant. Le caller doit retourner 400 à l'utilisateur.
 * - `unknownColumns` : informatif. Colonnes du CSV pas mappées du tout
 *   (peut être une régie ad hoc, des KPIs DSP-spécifiques pas configurés…).
 */
export function validateCsvHeaders(
  csvHeaders: string[],
  mappings: SourceMapping[],
): ValidationResult {
  const headersNormalized = csvHeaders.map(norm);
  const headersSet = new Set(headersNormalized);

  const required = mappings.filter((m) => m.isRequired);
  const mappingsByNorm = new Map(mappings.map((m) => [norm(m.sourceColumn), m]));

  const missingRequired = required
    .filter((m) => !headersSet.has(norm(m.sourceColumn)))
    .map((m) => m.sourceColumn);

  const unknownColumns = csvHeaders.filter(
    (h) => !mappingsByNorm.has(norm(h)),
  );

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    unknownColumns,
  };
}

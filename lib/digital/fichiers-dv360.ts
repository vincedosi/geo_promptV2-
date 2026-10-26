/**
 * @file lib/digital/fichiers-dv360.ts — les deux fichiers DV360 d'une liste de codes postaux (lot 7, T2, A-6).
 *
 * Extraits de `GET /api/custom-geo/[id]/export` (formats `dv360_cp` et `dv360_sdf`), qui les appelle toujours : le
 * fichier d'une ZONE vivante et celui d'une EXTRACTION figée (`…/extractions/[version]/fichier`) sont écrits par le
 * même code, octet pour octet. Aucune I/O : le mapping CP → geo IDs Google est un référentiel en mémoire.
 */
import { mapPostalCodesToGeoIds, GEO_POSTAL_FR_VERSION } from '@/lib/digital/dv360-geo';

/**
 * Un code postal par ligne : prêt à coller dans le ciblage géo DV360 (bulk entry, type « Postal code », pays France).
 */
export function texteCpDv360(cps: string[]): string {
  return cps.join('\n');
}

/**
 * Les geo IDs Google prêts à coller dans la colonne « Geography Targeting - Include » d'un SDF Line Items, avec les
 * CP sans geo ID listés à part (à cibler manuellement) — jamais tus.
 *
 * @param nomZone - Ce que le fichier nomme en première ligne (« Zone : … »).
 */
export function texteSdfDv360(nomZone: string, cps: string[]): string {
  const { mapped, unmapped, sdfString } = mapPostalCodesToGeoIds(cps);
  const lines = [
    `Zone : ${nomZone}`,
    `Référentiel geotargets Google ${GEO_POSTAL_FR_VERSION} — ${mapped.length} CP mappés sur ${cps.length}`,
    '',
    'Geography Targeting - Include (à coller dans le SDF Line Items) :',
    sdfString || '(aucun geo ID mappé)',
  ];
  if (unmapped.length > 0) {
    lines.push(
      '',
      `Codes postaux sans geo ID Google (${unmapped.length}, à cibler manuellement) :`,
      unmapped.join(', '),
    );
  }
  return lines.join('\n');
}

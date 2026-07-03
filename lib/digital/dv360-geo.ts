/**
 * MAGELIAN — mapping codes postaux français → Criteria IDs Google (geotargets).
 * Utilisé par l'export DV360 (SDF) et le push API targeting.
 *
 * Le référentiel lib/digital/google-geo-postal-fr.json est généré par
 * scripts/build_google_geotargets_fr.ts depuis le CSV geotargets officiel
 * Google (versionné par date de release). Chargé en mémoire : zéro I/O DB.
 */
import geoPostalFr from './google-geo-postal-fr.json';

const REGISTRY = geoPostalFr as {
  _version: string;
  count: number;
  postal: Record<string, number>;
};

export const GEO_POSTAL_FR_VERSION = REGISTRY._version;

export interface Dv360GeoMapping {
  /** Codes postaux résolus en Criteria ID Google */
  mapped: { code_postal: string; geo_id: number }[];
  /** Codes postaux sans équivalent geotargets (à cibler manuellement) */
  unmapped: string[];
  /** Liste prête à coller dans une colonne SDF « Geography Targeting - Include » */
  sdfString: string;
}

/** Résout une liste de codes postaux français en geo IDs Google. */
export function mapPostalCodesToGeoIds(codes: string[]): Dv360GeoMapping {
  const mapped: { code_postal: string; geo_id: number }[] = [];
  const unmapped: string[] = [];

  for (const raw of codes) {
    const cp = raw.trim();
    const geoId = REGISTRY.postal[cp];
    if (geoId !== undefined) {
      mapped.push({ code_postal: cp, geo_id: geoId });
    } else {
      unmapped.push(cp);
    }
  }

  const sdfString = mapped.length > 0
    ? `(${mapped.map((m) => m.geo_id).join('; ')};)`
    : '';

  return { mapped, unmapped, sdfString };
}

/**
 * Types partagés client/serveur pour l'indicateur civique
 * "Santé environnementale" (qualité air ATMO + pollen).
 *
 * Source de données : Atmo Data v2 (https://admindata.atmo-france.org)
 * Licence : ODbL — mention "Source : Atmo France et les AASQA" obligatoire.
 */

export type AtmoLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type PollenLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AtmoQualificatif =
  | 'bon'
  | 'moyen'
  | 'dégradé'
  | 'mauvais'
  | 'très mauvais'
  | 'extrêmement mauvais';

export type PollenSpecies =
  | 'ambroisie'
  | 'armoise'
  | 'aulne'
  | 'bouleau'
  | 'graminees'
  | 'olivier';

export interface AirIndicator {
  /** Date de validité au format YYYY-MM-DD (jour J). */
  date: string;
  indice: AtmoLevel;
  qualificatif: AtmoQualificatif;
  /** Sous-indices par polluant (échelle ATMO 1-6, identique à l'indice global). */
  sous_indices: {
    pm10: AtmoLevel | null;
    pm25: AtmoLevel | null;
    no2: AtmoLevel | null;
    o3: AtmoLevel | null;
    so2: AtmoLevel | null;
  };
  previsionJ1?: {
    indice: AtmoLevel;
    qualificatif: AtmoQualificatif;
  };
}

export interface PollenIndicator {
  /** Date de validité au format YYYY-MM-DD (jour J). */
  date: string;
  /** Indice global pollen (0 = indisponible, 1-6 = très faible → extrêmement élevé). */
  indice_global: PollenLevel;
  especes: Record<PollenSpecies, PollenLevel>;
  previsionJ1?: { indice: PollenLevel };
  previsionJ2?: { indice: PollenLevel };
}

export interface HealthIndicator {
  code_insee: string;
  commune: string;
  air: AirIndicator | null;
  pollen: PollenIndicator | null;
  /** ISO 8601 — moment où la donnée a été récupérée auprès du provider. */
  fetchedAt: string;
  source: 'Atmo France et AASQA';
  /** true si la donnée vient du fallback cache > 24h après échec provider. */
  stale: boolean;
}

export type HealthProviderName = 'atmofrance' | 'mock';

/** Entrée bulk : indice pollen d'une commune (jour J, sans prévisions). */
export interface PollenBulkEntry {
  indice_global: PollenLevel;
  especes: Record<PollenSpecies, PollenLevel>;
}

export type AtmoPolluant = 'no2' | 'o3' | 'pm10' | 'pm25' | 'so2';

/** Entrée bulk : indice ATMO d'une commune (jour J). 0 = sous-indice absent. */
export interface AtmoBulkEntry {
  indice_global: AtmoLevel;
  polluants: Record<AtmoPolluant, AtmoLevel | 0>;
}

export interface HealthProvider {
  readonly name: HealthProviderName;
  fetchHealth(codeInsee: string): Promise<HealthIndicator | null>;
  /**
   * Récupération nationale de l'indice pollen du jour (ingestion carte des
   * allergènes). Renvoie une Map code INSEE → niveaux, ou null si le provider
   * ne sait pas répondre en masse — l'appelant retombe alors sur
   * l'échantillonnage par département.
   * @param communeCodes codes INSEE attendus (sert au mock ; ignoré par Atmo)
   */
  fetchPollenBulk?(
    communeCodes: string[],
    onLog?: (message: string) => void,
  ): Promise<Map<string, PollenBulkEntry> | null>;
}

export interface HealthApiResponse {
  data: HealthIndicator | null;
  provider: HealthProviderName;
  /** Présent uniquement quand data === null. */
  error?: 'unavailable' | 'invalid_code';
  message?: string;
}

/**
 * GEOMATIK — Types pour le système de mapping DSP dynamique.
 *
 * Miroir exact du DDL de `public.dsp_source_mappings` posé par le chantier A1
 * (cf. supabase/migrations/20260428_dsp_data_extension_chantier_a1.sql).
 */

export type TargetLocation = 'core' | 'metrics' | 'dimension';

export type DataType =
  | 'int'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'date'
  | 'timestamp';

export interface SourceMapping {
  id: string;
  dspSource: string;
  sourceColumn: string;
  targetField: string;
  targetLocation: TargetLocation;
  dataType: DataType;
  transform: string | null;
  isRequired: boolean;
  displayOrder: number;
  notes: string | null;
}

/** Erreur typée : aucun mapping configuré pour le DSP demandé. */
export class NoMappingsFoundError extends Error {
  constructor(public readonly dspSource: string) {
    super(
      `Aucun mapping configuré pour le DSP '${dspSource}'. ` +
        `Contacte un admin pour configurer dsp_source_mappings.`,
    );
    this.name = 'NoMappingsFoundError';
  }
}

/** Erreur typée : transform référencée en base mais pas implémentée côté code. */
export class UnknownTransformError extends Error {
  constructor(public readonly transform: string) {
    super(
      `Transform inconnue : '${transform}'. ` +
        `Vérifie listKnownTransforms() ou ajoute la fonction dans lib/dsp-mapping/transformer.ts.`,
    );
    this.name = 'UnknownTransformError';
  }
}

/** Erreur typée : colonne CSV requise absente du fichier uploadé. */
export class MissingRequiredColumnError extends Error {
  constructor(public readonly missingColumns: string[]) {
    super(
      `Colonnes CSV requises manquantes : ${missingColumns.join(', ')}. ` +
        `Vérifie le fichier uploadé.`,
    );
    this.name = 'MissingRequiredColumnError';
  }
}

/** Erreur typée : valeur impossible à caster vers le data_type cible. */
export class DataTypeCastError extends Error {
  constructor(
    public readonly value: unknown,
    public readonly dataType: DataType,
    public readonly column: string,
  ) {
    super(
      `Impossible de caster '${String(value)}' vers ${dataType} pour la colonne '${column}'.`,
    );
    this.name = 'DataTypeCastError';
  }
}

export interface ParsedRow {
  /** Colonnes natives sur dsp_campaign_data (date, country, postal_code, impressions, clicks, spend, tracked_ads…). */
  core: Record<string, unknown>;
  /** Clés du JSONB metrics (leads, viewable_impressions, bid_*, video_completions…). */
  metrics: Record<string, unknown>;
  /** Colonnes dimensionnelles natives (media, city, region, dma_region, creative_id, device_type, format, campaign_name). */
  dimensions: Record<string, unknown>;
}

export interface ValidationResult {
  /** True si toutes les colonnes requises sont présentes. */
  valid: boolean;
  /** Colonnes requises manquantes (bloquant). */
  missingRequired: string[];
  /** Colonnes du CSV pas mappées (warning, pas bloquant — info pour l'utilisateur). */
  unknownColumns: string[];
}

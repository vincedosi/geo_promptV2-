/**
 * GENESIS — Import Universel — Column Detector
 * Détecte les colonnes, infère les types, suggère le mapping
 * Port TypeScript de panneaux_import.py _resolve_col()
 */
import type { ColumnInfo } from './types';

// ============================================================
// Column name normalization
// Mirrors Python loader.py normalize_column_name()
// ============================================================

export function normalizeColumnName(col: string): string {
  return col
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .toLowerCase()
    .replace(/[\s\-\.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

// ============================================================
// Column analysis (sample values, null count)
// ============================================================

export function detectColumns(rows: Record<string, string | null>[]): ColumnInfo[] {
  if (rows.length === 0) return [];

  const columns = Object.keys(rows[0]);
  const sampleSize = Math.min(rows.length, 100);

  return columns.map((colName) => {
    let nullCount = 0;
    const valuesSet = new Set<string>();

    for (let i = 0; i < sampleSize; i++) {
      const val = rows[i][colName];
      if (val === null || val === undefined || val.trim() === '') {
        nullCount++;
      } else if (valuesSet.size < 5) {
        valuesSet.add(val);
      }
    }

    return {
      name: colName,
      sampleValues: Array.from(valuesSet),
      nullCount,
    };
  });
}

// ============================================================
// Fuzzy column matching — Auto-suggestion
// Mirrors panneaux_import.py _resolve_col() pattern
// ============================================================

const GENESIS_FIELD_CANDIDATES: Record<string, string[]> = {
  nom: ['nom', 'name', 'label', 'appellation', 'designation', 'raison_sociale', 'libelle', 'titre'],
  adresse: ['adresse', 'address', 'adresse_1', 'rue', 'voie', 'adresse_principale'],
  ville: ['ville', 'city', 'commune', 'nom_commune', 'localite', 'lib_commune', 'libelle_commune'],
  code_postal: ['code_postal', 'zip_code', 'cp', 'codepostal', 'postal_code', 'zipcode'],
  departement: ['departement', 'dept', 'area_name', 'zone', 'nom_departement', 'libelle_departement'],
  region: ['region', 'region_name', 'nom_region', 'libelle_region'],
  lat: ['latitude', 'lat', 'coord_lat', 'gps_lat', 'wgs84_lat'],
  lng: ['longitude', 'lng', 'lon', 'long', 'coord_lng', 'gps_lng', 'wgs84_lng'],
  x: ['x', 'coord_x', 'lambert_x', 'l93_x'],
  y: ['y', 'coord_y', 'lambert_y', 'l93_y'],
  reference_panneau: ['reference', 'external_id', 'id_panneau', 'ref', 'code', 'face_locator_external_id', 'reference_panneau'],
  type_panneau: ['format', 'type_panneau', 'type', 'format_panneau', 'produit'],
};

export function suggestMapping(fileColumns: string[]): Record<string, string | null> {
  const normalizedCols = fileColumns.map((c) => ({
    original: c,
    normalized: normalizeColumnName(c),
  }));

  const suggestions: Record<string, string | null> = {};

  for (const [genesisField, candidates] of Object.entries(GENESIS_FIELD_CANDIDATES)) {
    // Try exact match first, then partial match
    const exactMatch = normalizedCols.find((col) =>
      candidates.some((candidate) => col.normalized === candidate)
    );

    if (exactMatch) {
      suggestions[genesisField] = exactMatch.original;
      continue;
    }

    // Partial match (column name contains candidate)
    const partialMatch = normalizedCols.find((col) =>
      candidates.some((candidate) => col.normalized.includes(candidate))
    );

    suggestions[genesisField] = partialMatch?.original ?? null;
  }

  // Special case for GeoJSON: if _geojson_lat/_geojson_lng exist, suggest them
  if (fileColumns.includes('_geojson_lat')) {
    suggestions.lat = '_geojson_lat';
    suggestions.lng = '_geojson_lng';
  }

  return suggestions;
}

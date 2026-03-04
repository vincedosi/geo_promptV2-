/**
 * /api/admin/carreaux-infer-schema
 * 
 * Analyse un fichier carreaux (CSV/Excel) et:
 * 1. Détecte les colonnes
 * 2. Identifie lesquelles correspondent aux indicateurs INSEE
 * 3. Détecte la géométrie (WKT, GeoJSON, lat/lng)
 * 4. Propose les colonnes à importer
 * 5. Suggère le schéma SQL
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import type { CarreauxSchemaInference, ColumnDetection, INSEE_CARREAUX_INDICATORS } from '@/lib/import/types';

// ============================================================
// Utilitaires de détection
// ============================================================

// Tous les indicateurs INSEE Filosofi
const INSEE_INDICATORS_LIST = [
  'idcar', 'Ind', 'Ind_0_3', 'Ind_3_5', 'Ind_6_10', 'Ind_11_17', 'Ind_18_24',
  'Ind_25_39', 'Ind_40_54', 'Ind_55_64', 'Ind_65_79', 'Ind_80p',
  'Men', 'Men_pauv', 'Men_1ind', 'Men_5ind', 'Men_prop', 'Men_loc',
  'Ind_snv', 'revenu_moyen', 'pct_pauvres',
  'Log', 'Log_ap', 'Log_mais', 'Log_av45', 'Log_45_70', 'Log_70_90', 'Log_ap90', 'Log_surf',
  'densite', 'pct_jeunes', 'pct_actifs', 'pct_seniors',
];

function isGeometryColumn(name: string, sampleValue?: string): boolean {
  const nameLower = name.toLowerCase();
  // Patterns courants pour géométrie
  if (nameLower.includes('geom') || nameLower.includes('geometry') || nameLower.includes('shape')) {
    return true;
  }
  // WKT, GeoJSON
  if (sampleValue) {
    const sample = String(sampleValue).trim();
    if (sample.startsWith('POLYGON') || sample.startsWith('POINT') || sample.startsWith('{')) {
      return true;
    }
  }
  return false;
}

function isIdColumn(name: string): boolean {
  const nameLower = name.toLowerCase();
  return (
    nameLower === 'id' ||
    nameLower === 'idcar' ||
    nameLower === 'id_carr' ||
    nameLower.includes('identifier') ||
    nameLower === 'code'
  );
}

function matchInseeIndicator(columnName: string): string | null {
  // Exact match
  if (INSEE_INDICATORS_LIST.includes(columnName)) {
    return columnName;
  }
  // Case-insensitive exact match
  const upper = INSEE_INDICATORS_LIST.find(ind => ind.toLowerCase() === columnName.toLowerCase());
  if (upper) return upper;
  // Fuzzy match
  const lower = columnName.toLowerCase();
  for (const indicator of INSEE_INDICATORS_LIST) {
    if (lower.includes(indicator.toLowerCase()) || indicator.toLowerCase().includes(lower)) {
      return indicator;
    }
  }
  return null;
}

function inferColumnType(name: string, sampleValues: string[]): 'numeric' | 'text' | 'geometry' {
  if (isGeometryColumn(name, sampleValues[0])) {
    return 'geometry';
  }
  // Essayer de parser comme numérique
  const nums = sampleValues.filter(v => {
    if (!v) return false;
    const n = Number(v);
    return !isNaN(n);
  });
  if (nums.length / sampleValues.length > 0.7) {
    return 'numeric';
  }
  return 'text';
}

function suggestTableName(fileName: string): string {
  // Extraire le nom du fichier sans extension
  const base = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
  // Normaliser
  const normalized = base
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/, '');
  // Default si rien
  return normalized || 'carreaux_imported';
}

// ============================================================
// POST /api/admin/carreaux-infer-schema
// ============================================================

export async function POST(request: NextRequest) {
  try {
    // ── Vérifier admin ──
    const user = await requireAdmin();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { fileId, parseResult } = await request.json();

    if (!parseResult || !parseResult.columns) {
      return new Response(
        JSON.stringify({ error: 'Missing parseResult' }),
        { status: 400 }
      );
    }

    // ── Analyser les colonnes ──
    const detectedColumns: ColumnDetection[] = [];
    const geometryColumns: string[] = [];
    const idColumns: string[] = [];
    const inseeIndicators: { columnName: string; match: string }[] = [];
    const unknownColumns: string[] = [];

    for (const colInfo of parseResult.columns) {
      const { name, sampleValues } = colInfo;
      const sampleType = inferColumnType(name, sampleValues);

      let detectedAs: string | undefined;
      let recommendation: string | undefined;
      let isGeometry = false;
      let isInsee = false;

      // ── Logique de classement ──
      if (sampleType === 'geometry') {
        detectedAs = 'geometry';
        geometryColumns.push(name);
        isGeometry = true;
        recommendation = 'Géométrie (Polygon/Point)';
      } else if (isIdColumn(name)) {
        detectedAs = 'id';
        idColumns.push(name);
        recommendation = 'Identifiant carreau';
      } else {
        const match = matchInseeIndicator(name);
        if (match) {
          detectedAs = 'insee_indicator';
          inseeIndicators.push({ columnName: name, match });
          isInsee = true;
          recommendation = `Indicateur INSEE: ${match}`;
        } else {
          detectedAs = 'unknown';
          unknownColumns.push(name);
        }
      }

      detectedColumns.push({
        columnName: name,
        detectedAs,
        sampleValues: sampleValues.slice(0, 3),
        recommendation,
        isGeometry,
        isInseeIndicator: isInsee,
        sampleType,
      });
    }

    // ── Suggestion nom table ──
    const suggestedTableName = suggestTableName(parseResult.fileName);

    const result: CarreauxSchemaInference = {
      success: true,
      fileName: parseResult.fileName,
      totalColumns: parseResult.columns.length,
      detectedColumns,
      geometryColumns,
      idColumns,
      inseeIndicators,
      unknownColumns,
      suggestedTableName,
    };

    console.log('[carreaux-infer-schema]', {
      fileName: parseResult.fileName,
      totalCols: parseResult.columns.length,
      insee: inseeIndicators.length,
      geom: geometryColumns.length,
      id: idColumns.length,
      unknown: unknownColumns.length,
    });

    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err: any) {
    console.error('[carreaux-infer-schema] Error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
}

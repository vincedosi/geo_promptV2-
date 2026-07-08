/**
 * GENESIS — API Route — POST /api/admin/import-poi/dry-run
 * Dry-run: validate first N rows with mapping + geolocation
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseFile } from '@/lib/import/file-parser';
import { processRows } from '@/lib/import/validator';
import type { ImportConfig, GeocodeDetailedResult } from '@/lib/import/types';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { resolveSafeJsonPath } from '@/lib/api/safe-path';

export const dynamic = 'force-dynamic';

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');
const GEOCODE_DIR = path.join(os.tmpdir(), 'genesis-geocode');

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const config: ImportConfig & { geocodeId?: string } = await request.json();

    // Validate required fields
    if (!config.fileId) {
      return NextResponse.json({ success: false, error: 'fileId manquant' }, { status: 400 });
    }
    if (!config.geolocation?.mode) {
      return NextResponse.json({ success: false, error: 'Mode de geolocalisation requis' }, { status: 400 });
    }

    // Find temp file
    const tempFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(config.fileId));
    if (tempFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Fichier temporaire introuvable. Re-uploadez le fichier.' },
        { status: 404 }
      );
    }

    const tempPath = path.join(TEMP_DIR, tempFiles[0]);
    const buffer = fs.readFileSync(tempPath);
    const fileName = tempFiles[0];

    // Parse file
    const parsed = parseFile(buffer, fileName);

    // Apply limit (default 100 for dry-run)
    const limit = config.limit || 100;
    const rowsToTest = parsed.rows.slice(0, limit);

    // Load precomputed geocode results if available
    let preGeocodedResults: GeocodeDetailedResult[] | undefined;
    if (config.geocodeId) {
      // geocodeId DOIT être un UUID (prévient le path traversal)
      const geocodePath = resolveSafeJsonPath(GEOCODE_DIR, config.geocodeId);
      if (!geocodePath) {
        return NextResponse.json({ success: false, error: 'geocodeId invalide' }, { status: 400 });
      }
      if (fs.existsSync(geocodePath)) {
        const geocodeData = JSON.parse(fs.readFileSync(geocodePath, 'utf-8'));
        // Only pass results for rows in the test range
        preGeocodedResults = (geocodeData.results as GeocodeDetailedResult[])
          .filter((r) => r.rowIndex < limit);
        console.log(`[DRY-RUN] Using precomputed geocode results (${preGeocodedResults.length} rows)`);
      }
    }

    // Process rows: mapping + geolocation + validation
    const result = await processRows(
      rowsToTest,
      config.mapping,
      config.geolocation,
      config.dataType,
      {
        category: config.category,
        regie: config.regie,
        preGeocodedResults,
      }
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalRows: parsed.totalRows,
        testedRows: rowsToTest.length,
        validRows: result.validRows.length,
        invalidRows: result.invalidCount,
        missingCoords: result.missingCoords,
        geocodedRows: result.geocodedCount || undefined,
        geocodeErrors: result.geocodeErrors || undefined,
      },
      samplePoints: result.samplePoints,
      errors: result.errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors du dry-run';
    console.error('Dry-run error:', err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

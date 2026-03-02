/**
 * GENESIS — API Route — POST /api/admin/geocode/batch
 * Batch geocoding via BAN CSV endpoint.
 * Reads the uploaded temp file, geocodes all addresses, saves results to temp JSON.
 * Returns detailed geocode results with scores + status for review.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { parseFile } from '@/lib/import/file-parser';
import { geocodeBatchDetailed } from '@/lib/import/geocoder';
import type { GeocodeDetailedResult } from '@/lib/import/types';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');
const GEOCODE_DIR = path.join(os.tmpdir(), 'genesis-geocode');

// Ensure geocode temp dir exists
if (!fs.existsSync(GEOCODE_DIR)) {
  fs.mkdirSync(GEOCODE_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const body = await request.json();
    const { fileId, colAdresse, colCodePostal, colVille } = body as {
      fileId: string;
      colAdresse?: string;
      colCodePostal?: string;
      colVille?: string;
    };

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId manquant' }, { status: 400 });
    }

    if (!colAdresse && !colVille) {
      return NextResponse.json(
        { success: false, error: 'Au moins une colonne adresse ou ville est requise' },
        { status: 400 }
      );
    }

    // Find temp file
    const tempFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
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
    const totalRows = parsed.rows.length;

    console.log(`[GEOCODE-BATCH] Starting batch geocoding: ${totalRows} rows`);

    // Build address rows from parsed data
    const addressRows = parsed.rows.map((row) => ({
      adresse: colAdresse ? (row[colAdresse] || '') : '',
      code_postal: colCodePostal ? (row[colCodePostal] || '') : '',
      ville: colVille ? (row[colVille] || '') : '',
    }));

    // Geocode via BAN CSV batch
    const results: GeocodeDetailedResult[] = await geocodeBatchDetailed(addressRows);

    // Compute stats
    const stats = {
      green: results.filter((r) => r.status === 'green').length,
      orange: results.filter((r) => r.status === 'orange').length,
      red: results.filter((r) => r.status === 'red').length,
    };

    console.log(`[GEOCODE-BATCH] Done: ${stats.green} green, ${stats.orange} orange, ${stats.red} red`);

    // Save results to temp file for later use by dry-run/execute
    const geocodeId = randomUUID().slice(0, 12);
    const geocodePath = path.join(GEOCODE_DIR, `${geocodeId}.json`);
    fs.writeFileSync(geocodePath, JSON.stringify({
      geocodeId,
      totalRows,
      results,
      stats,
      createdAt: new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      geocodeId,
      totalRows,
      results,
      stats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors du geocodage';
    console.error('[GEOCODE-BATCH] Error:', err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

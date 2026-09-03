/**
 * GENESIS — API Route — POST /api/admin/import-poi/parse
 * Upload fichier(s) + parse + detection colonnes + suggestion mapping
 * Supporte formats simples (CSV/XLSX/GeoJSON) ET bundles (Shapefile)
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { parseFile, parseShapefile, type ShapefileBundle } from '@/lib/import/file-parser';
import { detectColumns, suggestMapping } from '@/lib/import/column-detector';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

// Temp directory for uploaded files
const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');
const MAX_UPLOAD = 25 * 1024 * 1024; // 25 Mo par fichier

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Group files by base name for Shapefile detection
 * e.g., [file.shp, file.dbf, file.prj] → [{name: "file", files: {shp, dbf, prj}}]
 */
function groupShapefileComponents(
  files: File[]
): {
  singleFiles: File[];
  shapefileBundles: { baseName: string; files: Record<string, File> }[];
} {
  const shapeExtensions = ['shp', 'dbf', 'prj', 'shx'];
  const shapeFileMap: Record<string, Record<string, File>> = {};
  const singleFiles: File[] = [];

  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (!shapeExtensions.includes(ext)) {
      singleFiles.push(file);
      continue;
    }

    const baseName = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase();
    if (!shapeFileMap[baseName]) {
      shapeFileMap[baseName] = {};
    }
    shapeFileMap[baseName][ext] = file;
  }

  // Only return bundles with at least .shp + .dbf
  const shapefileBundles = Object.entries(shapeFileMap)
    .filter(([, files]) => files['shp'] && files['dbf'])
    .map(([baseName, files]) => ({ baseName, files }));

  return { singleFiles, shapefileBundles };
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const formData = await request.formData();
    const fileArray = formData.getAll('files') as File[];
    const legacyFile = formData.get('file') as File | null;

    // Support both new multi-file and legacy single-file uploads
    const files = fileArray.length > 0 ? fileArray : legacyFile ? [legacyFile] : [];

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni' },
        { status: 400 }
      );
    }

    // Validate file types + taille AVANT toute lecture en mémoire
    const allowedExts = ['csv', 'txt', 'tsv', 'xlsx', 'xlsm', 'geojson', 'json', 'shp', 'dbf', 'prj', 'shx'];
    for (const file of files) {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      if (!allowedExts.includes(ext)) {
        return NextResponse.json(
          {
            success: false,
            error: `Format non supporté: .${ext}\nFormats acceptés: ${allowedExts.join(', ')}`,
          },
          { status: 400 }
        );
      }
      if (file.size > MAX_UPLOAD) {
        return NextResponse.json(
          { success: false, error: `Fichier trop volumineux: ${file.name} (limite : ${MAX_UPLOAD / 1024 / 1024} Mo)` },
          { status: 413 }
        );
      }
    }

    // Group Shapefile components
    const { singleFiles, shapefileBundles } = groupShapefileComponents(files);

    if (shapefileBundles.length > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Un seul Shapefile à la fois. Veuillez uploader 1 ensemble de fichiers (.shp+.dbf+.prj+.shx).',
        },
        { status: 400 }
      );
    }

    if (singleFiles.length > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Un seul fichier à la fois (sauf pour Shapefiles).',
        },
        { status: 400 }
      );
    }

    ensureTempDir();
    const fileId = randomUUID();
    let parsed;
    let fileName: string;

    // ============================================================
    // Case 1: Shapefile bundle (.shp + .dbf + .prj + .shx)
    // ============================================================
    if (shapefileBundles.length === 1) {
      const bundle = shapefileBundles[0];
      const tempFileIds: string[] = [];

      try {
        // Save all Shapefile components to temp
        const shapefileBundle: ShapefileBundle = {};

        for (const [ext, file] of Object.entries(bundle.files)) {
          const buffer = Buffer.from(await file.arrayBuffer());
          shapefileBundle[ext as keyof ShapefileBundle] = buffer;
          tempFileIds.push(`${fileId}.${ext}`);
        }

        // Parse Shapefile
        parsed = await parseShapefile(shapefileBundle);
        fileName = `${bundle.baseName}.shp (bundle ${Object.keys(bundle.files).join('+')})`;

        // Schedule cleanup
        setTimeout(() => {
          tempFileIds.forEach((tempFile) => {
            const tempPath = path.join(TEMP_DIR, tempFile);
            try {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch { /* ignore */ }
          });
        }, 3600000);
      } catch (err: unknown) {
        throw new Error(
          `Erreur parsing Shapefile: ${err instanceof Error ? err.message : 'Erreur inconnue'}`
        );
      }
    }
    // ============================================================
    // Case 2: Single file (CSV/XLSX/GeoJSON)
    // ============================================================
    else {
      const file = singleFiles[0];
      const ext = file.name.toLowerCase().split('.').pop() || '';
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Save to temp directory
      const tempFileName = `${fileId}.${ext}`;
      const tempPath = path.join(TEMP_DIR, tempFileName);
      fs.writeFileSync(tempPath, buffer);

      // Parse file
      parsed = await parseFile(buffer, file.name);
      fileName = file.name;

      // Schedule cleanup
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch { /* ignore */ }
      }, 3600000);
    }

    // Detect columns from first 100 rows
    const columnInfos = detectColumns(parsed.rows);

    // Auto-suggest mapping
    const columnNames = columnInfos.map((c) => c.name);
    const suggested = suggestMapping(columnNames);

    // Preview first 5 rows
    const preview = parsed.rows.slice(0, 5);

    return NextResponse.json({
      success: true,
      fileName,
      fileSize: files.reduce((sum, f) => sum + f.size, 0),
      format: parsed.format,
      encoding: parsed.encoding,
      separator: parsed.separator,
      totalRows: parsed.totalRows,
      columns: columnInfos,
      preview,
      suggestedMapping: suggested,
      fileId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors du parsing';
    console.error('Parse error:', err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * GENESIS — API Route — POST /api/admin/import-poi/parse
 * Upload fichier + parse + detection colonnes + suggestion mapping
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { parseFile } from '@/lib/import/file-parser';
import { detectColumns, suggestMapping } from '@/lib/import/column-detector';

// Temp directory for uploaded files
const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni' },
        { status: 400 }
      );
    }

    // Validate file extension
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const allowedExts = ['csv', 'txt', 'tsv', 'xlsx', 'xls', 'xlsm', 'geojson', 'json'];
    if (!allowedExts.includes(ext)) {
      return NextResponse.json(
        { success: false, error: `Format non supporte: .${ext}\nFormats acceptes: ${allowedExts.join(', ')}` },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to temp directory
    ensureTempDir();
    const fileId = randomUUID();
    const tempFileName = `${fileId}.${ext}`;
    const tempPath = path.join(TEMP_DIR, tempFileName);
    fs.writeFileSync(tempPath, buffer);

    // Parse file
    const parsed = parseFile(buffer, file.name);

    // Detect columns from first 100 rows
    const columnInfos = detectColumns(parsed.rows);

    // Auto-suggest mapping
    const columnNames = columnInfos.map((c) => c.name);
    const suggested = suggestMapping(columnNames);

    // Preview first 5 rows
    const preview = parsed.rows.slice(0, 5);

    // Schedule temp file cleanup after 1 hour
    setTimeout(() => {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch { /* ignore */ }
    }, 3600000);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
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

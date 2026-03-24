/**
 * GENESIS — POST /api/integration-panneaux/parse
 * Upload CSV / Excel / Shapefile (SHP+DBF multi-file)
 * Returns: column info + Smart Mapping suggestions + preview
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { parseFile } from '@/lib/import/file-parser';
import { parseShapefile } from '@/lib/import/shp-parser';
import { detectColumns, suggestMapping } from '@/lib/import/column-detector';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-panneaux');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ─── Panneaux-specific column synonyms ─────────────────────────────────────
// These extend the base GENESIS_FIELD_CANDIDATES from column-detector
const PANNEAUX_EXTRA_CANDIDATES: Record<string, string[]> = {
  nom_regie: [
    'regie', 'nom_regie', 'afficheur', 'exploitant', 'operateur', 'owner', 'vendor',
    'commercial_owner_name', 'owner_name',
  ],
  nom_reseau: [
    'reseau', 'nom_reseau', 'network', 'circuit', 'produit', 'line', 'campaign',
    'reseau_nom', 'product_name',
  ],
  nb_faces: [
    'nb_faces', 'faces', 'nombre_faces', 'nbfaces', 'face_count', 'nb_panneaux',
    'face_number', 'faces_count',
  ],
  format_digital: [
    'digital', 'numerique', 'format_digital', 'is_digital', 'digi', 'dynamique',
    'type_affichage', 'led',
  ],
  eclaire: [
    'eclaire', 'illumine', 'illuminated', 'backlit', 'lumineux', 'lighting', 'lumineuse',
    'is_illuminated', 'illumination',
  ],
  audience_vac: [
    'audience', 'vac', 'audience_vac', 'impact', 'grp', 'contacts', 'audience_totale',
    'affinite', 'reach',
  ],
  // coordinates — SHP files expose these automatically
  x: ['x', '_shp_x', 'coord_x', 'lambert_x', 'l93_x', 'xcoord', 'xcoordin', 'coordx'],
  y: ['y', '_shp_y', 'coord_y', 'lambert_y', 'l93_y', 'ycoord', 'ycoordin', 'coordy'],
};

function suggestPanneauxMapping(fileColumns: string[]): Record<string, string | null> {
  // Base suggestions from existing detector
  const base = suggestMapping(fileColumns);

  // Extend with panneaux-specific fields
  const normalised = fileColumns.map((c) => ({
    original: c,
    norm: c
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s\-.]+/g, '_')
      .replace(/[^a-z0-9_]/g, ''),
  }));

  for (const [field, candidates] of Object.entries(PANNEAUX_EXTRA_CANDIDATES)) {
    if (base[field]) continue; // already matched by base detector
    const exact = normalised.find((c) => candidates.includes(c.norm));
    if (exact) { base[field] = exact.original; continue; }
    const partial = normalised.find((c) => candidates.some((cand) => c.norm.includes(cand)));
    base[field] = partial?.original ?? null;
  }

  // If SHP columns present, auto-detect Lambert 93 vs WGS84
  if (base.x === '_shp_x' || base.y === '_shp_y') {
    base._shp_coords = 'true'; // hint for frontend: pre-select Lambert93 or GPS mode
  }

  return base;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  ensureTempDir();

  try {
    const formData = await request.formData();

    // Detect upload mode: shapefile (shp+dbf) or single file (csv/xlsx)
    const shpFile = formData.get('shp') as File | null;
    const dbfFile = formData.get('dbf') as File | null;
    const singleFile = formData.get('file') as File | null;

    let rows: Record<string, string | null>[];
    let format: string;
    let encoding = 'utf-8';
    let separator = '';
    let totalRows: number;
    let fileId: string;
    let fileName: string;
    let fileSize: number;

    if (shpFile && dbfFile) {
      // ── Shapefile mode ──────────────────────────────────────
      const shpBuf = Buffer.from(await shpFile.arrayBuffer());
      const dbfBuf = Buffer.from(await dbfFile.arrayBuffer());

      const parsed = parseShapefile(shpBuf, dbfBuf);
      rows = parsed.rows;
      format = 'shapefile';
      totalRows = parsed.totalRows;
      fileName = shpFile.name;
      fileSize = shpFile.size + dbfFile.size;

      // Save SHP as a SHP+DBF pair in temp dir (serialise as JSON for re-use in execute)
      fileId = randomUUID();
      const tempPath = path.join(TEMP_DIR, `${fileId}.shp.json`);
      fs.writeFileSync(tempPath, JSON.stringify(parsed.rows));

      setTimeout(() => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
      }, 3600000);
    } else if (singleFile) {
      // ── CSV / Excel mode ────────────────────────────────────
      const ext = singleFile.name.toLowerCase().split('.').pop() || '';
      const allowed = ['csv', 'txt', 'tsv', 'xlsx', 'xls', 'xlsm'];
      if (!allowed.includes(ext)) {
        return NextResponse.json(
          { success: false, error: `Format non supporté : .${ext}. Acceptés : CSV, Excel, SHP` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await singleFile.arrayBuffer());
      const parsed = parseFile(buffer, singleFile.name);
      rows = parsed.rows;
      format = parsed.format;
      encoding = parsed.encoding;
      separator = parsed.separator;
      totalRows = parsed.totalRows;
      fileName = singleFile.name;
      fileSize = singleFile.size;

      fileId = randomUUID();
      const tempPath = path.join(TEMP_DIR, `${fileId}.${ext}`);
      fs.writeFileSync(tempPath, buffer);

      setTimeout(() => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
      }, 3600000);
    } else {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni. Envoyez "file" (CSV/Excel) ou "shp"+"dbf" (Shapefile).' },
        { status: 400 }
      );
    }

    // Column analysis + Smart Mapping
    const columns = detectColumns(rows.slice(0, 200));
    const columnNames = columns.map((c) => c.name);
    const suggestedMapping = suggestPanneauxMapping(columnNames);
    const preview = rows.slice(0, 5);

    return NextResponse.json({
      success: true,
      fileName,
      fileSize,
      format,
      encoding,
      separator,
      totalRows,
      columns,
      preview,
      suggestedMapping,
      fileId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[integration-panneaux/parse]', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

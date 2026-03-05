/**
 * GENESIS — API Route — /api/admin/preview-carreaux
 * POST : charge N lignes du fichier source et retourne les colonnes disponibles
 *        avec leurs types (id / number / string) et 3 valeurs d'exemple.
 *
 * NOTE: La prévisualisation se fait désormais côté client (page.tsx) pour
 *       CSV, Excel, GeoJSON et DBF. Cette route ne sert plus que de fallback
 *       pour les formats nécessitant un traitement serveur (ZIP, GPKG…).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { parseFile, parseShapefile } from '@/lib/import/file-parser';
import type { ShapefileBundle } from '@/lib/import/file-parser';

const ID_PATTERNS = new Set([
  'idcar', 'id', 'idcom', 'idk', 'id_car', 'id_carreau',
  'code_iris', 'depcom', 'dep', 'reg', 'epci', 'id_inspire',
  'lcog_geo', 'i_est_cr',
]);

function classifyColumn(name: string, values: (string | null)[]): { type: string; dtype: string } {
  const n = name.toLowerCase().trim();
  if (ID_PATTERNS.has(n) || n.startsWith('id_') || n.startsWith('code_')) {
    return { type: 'id', dtype: 'object' };
  }
  const nonNull = values.filter((v): v is string => v !== null && v.trim() !== '');
  if (nonNull.length === 0) return { type: 'string', dtype: 'object' };
  let intCount = 0, floatCount = 0;
  for (const v of nonNull) {
    const num = Number(v.replace(',', '.'));
    if (!isNaN(num) && v.trim() !== '') {
      Number.isInteger(num) ? intCount++ : floatCount++;
    }
  }
  if ((intCount + floatCount) / nonNull.length > 0.7) {
    return { type: 'number', dtype: floatCount > 0 ? 'float64' : 'int64' };
  }
  return { type: 'string', dtype: 'object' };
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err: any) {
    console.error('[preview-carreaux] FormData parse error:', err.message);
    return NextResponse.json(
      { error: 'Impossible de lire le fichier uploadé. Essayez un fichier plus petit ou un autre format.' },
      { status: 400 }
    );
  }

  try {
    const file = formData.get('file') as File | null;
    const dbfFile = formData.get('dbfFile') as File | null;
    const shpFile = formData.get('shpFile') as File | null;
    const shxFile = formData.get('shxFile') as File | null;
    const prjFile = formData.get('prjFile') as File | null;

    // Determine parsing strategy
    const isShapefile = !!(shpFile || dbfFile);
    let rows: Record<string, string | null>[] = [];

    if (isShapefile && dbfFile) {
      const bundle: ShapefileBundle = {
        dbf: Buffer.from(await dbfFile.arrayBuffer()),
        shp: shpFile ? Buffer.from(await shpFile.arrayBuffer()) : undefined,
        shx: shxFile ? Buffer.from(await shxFile.arrayBuffer()) : undefined,
        prj: prjFile ? Buffer.from(await prjFile.arrayBuffer()) : undefined,
      };
      const parsed = await parseShapefile(bundle);
      rows = parsed.rows.slice(0, 10);
    } else if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseFile(buffer, file.name);
      rows = parsed.rows.slice(0, 10);
    } else {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Aucune donnée trouvée dans le fichier' }, { status: 400 });
    }

    // Build columns info
    const columns: Record<string, { type: string; dtype: string; samples: string[] }> = {};
    const keys = Object.keys(rows[0]);
    for (const col of keys) {
      const values = rows.map(r => r[col] ?? null);
      const { type, dtype } = classifyColumn(col, values);
      const samples = values.filter((v): v is string => v !== null && v.trim() !== '').slice(0, 3);
      columns[col] = { type, dtype, samples };
    }

    console.log(`[preview-carreaux] ${Object.keys(columns).length} colonnes trouvées (Node.js)`);
    return NextResponse.json({ success: true, columns });
  } catch (err: any) {
    console.error('[preview-carreaux] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

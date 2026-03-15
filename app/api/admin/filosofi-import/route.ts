/**
 * POST /api/admin/filosofi-import
 * Reçoit un lot de lignes Parquet (déjà parsées côté client) et les insère
 * dans carreaux_filosofi via le RPC import_carreaux_batch.
 *
 * Body JSON : { data: Record<string,unknown>[], columns: string[], resolution: string, millesime: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createClient } from '@supabase/supabase-js';
import proj4 from 'proj4';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// EPSG:2154 — Lambert 93
proj4.defs(
  'EPSG:2154',
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// EPSG:3035 — ETRS89 / LAEA (utilisé par les fichiers Filosofi INSEE)
proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

function idcarToWKT(idcar: string, resolution: string): string | null {
  const m = idcar.match(/N(\d+)E(\d+)/);
  if (!m) return null;

  const northing = parseInt(m[1], 10);
  const easting = parseInt(m[2], 10);
  const size = resolution === '1km' ? 1000 : 200;

  // Détecte la projection selon l'ordre de grandeur des coordonnées
  // Lambert 93 : easting ~700000-1300000, northing ~6000000-7200000
  // EPSG:3035 : easting ~3000000-5000000, northing ~2000000-4000000
  const srcProj =
    easting > 2_000_000 ? 'EPSG:3035' : 'EPSG:2154';

  const corners: [number, number][] = [
    [easting, northing],
    [easting + size, northing],
    [easting + size, northing + size],
    [easting, northing + size],
    [easting, northing],
  ];

  try {
    const wgs84Corners = corners.map(([x, y]) => {
      const [lon, lat] = proj4(srcProj, 'WGS84', [x, y]);
      return `${lon.toFixed(8)} ${lat.toFixed(8)}`;
    });
    return `POLYGON((${wgs84Corners.join(', ')}))`;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  let body: { data: Record<string, unknown>[]; columns: string[]; idcar_col?: string; geom_col?: string; resolution?: string; millesime?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { data: rows, columns, resolution = '200m', millesime = '2021' } = body;
  // geom_col : si fourni, la géométrie WKT est déjà dans cette colonne (mode shapefile)
  const geomCol: string | undefined = body.geom_col as string | undefined;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ inserted: 0, errors: 0, skipped: 0 });
  }

  // Utiliser idcar_col si fourni, sinon auto-détecter
  const idcarCol = (body.idcar_col as string | undefined) ??
    columns.find(c => c.toLowerCase() === 'idcar') ??
    columns.find(c => c.toLowerCase().startsWith('idcar')) ??
    columns.find(c => c.toLowerCase().includes('idcar')) ??
    'idcar';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const batch: { idcar: string; geom_wkt: string; metadata: Record<string, unknown> }[] = [];
  let skipped = 0;
  let autoIdx = 0;

  for (const row of rows) {
    let wkt: string | null;
    let idcar: string;

    if (geomCol) {
      // Mode shapefile : géométrie pré-calculée dans la colonne geomCol
      wkt = row[geomCol] ? String(row[geomCol]) : null;
      idcar = idcarCol && row[idcarCol] ? String(row[idcarCol]) : `shp_${resolution}_${millesime}_${autoIdx++}`;
    } else {
      // Mode parquet : décoder idcar → WKT
      idcar = String(row[idcarCol] ?? '');
      if (!idcar) { skipped++; continue; }
      wkt = idcarToWKT(idcar, resolution);
    }

    if (!wkt) { skipped++; continue; }

    const skipCols = new Set([idcarCol, geomCol].filter(Boolean) as string[]);
    const metadata: Record<string, unknown> = {};
    columns.forEach(col => {
      if (skipCols.has(col)) return;
      const val = row[col];
      if (val !== null && val !== undefined) metadata[col.toLowerCase()] = val;
    });

    batch.push({ idcar, geom_wkt: wkt, metadata });
  }

  if (batch.length === 0) {
    return NextResponse.json({ inserted: 0, errors: 0, skipped });
  }

  const { error } = await supabase.rpc('import_carreaux_batch', {
    p_idcars:      batch.map(r => r.idcar),
    p_resolutions: batch.map(() => resolution),
    p_millesimes:  batch.map(() => millesime),
    p_geom_wkts:   batch.map(r => r.geom_wkt),
    p_metadatas:   batch.map(r => r.metadata),
  });

  if (error) {
    console.error('[filosofi-import] RPC error:', error.message);
    return NextResponse.json(
      { error: error.message, inserted: 0, errors: batch.length, skipped },
      { status: 500 }
    );
  }

  return NextResponse.json({ inserted: batch.length, errors: 0, skipped });
}

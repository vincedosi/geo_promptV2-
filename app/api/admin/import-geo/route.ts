import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import postgres from 'postgres';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface ImportRow {
  idcar: string;
  resolution: string;
  millesime: string;
  geom_wkt: string;
  metadata: Record<string, unknown>;
}

/**
 * POST /api/admin/import-geo
 * Insère un batch de features dans carreaux_filosofi via connexion PostgreSQL directe.
 * Bypass complet de PostgREST (pas de cache schema).
 * Body: { rows: Array<{ idcar, resolution, millesime, geom_wkt, metadata }> }
 *
 * Requiert SUPABASE_DB_URL dans .env.local
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return NextResponse.json({
      success: false,
      error: 'SUPABASE_DB_URL manquante dans .env.local. Allez dans Supabase Dashboard → Settings → Database → Connection string (URI) et copiez-la.',
    }, { status: 500 });
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const { rows } = await request.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'rows vide' }, { status: 400 });
    }

    if (rows.length > 2000) {
      return NextResponse.json({ success: false, error: 'batch trop gros (max 2000)' }, { status: 400 });
    }

    sql = postgres(dbUrl, {
      connect_timeout: 10,
      idle_timeout: 30,
      max: 1,
    });

    const typedRows = rows as ImportRow[];
    const idcars      = typedRows.map(r => r.idcar);
    const resolutions = typedRows.map(r => r.resolution);
    const millesimes  = typedRows.map(r => r.millesime);
    const geomWkts    = typedRows.map(r => r.geom_wkt);
    const metadatas   = typedRows.map(r => JSON.stringify(r.metadata ?? {}));

    await sql`
      INSERT INTO carreaux_filosofi (idcar, resolution, millesime, geom, metadata)
      SELECT
        unnest(${idcars}::text[]),
        unnest(${resolutions}::text[]),
        unnest(${millesimes}::text[]),
        ST_GeomFromEWKT(unnest(${geomWkts}::text[])),
        unnest(${metadatas}::jsonb[])
      ON CONFLICT (idcar, resolution, millesime)
      DO UPDATE SET geom = EXCLUDED.geom, metadata = EXCLUDED.metadata
    `;

    await sql.end();
    sql = null;

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[import-geo] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    if (sql) {
      try { await sql.end(); } catch { /* ignore */ }
    }
  }
}

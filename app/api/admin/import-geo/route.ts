import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createClient } from '@supabase/supabase-js';

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
 * Insère un batch de features dans carreaux_filosofi via RPC Supabase (HTTPS).
 * Body: { rows: Array<{ idcar, resolution, millesime, geom_wkt, metadata }> }
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  try {
    const { rows } = await request.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'rows vide' }, { status: 400 });
    }

    if (rows.length > 2000) {
      return NextResponse.json({ success: false, error: 'batch trop gros (max 2000)' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const typedRows = rows as ImportRow[];
    const { error } = await supabase.rpc('import_carreaux_batch', {
      p_idcars:      typedRows.map(r => r.idcar),
      p_resolutions: typedRows.map(r => r.resolution),
      p_millesimes:  typedRows.map(r => r.millesime),
      p_geom_wkts:   typedRows.map(r => r.geom_wkt),
      p_metadatas:   typedRows.map(r => r.metadata ?? {}),
    });

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[import-geo] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

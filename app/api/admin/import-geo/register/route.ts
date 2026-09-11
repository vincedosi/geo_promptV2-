import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

/**
 * Declaration d'un import de carreaux dans `data_sources`.
 *
 * Tout est chaine cote client (`app/admin/carreaux-import/page.tsx`), sauf
 * `row_count` qui est le compteur d'inserees. Les valeurs par defaut
 * reproduisent les `|| 0` et `|| []` qu'elles remplacent.
 */
const EnregistrerCarreauxSchema = z.object({
  name: z.string().nullish(),
  resolution: z.string(),
  millesime: z.string(),
  row_count: z.number().int().nonnegative().default(0),
  columns: z.array(z.string()).default([]),
  filename: z.string().nullish(),
});

/**
 * POST /api/admin/import-geo/register
 * Enregistre l'import dans data_sources pour qu'il apparaisse dans /admin/sources.
 * Body: { name, resolution, millesime, row_count, columns, filename }
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  try {
    const corps = await lireCorps(request, EnregistrerCarreauxSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const { name, resolution, millesime, row_count, columns, filename } = corps.valeur;

    // Use Supabase JS client for data_sources (it's in PostgREST cache)
    const { createAdminClient } = await import('@/lib/auth');
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('data_sources')
      .insert({
        name: name || `Carreaux ${resolution} — ${millesime}`,
        type: 'carreaux',
        original_filename: filename || null,
        file_format: 'shapefile',
        row_count,
        valid_count: row_count,
        error_count: 0,
        mapping: { resolution, millesime, columns },
        geo_config: { resolution, millesime },
        status: 'active',
        organization_id: '00000000-0000-0000-0000-000000000001',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[import-geo/register] Error:', error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, source_id: data?.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

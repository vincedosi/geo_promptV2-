/**
 * GENESIS — API Route — /api/admin/sources
 * GET  : Liste toutes les data sources
 * POST : Crée une nouvelle data source (appelé par l'import)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { toJson } from '@/lib/supabase/rpc-json';

/**
 * Declaration d'une source importee. `name` et `type` alimentent des colonnes
 * NOT NULL : les omettre produisait une erreur Postgres rendue en 500. Les
 * compteurs valent 0 par defaut, comme le faisaient les `|| 0`. `mapping` et
 * `geo_config` sont des `jsonb` de forme libre — on n'en valide pas le contenu,
 * sous peine de refuser des imports qui fonctionnent.
 */
const CreerSourceSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  category: z.string().nullish(),
  regie: z.string().nullish(),
  organization_id: z.string().uuid().nullish(),
  original_filename: z.string().nullish(),
  file_format: z.string().nullish(),
  row_count: z.number().int().nonnegative().default(0),
  valid_count: z.number().int().nonnegative().default(0),
  error_count: z.number().int().nonnegative().default(0),
  // Deux colonnes `jsonb` de forme libre : on impose l'objet (c'est ce que le
  // pipeline d'import ecrit), pas son contenu.
  mapping: z.record(z.unknown()).optional(),
  geo_config: z.record(z.unknown()).optional(),
  imported_by: z.string().uuid().nullish(),
});

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org');
    const status = searchParams.get('status') || 'active';

    let query = supabase
      .from('data_sources')
      .select(`
        *,
        organizations(name, slug)
      `)
      .eq('status', status)
      .order('import_date', { ascending: false });

    if (orgId) {
      query = query.eq('organization_id', orgId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, sources: data || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const corps = await lireCorps(request, CreerSourceSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const body = corps.valeur;

    if (profile.role !== 'super_admin' && body.organization_id && body.organization_id !== profile.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('data_sources')
      .insert({
        name: body.name,
        type: body.type,
        category: body.category || null,
        regie: body.regie || null,
        organization_id: body.organization_id || profile.organization_id,
        original_filename: body.original_filename || null,
        file_format: body.file_format || null,
        row_count: body.row_count,
        valid_count: body.valid_count,
        error_count: body.error_count,
        mapping: toJson(body.mapping ?? {}),
        geo_config: toJson(body.geo_config ?? {}),
        imported_by: body.imported_by || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, source: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur creation source';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

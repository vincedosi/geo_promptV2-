/**
 * GEOMATIK — API /api/geographies
 * GET  : liste les geography_sets (filtrés par org utilisateur)
 * POST : sauvegarde un nouveau set depuis isochrones_cache (battle/isochrone)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getUserFromRequest } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await getUserFromRequest(request.headers.get('authorization'));
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createAdminClient();

  const orgFilter = profile.role === 'super_admin' ? null : profile.organization_id;

  const { data, error } = await supabase.rpc('get_geography_sets', {
    p_organization_id: orgFilter,
  });

  if (error) {
    console.error('[geographies/GET]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sets: unknown[] = [];
  if (typeof data === 'string') {
    try { sets = JSON.parse(data); } catch { sets = []; }
  } else if (Array.isArray(data)) {
    sets = data;
  }

  return NextResponse.json({ sets });
}

const SaveSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  organization_id: z.string().uuid().optional().nullable(),
  source_type: z.enum(['battle', 'isochrone', 'manual', 'import']).default('battle'),
  // null / undefined → auto-detection (v2_full > full > v1)
  zone_type: z.string().optional().nullable(),
  categorie: z.string(),
  minutes: z.number().int().min(1).max(240),
  mode: z.enum(['drive', 'walk', 'bike', 'transit']).default('drive'),
});

export async function POST(request: NextRequest) {
  const profile = await getUserFromRequest(request.headers.get('authorization'));
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }
  const p = parsed.data;

  // Org scoping : non super admin = forcer son org
  const orgId = profile.role === 'super_admin'
    ? (p.organization_id ?? profile.organization_id)
    : profile.organization_id;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('save_geography_from_cache', {
    p_name: p.name,
    p_description: p.description ?? null,
    p_organization_id: orgId,
    p_created_by: profile.id,
    p_source_type: p.source_type,
    p_zone_type: p.zone_type ?? null, // null → RPC auto-detect v2_full > full > v1
    p_zone_categorie: p.categorie,
    p_zone_minutes: p.minutes,
    p_zone_mode: p.mode,
  });

  if (error) {
    console.error('[geographies/POST]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = typeof data === 'string' ? JSON.parse(data) : data;
  if (!result?.set_id || result?.nb_zones === 0) {
    return NextResponse.json({
      error: 'Aucune zone trouvée dans le cache pour ces paramètres',
      details: result,
    }, { status: 404 });
  }

  return NextResponse.json(result);
}

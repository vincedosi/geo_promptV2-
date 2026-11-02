import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { resolveOrgWriteAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

/**
 * Client admin avec fetch no-store : Next.js wrappe le fetch global et cache
 * les réponses Supabase REST côté serveur (cf. logs "Failed to set fetch cache").
 * Conséquence : DELETE d'une zone OK côté DB mais GET /list retourne la version
 * cachée d'avant le delete → vignette fantôme dans l'UI. Le `cache: 'no-store'`
 * passé au fetch interne court-circuite le wrapper.
 */
function createNoCacheAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const sourceType = searchParams.get('source_type');
  const q = searchParams.get('q');

  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 });
  }

  if (!resolveOrgWriteAccess(profile.role, profile.organization_id, orgId)) {
    return NextResponse.json({ error: 'forbidden_org' }, { status: 403 });
  }

  const supabase = createNoCacheAdminClient();

  let query = supabase
    .from('custom_geo_zones')
    .select('id, name, description, source_type, source_metadata, recette, feature_count_iris, feature_count_cp, created_at, updated_at, created_by, bbox, surface_km2')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (sourceType) query = query.eq('source_type', sourceType);
  if (q) query = query.ilike('name', `%${q}%`);

  const { data, error } = await query;

  if (error) {
    console.error('[custom-geo/list]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Enrichissement : récupère les codes dept + region de toutes les zones
  // en 1 seule query (évite N+1) et merge dans le payload.
  const zoneIds = (data ?? []).map(z => z.id);
  const codesByZone = new Map<string, { dept: string[]; region: string[] }>();
  if (zoneIds.length > 0) {
    const { data: codes, error: codesErr } = await supabase
      .from('custom_geo_zone_codes')
      .select('zone_id, code_type, code')
      .in('zone_id', zoneIds)
      .in('code_type', ['dept', 'region']);
    if (codesErr) {
      console.warn('[custom-geo/list] codes fetch failed (non-blocking)', codesErr.message);
    } else {
      for (const c of codes ?? []) {
        const cur = codesByZone.get(c.zone_id) ?? { dept: [], region: [] };
        if (c.code_type === 'dept') cur.dept.push(c.code);
        else if (c.code_type === 'region') cur.region.push(c.code);
        codesByZone.set(c.zone_id, cur);
      }
    }
  }

  const enriched = (data ?? []).map(z => {
    const codes = codesByZone.get(z.id) ?? { dept: [], region: [] };
    return {
      ...z,
      dept_codes: codes.dept.sort(),
      region_codes: codes.region.sort(),
    };
  });

  return NextResponse.json(
    { zones: enriched, total: enriched.length },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        // Réponse différente à chaque requête pour casser tout ETag
        'X-Response-Time': String(Date.now()),
      },
    },
  );
}

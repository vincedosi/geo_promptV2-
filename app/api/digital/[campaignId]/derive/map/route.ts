/**
 * GET /api/digital/[campaignId]/derive/map?mesh=departement|region|cp&metric=hold|objectif&bbox=…&actors=…
 * — features de la carte de dérive à la maille choisie (RPC get_campaign_derive_map)
 * + score national de tête (get_campaign_derive_headline). Lecture rollups uniquement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/derive-metrics';

export const dynamic = 'force-dynamic';

const FRANCE_BBOX = [-12, 40, 10, 52] as const;
const QuerySchema = z.object({
  mesh: z.enum(['region', 'departement', 'cp']).default('departement'),
  metric: z.enum(['hold', 'objectif']).default('hold'),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const bboxRaw = (sp.get('bbox') ?? FRANCE_BBOX.join(',')).split(',').map(Number);
  const parsed = QuerySchema.safeParse({ mesh: sp.get('mesh') ?? 'departement', metric: sp.get('metric') ?? 'hold', bbox: bboxRaw });
  if (!parsed.success || parsed.data.bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const { mesh, metric, bbox } = parsed.data;
  const pActors = parseActorsParam(sp);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const [mapRes, headRes] = await Promise.all([
    supabase.rpc('get_campaign_derive_map', {
      p_campaign_id: campaignId, p_mesh: mesh, p_metric: metric, p_actors: pActors ?? undefined,
      p_bbox_xmin: bbox[0], p_bbox_ymin: bbox[1], p_bbox_xmax: bbox[2], p_bbox_ymax: bbox[3],
    }),
    supabase.rpc('get_campaign_derive_headline', { p_campaign_id: campaignId, p_metric: metric, p_actors: pActors ?? undefined }),
  ]);
  if (mapRes.error) return NextResponse.json({ error: mapRes.error.message }, { status: 500 });

  return NextResponse.json(
    { mesh, metric, headline: headRes.data ?? null, features: mapRes.data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

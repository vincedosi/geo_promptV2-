/**
 * GET /api/digital/[campaignId]/suivi/map?metric=hold|cpm&bbox=xmin,ymin,xmax,ymax
 * — features CP (géométries ref_codes_postaux simplifiées) pour la choroplèthe
 * du suivi sur la carte MapLibre. Bbox par défaut : métropole.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { parseActorsParam } from '@/lib/campaigns/actor-metrics';

export const dynamic = 'force-dynamic';

const METRO_BBOX = [-5.5, 41.2, 9.8, 51.2] as const;
const QuerySchema = z.object({
  metric: z.enum(['hold', 'cpm', 'objectif']).default('hold'),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const sp = request.nextUrl.searchParams;
  const bboxRaw = (sp.get('bbox') ?? METRO_BBOX.join(',')).split(',').map(Number);
  const parsed = QuerySchema.safeParse({ metric: sp.get('metric') ?? 'hold', bbox: bboxRaw });
  if (!parsed.success || parsed.data.bbox.some((v) => !Number.isFinite(v))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const { metric, bbox } = parsed.data;

  const pActors = parseActorsParam(sp);

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_suivi_map', {
    p_campaign_id: campaignId, p_metric: metric,
    p_bbox_xmin: bbox[0], p_bbox_ymin: bbox[1], p_bbox_xmax: bbox[2], p_bbox_ymax: bbox[3],
    p_actors: pActors ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metric, features: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

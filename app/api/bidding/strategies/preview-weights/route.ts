/**
 * POST /api/bidding/strategies/preview-weights
 *   → Calcule sans persister les multipliers d'une zone selon les weights choisis.
 *   Retourne :
 *     - sample_features: GeoJSON FeatureCollection (échantillon de CPs avec multiplier)
 *     - stats: agrégats (n_in_zone, n_out_zone, avg multipliers, budget_share %)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkZoneAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

const PreviewSchema = z.object({
  zone_id: z.string().uuid().nullable().optional(),
  scope_type: z.enum(['national', 'custom_zone']).default('custom_zone'),
  in_zone_weights: z.record(z.unknown()).default({}),
  out_zone_weights: z.record(z.unknown()).default({}),
  subzones: z.array(z.object({
    name: z.string(),
    postal_codes: z.array(z.string()),
    multiplier: z.number().min(0).max(5),
  })).optional(),
  sample_size: z.number().int().min(1).max(2000).default(500),
});

function computeMultiplier(
  isInZone: boolean,
  postalCode: string,
  inWeights: Record<string, unknown>,
  outWeights: Record<string, unknown>,
  subzones?: Array<{ postal_codes: string[]; multiplier: number }>,
): number {
  const inMode = (inWeights.mode as string) ?? 'uniform';
  const outMode = (outWeights.mode as string) ?? 'uniform';

  // Override par sous-zone si applicable
  if (isInZone && subzones) {
    for (const sz of subzones) {
      if (sz.postal_codes.includes(postalCode)) {
        return Math.max(0, Math.min(5, sz.multiplier));
      }
    }
  }

  let m = 1.0;
  if (isInZone) {
    if (inMode === 'uniform') m = Number(inWeights.value ?? 1.0);
    else if (inMode === 'by_tier') {
      const tier = inferTier(postalCode);
      const values = (inWeights.values ?? {}) as Record<string, number>;
      m = Number(values[tier] ?? 1.0);
    } else if (inMode === 'by_subzone') {
      m = Number(inWeights.value ?? 1.0);
    } else if (inMode === 'by_cp_csv') {
      const values = (inWeights.values ?? {}) as Record<string, number>;
      m = Number(values[postalCode] ?? 1.0);
    }
  } else {
    if (outMode === 'uniform') m = Number(outWeights.value ?? 1.0);
    else if (outMode === 'exclusion') m = 0.0;
    else if (outMode === 'by_tier') {
      const tier = inferTier(postalCode);
      const values = (outWeights.values ?? {}) as Record<string, number>;
      m = Number(values[tier] ?? 1.0);
    }
  }

  return Math.max(0, Math.min(5, m));
}

function inferTier(postalCode: string): string {
  if (!postalCode || postalCode.length < 2) return 'rural';
  const dept = postalCode.slice(0, 2);
  if (dept === '75') return 'premium_urban';
  if (['69001','69002','69003','69004','69005','69006','69007','69008','69009'].includes(postalCode)) return 'premium_urban';
  if (['13001','13002','13003','13004','13005','13006','13007','13008'].includes(postalCode)) return 'premium_urban';
  if (['33000','31000','44000','59000','67000','06000','21000','38000','35000','34000'].includes(postalCode)) return 'premium_urban';
  if (['92','93','94','69','13','33','31','44','59','67','06','21','38','35','34','54','37','45','42','51','64','76','86','87','49','50','60','71','72','74','17','19','25','26','29','30','41','58','63','79','80','81','82','83','85','89','27','08'].includes(dept)) return 'urban';
  if (['77','78','91','95','01','62','57','68','73','11','15','22','24','40','46','47','55','56','61','65','66','84','88'].includes(dept)) return 'suburban';
  return 'rural';
}

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }); }

  const parsed = PreviewSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();

  // Charger les CPs de la zone (si applicable)
  const inZoneSet = new Set<string>();
  if (body.scope_type === 'custom_zone' && body.zone_id) {
    const zoneAccess = await checkZoneAccess(supabase, profile, body.zone_id);
    if (zoneAccess !== 'ok') return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });

    const { data: zoneCps, error: zErr } = await supabase
      .from('custom_geo_zone_codes')
      .select('code')
      .eq('zone_id', body.zone_id)
      .eq('code_type', 'cp');
    if (zErr) return NextResponse.json({ error: zErr.message }, { status: 500 });
    for (const r of zoneCps ?? []) inZoneSet.add(r.code);
  }

  // Échantillon mixte :
  //   • CPs de la zone (TOUS, garantit n_in_zone > 0 même si la campagne DSP
  //     n'a pas de data dans la zone — sinon biais : "0 CPs in-zone" alors
  //     qu'on a 132 CPs réels)
  //   • + CPs de la campagne DSP (jusqu'à sample_size) pour estimer le mix
  //     in/out réel du trafic à venir
  const { data: cpRows, error: cpErr } = await supabase
    .from('dsp_campaign_data')
    .select('postal_code')
    .not('postal_code', 'is', null)
    .limit(body.sample_size);
  if (cpErr) return NextResponse.json({ error: cpErr.message }, { status: 500 });

  const fromCampaign = new Set((cpRows ?? []).map(r => r.postal_code as string).filter(Boolean));
  // Union zone ∪ campagne (garantit que TOUS les CPs in-zone sont représentés)
  const uniqueCps = Array.from(new Set([...inZoneSet, ...fromCampaign]));

  // Calcul multipliers
  type FeatureProps = { postal_code: string; multiplier: number; is_in_zone: boolean };
  const features: Array<{
    type: 'Feature';
    properties: FeatureProps;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }> = [];

  let nInZone = 0, nOutZone = 0, nExcluded = 0;
  let sumIn = 0, sumOut = 0;

  for (const cp of uniqueCps) {
    const isIn = inZoneSet.has(cp);
    const m = computeMultiplier(isIn, cp, body.in_zone_weights, body.out_zone_weights, body.subzones);

    if (isIn) { nInZone++; sumIn += m; }
    else { nOutZone++; sumOut += m; if (m === 0) nExcluded++; }

    // Geometry placeholder (centroid réel à charger via ref postal si dispo) — UI usage léger
    features.push({
      type: 'Feature',
      properties: { postal_code: cp, multiplier: m, is_in_zone: isIn },
      geometry: { type: 'Point', coordinates: [0, 0] },
    });
  }

  const totalWeighted = sumIn + sumOut;
  const stats = {
    n_in_zone: nInZone,
    n_out_zone: nOutZone,
    n_excluded: nExcluded,
    n_total_sampled: uniqueCps.length,
    avg_multiplier_in: nInZone > 0 ? sumIn / nInZone : 0,
    avg_multiplier_out: nOutZone > 0 ? sumOut / nOutZone : 0,
    budget_share_in_pct: totalWeighted > 0 ? (sumIn / totalWeighted) * 100 : 0,
    budget_share_out_pct: totalWeighted > 0 ? (sumOut / totalWeighted) * 100 : 0,
  };

  return NextResponse.json({
    sample_features: { type: 'FeatureCollection', features },
    stats,
  });
}

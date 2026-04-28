/**
 * GENESIS — GET /api/admin/campaigns/[id]/aggregate?metric=<field>
 *
 * Total agrégé du KPI demandé pour la campagne. Validation via le registry :
 * 400 si le metric n'est pas connu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { aggregateCampaignMetric } from '@/lib/metrics-display/aggregator';
import { getMetric } from '@/lib/metrics-display/loader';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  const metricField = request.nextUrl.searchParams.get('metric');
  if (!metricField) {
    return NextResponse.json(
      { error: 'metric query parameter required' },
      { status: 400 },
    );
  }

  try {
    const metric = await getMetric(metricField);
    if (!metric) {
      return NextResponse.json(
        { error: `Unknown metric '${metricField}'`, code: 'unknown_metric' },
        { status: 400 },
      );
    }
    const total = await aggregateCampaignMetric(params.id, metric);
    return NextResponse.json({
      metric: {
        field: metric.field,
        label: metric.displayNameFr ?? metric.displayName,
        unit: metric.unit,
        is_core: metric.isCore,
        is_legacy: metric.isLegacy,
      },
      total,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

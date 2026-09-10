/**
 * GENESIS — GET /api/admin/campaigns/[id]/metrics
 *
 * Retourne pour la campagne :
 *  - `available` : descripteurs des KPIs réellement remplis
 *  - `empty`     : descripteurs des KPIs déclarés mais non remplis
 *
 * Drive le `KpiSelector` côté UI : aucun KPI hardcodé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { detectAvailableMetrics } from '@/lib/metrics-display/available';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  try {
    const result = await detectAvailableMetrics(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

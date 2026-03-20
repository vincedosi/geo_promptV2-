/**
 * POST /api/admin/enrich-poi-geo
 * Enrichit les POIs sans région/département via l'API adresse.data.gouv.fr.
 * Body: { data_source_id: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { enrichMissingGeo } from '@/lib/import/geo-enricher';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { data_source_id } = body;
  if (!data_source_id) {
    return NextResponse.json({ error: 'data_source_id requis' }, { status: 400 });
  }

  const logs: string[] = [];
  await enrichMissingGeo(data_source_id, (_, msg) => logs.push(msg));

  return NextResponse.json({ success: true, logs });
}

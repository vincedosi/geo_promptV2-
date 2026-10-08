import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { poiId } = await params;
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('poi_cluster_history')
    .select('id,cluster_id,cluster_label,model_version,action,previous_cluster_id,changed,created_at')
    .eq('poi_id', poiId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

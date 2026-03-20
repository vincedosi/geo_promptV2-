import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { poiId: string } },
) {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('poi_cluster_history')
    .select('id,cluster_id,cluster_label,model_version,action,previous_cluster_id,changed,created_at')
    .eq('poi_id', params.poiId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

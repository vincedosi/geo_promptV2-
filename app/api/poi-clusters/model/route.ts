import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('clustering_models')
    .select('version,k,silhouette_score,n_pca_components,variance_explained,feature_names,n_poi_trained,duration_minutes,mode,created_at,cluster_mapping_from_previous')
    .order('version', { ascending: false })
    .limit(1)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

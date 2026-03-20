import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

const CLUSTER_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
  '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac',
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { clusterId: string } },
) {
  const clusterId = Number(params.clusterId);
  if (isNaN(clusterId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const sb = createAdminClient();

  const { data: models } = await sb
    .from('clustering_models')
    .select('version,cluster_labels,cluster_avg_profiles,feature_names')
    .order('version', { ascending: false })
    .limit(1);
  const model = models?.[0];

  const { data: clusters, error } = await sb
    .from('poi_clusters')
    .select('poi_id,cluster_label,profile_features')
    .eq('cluster_id', clusterId)
    .eq('model_version', model?.version ?? 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const poiIds = (clusters ?? []).map(c => c.poi_id);
  const { data: pois } = poiIds.length
    ? await sb.from('poi_france').select('id,nom,lat,lng,ville,categorie').in('id', poiIds)
    : { data: [] };

  const poiMap  = new Map((pois ?? []).map(p => [p.id, p]));
  const labels  = (model?.cluster_labels        as Record<string, string>)                  ?? {};
  const avgProf = (model?.cluster_avg_profiles  as Record<string, Record<string, number>>) ?? {};

  return NextResponse.json({
    cluster_id:    clusterId,
    cluster_label: labels[String(clusterId)] ?? `Cluster ${clusterId}`,
    cluster_color: CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length],
    avg_profile:   avgProf[String(clusterId)] ?? {},
    feature_names: (model?.feature_names as string[]) ?? [],
    pois: (clusters ?? []).map(c => ({
      ...(poiMap.get(c.poi_id) ?? {}),
      cluster_label:    c.cluster_label,
      profile_features: c.profile_features,
    })),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';
import { lirePoiClusters, lirePoiParIds } from '@/lib/clustering/lire-clusters';

export const dynamic = 'force-dynamic';

const CLUSTER_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
  '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac',
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clusterId: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { clusterId: clusterIdParam } = await params;
  const clusterId = Number(clusterIdParam);
  if (isNaN(clusterId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const sb = createAdminClient();

  const { data: models } = await sb
    .from('clustering_models')
    .select('version,cluster_labels,cluster_avg_profiles,feature_names')
    .order('version', { ascending: false })
    .limit(1);
  const model = models?.[0];

  // POI du cluster, puis leurs fiches — lectures paginées : une requête de table
  // est coupée à 1 000 lignes (lib/clustering/lire-clusters.ts).
  let clusters: { poi_id: string; cluster_label: string | null; profile_features: unknown }[];
  let pois: { id: string; nom: string | null; lat: number | null; lng: number | null; ville: string | null; categorie: string | null }[];
  try {
    clusters = await lirePoiClusters(
      sb,
      'poi_id,cluster_label,profile_features',
      { cluster_id: clusterId, model_version: model?.version ?? 1 },
    );
    pois = await lirePoiParIds(sb, 'id,nom,lat,lng,ville,categorie', clusters.map(c => c.poi_id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const poiMap  = new Map(pois.map(p => [p.id, p]));
  const labels  = (model?.cluster_labels        as Record<string, string>)                  ?? {};
  const avgProf = (model?.cluster_avg_profiles  as Record<string, Record<string, number>>) ?? {};

  return NextResponse.json({
    cluster_id:    clusterId,
    cluster_label: labels[String(clusterId)] ?? `Cluster ${clusterId}`,
    cluster_color: CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length],
    avg_profile:   avgProf[String(clusterId)] ?? {},
    feature_names: (model?.feature_names as string[]) ?? [],
    pois: clusters.map(c => ({
      ...(poiMap.get(c.poi_id) ?? {}),
      cluster_label:    c.cluster_label,
      profile_features: c.profile_features,
    })),
  });
}

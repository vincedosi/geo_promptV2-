import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

import { lirePoiClusters, lirePoiParIds } from '@/lib/clustering/lire-clusters';

export const dynamic = 'force-dynamic';

interface PoiClusterLu {
  poi_id: string;
  cluster_id: number;
  cluster_label: string | null;
  profile_features: unknown;
  pca_components: unknown;
}
interface PoiLu {
  id: string;
  nom: string | null;
  lat: number | null;
  lng: number | null;
  categorie: string | null;
  ville: string | null;
}

const CLUSTER_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
  '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac',
];

export async function GET(request: NextRequest) {
  const refus = await reserverAuSuperAdmin(request);
  if (refus) return refus;
  const sb = createAdminClient();
  const { searchParams } = new URL(request.url);
  const duration = parseInt(searchParams.get('duration') ?? '60', 10) || 60;

  // Dernier modèle pour cette durée
  const { data: models, error: mErr } = await sb
    .from('clustering_models')
    .select('version,k,silhouette_score,created_at,cluster_labels,cluster_avg_profiles,feature_names,n_pca_components,variance_explained,duration_minutes,mode')
    .eq('duration_minutes', duration)
    .order('version', { ascending: false })
    .limit(1);

  if (mErr || !models?.length) {
    return NextResponse.json({ error: 'Aucun modèle de clustering trouvé' }, { status: 404 });
  }
  const model = models[0];

  // Clusters POI pour ce modèle, puis leurs POI (lat/lng/nom) — lectures
  // paginées : une requête de table est coupée à 1 000 lignes (lib/clustering/lire-clusters.ts).
  let clusters: PoiClusterLu[];
  let pois: PoiLu[];
  try {
    clusters = await lirePoiClusters<PoiClusterLu>(
      sb,
      'poi_id,cluster_id,cluster_label,profile_features,pca_components',
      { model_version: model.version, duration_minutes: model.duration_minutes, mode: model.mode },
    );
    pois = await lirePoiParIds<PoiLu>(sb, 'id,nom,lat,lng,categorie,ville', clusters.map(c => c.poi_id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const poiMap = new Map(pois.map(p => [p.id, p]));
  const clusterLabels  = (model.cluster_labels        as Record<string, string>)                  ?? {};
  const clusterAvgProf = (model.cluster_avg_profiles  as Record<string, Record<string, number>>) ?? {};

  // Summary par cluster
  const summary: Record<string, { label: string; count: number; color: string; avg_profile: Record<string, number> }> = {};
  for (let i = 0; i < model.k; i++) {
    const cid = String(i);
    summary[cid] = {
      label:       clusterLabels[cid] ?? `Cluster ${i}`,
      count:       0,
      color:       CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      avg_profile: clusterAvgProf[cid] ?? {},
    };
  }

  // GeoJSON features
  const features: object[] = [];
  for (const c of clusters) {
    const poi = poiMap.get(c.poi_id);
    if (!poi?.lat || !poi?.lng) continue;
    const cid = String(c.cluster_id);
    if (summary[cid]) summary[cid].count++;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(poi.lng), Number(poi.lat)] },
      properties: {
        poi_id:          c.poi_id,
        poi_name:        poi.nom ?? '',
        cluster_id:      c.cluster_id,
        cluster_label:   c.cluster_label ?? clusterLabels[cid] ?? `Cluster ${c.cluster_id}`,
        cluster_color:   CLUSTER_COLORS[c.cluster_id % CLUSTER_COLORS.length],
        categorie:       poi.categorie ?? '',
        ville:           poi.ville ?? '',
        // JSON stringifiés — les propriétés MapLibre sont plates
        profile_features: JSON.stringify(c.profile_features ?? {}),
        pca_components:   JSON.stringify(c.pca_components   ?? []),
      },
    });
  }

  return NextResponse.json({
    type: 'FeatureCollection',
    features,
    metadata: {
      model_version:     model.version,
      k:                 model.k,
      silhouette_score:  model.silhouette_score,
      n_pca_components:  model.n_pca_components,
      variance_explained: model.variance_explained,
      duration_minutes:  model.duration_minutes,
      mode:              model.mode,
      created_at:        model.created_at,
      cluster_summary:   summary,
      feature_names:     (model.feature_names as string[]) ?? [],
    },
  });
}

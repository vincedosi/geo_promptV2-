/**
 * GET  /api/poi-clusters/models/[version]  — détail du modèle
 * DELETE /api/poi-clusters/models/[version] — supprime le modèle + ses poi_clusters + historique
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export const revalidate = 300;

const CLUSTER_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
  '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac',
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ version: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { version: versionParam } = await params;
  const version = parseInt(versionParam, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();

  // Model
  const { data: model, error: mErr } = await sb
    .from('clustering_models')
    .select(
      'version, k, silhouette_score, n_pca_components, variance_explained, ' +
      'feature_names, feature_themes, cluster_labels, cluster_avg_profiles, centroids, ' +
      'scaler_mean, scaler_scale, pca_components, n_poi_trained, ' +
      'duration_minutes, mode, created_at, cluster_mapping_from_previous'
    )
    .eq('version', version)
    .single();

  if (mErr || !model) return NextResponse.json({ error: 'Modèle introuvable' }, { status: 404 });

  interface ClusteringModelRow {
    version: number;
    k: number;
    silhouette_score: number | null;
    n_pca_components: number | null;
    variance_explained: number | null;
    feature_names: string[] | null;
    feature_themes: unknown;
    cluster_labels: Record<string, string> | null;
    cluster_avg_profiles: Record<string, Record<string, number>> | null;
    centroids: unknown;
    scaler_mean: unknown;
    scaler_scale: unknown;
    pca_components: unknown;
    n_poi_trained: number | null;
    duration_minutes: number | null;
    mode: string | null;
    created_at: string;
    cluster_mapping_from_previous: unknown;
  }
  const m = model as unknown as ClusteringModelRow;

  // POI clusters
  const { data: clusters, error: cErr } = await sb
    .from('poi_clusters')
    .select(
      'poi_id, cluster_id, cluster_label, profile_features, pca_components, ' +
      'n_carreaux_intersected, population_totale_couverte, imputed_features, ' +
      'duration_minutes, mode'
    )
    .eq('model_version', version);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  interface PoiClusterRow {
    poi_id: string;
    cluster_id: number;
    cluster_label: string | null;
    profile_features: Record<string, number>;
    pca_components: number[];
    n_carreaux_intersected: number | null;
    population_totale_couverte: number | null;
    imputed_features: string[] | null;
    duration_minutes: number | null;
    mode: string | null;
  }
  const clusterRows = (clusters ?? []) as unknown as PoiClusterRow[];
  const poiIds = clusterRows.map(c => c.poi_id);
  const { data: pois } = poiIds.length
    ? await sb.from('poi_france').select('id, nom, lat, lng, categorie, ville').in('id', poiIds)
    : { data: [] };

  const poiMap = new Map((pois ?? []).map(p => [p.id, p]));

  const clusterLabels  = m.cluster_labels       ?? {};
  const clusterAvgProf = m.cluster_avg_profiles ?? {};

  // Build cluster summary
  const summary: Record<string, {
    label:       string;
    count:       number;
    color:       string;
    avg_profile: Record<string, number>;
  }> = {};
  for (let i = 0; i < m.k; i++) {
    const cid = String(i);
    summary[cid] = {
      label:       clusterLabels[cid] ?? `Cluster ${i}`,
      count:       0,
      color:       CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      avg_profile: clusterAvgProf[cid] ?? {},
    };
  }

  // POI list with coordinates
  const poiList = clusterRows.map(c => {
    const poi = poiMap.get(c.poi_id);
    const cid = String(c.cluster_id);
    if (summary[cid]) summary[cid].count++;
    return {
      poi_id:                    c.poi_id,
      poi_name:                  poi?.nom ?? '',
      categorie:                 poi?.categorie ?? '',
      ville:                     poi?.ville ?? '',
      lat:                       poi?.lat,
      lng:                       poi?.lng,
      cluster_id:                c.cluster_id,
      cluster_label:             c.cluster_label ?? clusterLabels[cid] ?? `Cluster ${c.cluster_id}`,
      cluster_color:             CLUSTER_COLORS[c.cluster_id % CLUSTER_COLORS.length],
      profile_features:          c.profile_features,
      pca_components:            c.pca_components,
      n_carreaux_intersected:    c.n_carreaux_intersected,
      population_totale_couverte: c.population_totale_couverte,
      imputed_features:          c.imputed_features ?? [],
      duration_minutes:          c.duration_minutes,
      mode:                      c.mode,
    };
  });

  return NextResponse.json({
    model: {
      version:                    m.version,
      k:                          m.k,
      silhouette_score:           m.silhouette_score,
      n_pca_components:           m.n_pca_components,
      variance_explained:         m.variance_explained,
      feature_names:              m.feature_names ?? [],
      feature_themes:             m.feature_themes ?? null,
      cluster_labels:             clusterLabels,
      cluster_avg_profiles:       clusterAvgProf,
      centroids:                  m.centroids,
      n_poi_trained:              m.n_poi_trained,
      duration_minutes:           m.duration_minutes,
      mode:                       m.mode,
      created_at:                 m.created_at,
      cluster_mapping_from_previous: m.cluster_mapping_from_previous,
    },
    cluster_summary: summary,
    poi_list:        poiList,
  });
}

// ── DELETE — supprimer un modèle + ses données associées ─────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ version: string }> },
) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const { version: versionParam } = await params;
  const version = parseInt(versionParam, 10);
  if (isNaN(version)) return NextResponse.json({ error: 'Version invalide' }, { status: 400 });

  const sb = createAdminClient();

  // Supprimer dans l'ordre (FK : poi_clusters → clustering_models)
  const { error: e1 } = await sb
    .from('poi_cluster_history')
    .delete()
    .eq('model_version', version);
  if (e1) return NextResponse.json({ error: `Historique : ${e1.message}` }, { status: 500 });

  const { error: e2 } = await sb
    .from('poi_clusters')
    .delete()
    .eq('model_version', version);
  if (e2) return NextResponse.json({ error: `POI clusters : ${e2.message}` }, { status: 500 });

  const { error: e3 } = await sb
    .from('clustering_models')
    .delete()
    .eq('version', version);
  if (e3) return NextResponse.json({ error: `Modèle : ${e3.message}` }, { status: 500 });

  return NextResponse.json({ deleted: version });
}

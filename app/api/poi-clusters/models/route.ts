/**
 * GET /api/poi-clusters/models
 * Liste tous les modèles de clustering (clustering_models) ordonnés par version desc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

export async function GET(req: NextRequest) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const sb = createAdminClient();
  const { data, error } = await sb
    .from('clustering_models')
    .select(
      'version, k, silhouette_score, n_pca_components, variance_explained, ' +
      'feature_names, feature_themes, cluster_labels, cluster_avg_profiles, n_poi_trained, ' +
      'duration_minutes, mode, created_at'
    )
    .order('version', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ models: data ?? [] });
}

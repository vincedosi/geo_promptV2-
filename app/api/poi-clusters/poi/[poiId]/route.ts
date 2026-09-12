import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/poi-clusters/poi/[poiId]
// Retourne les profils d'un POI pour toutes les durées disponibles
// Utilisé par le mode "comparer durées" du ClusterPanel (Phase 9)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const { poiId } = await params;
  const sb  = createAdminClient();
  const pid = poiId;

  const { data, error } = await sb
    .from('poi_clusters')
    .select('cluster_id,cluster_label,cluster_avg_profile,profile_features,pca_components,duration_minutes,mode,model_version,updated_at')
    .eq('poi_id', pid)
    .order('duration_minutes', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'POI non trouvé' }, { status: 404 });

  // Indexer par durée
  const byDuration: Record<number, {
    cluster_id: number;
    cluster_label: string;
    profile_features: Record<string, number>;
    pca_components: number[];
    model_version: number;
    mode: string;
    updated_at: string;
  }> = {};

  for (const row of data) {
    byDuration[row.duration_minutes] = {
      cluster_id:       row.cluster_id,
      cluster_label:    row.cluster_label ?? '',
      profile_features: (row.profile_features as Record<string, number>) ?? {},
      pca_components:   (row.pca_components as number[]) ?? [],
      model_version:    row.model_version,
      mode:             row.mode ?? 'drive',
      updated_at:       row.updated_at ?? '',
    };
  }

  return NextResponse.json({ poi_id: pid, durations: byDuration });
}

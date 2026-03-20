import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

// GET /api/poi-clusters/poi-types
// Retourne les types de POI disponibles, avec leur nombre total et leur nb de POI clustérisés.
// Utilisé par le front et le CLI pour lister les types dynamiquement.
export async function GET() {
  const sb = createAdminClient();

  // 1. Tous les types de POI en base
  const { data: allPois, error: errAll } = await sb
    .from('poi_france')
    .select('categorie');

  if (errAll) return NextResponse.json({ error: errAll.message }, { status: 500 });

  const totalByType: Record<string, number> = {};
  for (const row of allPois ?? []) {
    const cat = row.categorie ?? 'poi';
    totalByType[cat] = (totalByType[cat] ?? 0) + 1;
  }

  // 2. Types ayant des clusters (via poi_clusters → poi_france)
  const { data: clustered } = await sb
    .from('poi_clusters')
    .select('poi_id');

  const clusteredIds = new Set((clustered ?? []).map(r => r.poi_id));

  // 3. Catégories des POI clustérisés
  const clusteredByType: Record<string, number> = {};
  if (clusteredIds.size > 0) {
    const ids = [...clusteredIds];
    // Batch par 500 pour éviter les limites URL
    for (let i = 0; i < ids.length; i += 500) {
      const { data: chunk } = await sb
        .from('poi_france')
        .select('categorie')
        .in('id', ids.slice(i, i + 500));
      for (const row of chunk ?? []) {
        const cat = row.categorie ?? 'poi';
        clusteredByType[cat] = (clusteredByType[cat] ?? 0) + 1;
      }
    }
  }

  // 4. Assembler la réponse
  const types = Object.entries(totalByType)
    .map(([type, total]) => ({
      type,
      total,
      clustered: clusteredByType[type] ?? 0,
      has_clusters: (clusteredByType[type] ?? 0) > 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ types });
}

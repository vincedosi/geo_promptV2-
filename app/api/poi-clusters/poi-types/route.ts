import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
// Clustering réservé au super_admin (2026-10-08) : les modèles sont calculés
// sur TOUS les POI, toutes organisations confondues — voir lib/auth/perimetre-donnees.ts.
import { reserverAuSuperAdmin } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

/** Une ligne de `types_poi_clustering` (sql/248). */
interface TypePoiCompte {
  type: string;
  total: number;
  clustered: number;
}

// GET /api/poi-clusters/poi-types
// Retourne les types de POI disponibles, avec leur nombre total et leur nb de POI clustérisés.
// Utilisé par le front et le CLI pour lister les types dynamiquement.
//
// Les comptes viennent d'UNE agrégation en base, `types_poi_clustering`
// (sql/248, `RETURNS jsonb`). Jusqu'au 2026-10-11 la route lisait `poi_france`
// sans pagination et comptait côté Node : PostgREST coupe toute requête de table
// à 1 000 lignes (CLAUDE.md § « Troncature PostgREST »), elle comptait donc
// 1 000 POI sur 390 029 et l'assistant ne proposait qu'« arret_transport
// 1 000 POIs ». La forme de la réponse est inchangée.
export async function GET(req: NextRequest) {
  const refus = await reserverAuSuperAdmin(req);
  if (refus) return refus;
  const sb = createAdminClient();

  const { data, error } = await sb.rpc('types_poi_clustering');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const lignes = (Array.isArray(data) ? data : []) as unknown as TypePoiCompte[];
  // Déjà trié par total décroissant en base.
  const types = lignes.map((t) => ({
    type:         t.type,
    total:        Number(t.total),
    clustered:    Number(t.clustered),
    has_clusters: Number(t.clustered) > 0,
  }));

  return NextResponse.json({ types });
}

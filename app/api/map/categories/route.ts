/**
 * GET /api/map/categories
 * Retourne les catégories de POI distinctes présentes dans la base.
 * Filtrées par les data_sources de l'organisation si la session le requiert.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getDistinctCategories, invalidateCategoriesCache } from '@/lib/poi/categories';
import { requireAdmin } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('refresh') === '1') {
    // Cache invalidation is a privileged operation — require admin
    const profile = await requireAdmin(req);
    if (!profile) {
      return NextResponse.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
    }
    invalidateCategoriesCache();
  }

  // Catégories globales (cache 60s)
  const allCats = await getDistinctCategories();

  const session = await getSessionOrg(req);

  // Super admin ou pas de session (dev) → tout retourner
  if (!session || session.role === 'super_admin' || !session.orgId) {
    return NextResponse.json({ categories: allCats });
  }

  // Org identifiée : filtrer par ses data_sources
  const supabase = createAdminClient();

  const { data: sources } = await supabase
    .from('data_sources')
    .select('id')
    .neq('status', 'deleted')
    .or(`organization_id.eq.${session.orgId},shared_with.cs.{${session.orgId}}`);

  const sourceIds = sources?.map((s: { id: string }) => s.id) ?? [];

  if (sourceIds.length === 0) {
    return NextResponse.json({ categories: [] });
  }

  // Leapfrog sur les catégories restreintes aux sources de l'org
  const orgCatSet = new Set<string>();
  let lastSeen = '';
  for (let i = 0; i < 100; i++) {
    const { data } = await supabase
      .from('poi_france')
      .select('categorie')
      .in('data_source_id', sourceIds)
      .not('categorie', 'is', null)
      .gt('categorie', lastSeen)
      .order('categorie', { ascending: true })
      .limit(1);
    if (!data?.length) break;
    const cat = data[0].categorie as string;
    orgCatSet.add(cat);
    lastSeen = cat;
  }

  // Conserver l'ordre et le tri des catégories globales, mais filtré
  const filteredCats = allCats.filter(c => orgCatSet.has(c));
  return NextResponse.json({ categories: filteredCats });
}

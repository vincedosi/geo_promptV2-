/**
 * GET /api/map/categories
 * Retourne les catégories de POI distinctes présentes dans la base.
 * Filtrées par les data_sources de l'organisation si la session le requiert.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getDistinctCategories, invalidateCategoriesCache } from '@/lib/poi/categories';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';

export const dynamic = 'force-dynamic';

// Construit la map categorie → label_fr depuis poi_categories (1 requête légère)
async function buildLabelMap(supabase: ReturnType<typeof createAdminClient>, cats: string[]): Promise<Record<string, string>> {
  if (cats.length === 0) return {};
  const { data } = await supabase
    .from('poi_categories')
    .select('categorie, label_fr')
    .in('categorie', cats);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.label_fr) map[row.categorie] = row.label_fr;
  }
  return map;
}

// Transforme string[] → {id, label}[] en utilisant label_fr si disponible
function withLabels(cats: string[], labelMap: Record<string, string>) {
  return cats.map(c => ({
    id: c,
    label: labelMap[c] ?? (c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')),
  }));
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('refresh') === '1') {
    // Cache invalidation — tout utilisateur connecté peut rafraîchir
    // (le middleware a déjà vérifié la session via getSession())
    invalidateCategoriesCache();
  }

  // Catégories globales (cache 5 min)
  const allCats = await getDistinctCategories();
  const supabase = createAdminClient();
  const session  = await getSessionOrg(req);

  // La règle « quelles sources cette organisation voit-elle » était réécrite ici
  // en ligne (`DUP-002`). Elle vit désormais à un seul endroit. Les conditions
  // sont EXACTEMENT celles qui figuraient ici : `getOrgSourceIds` renvoie `null`
  // quand il n'y a pas de session, que l'appelant est super_admin, ou qu'il n'a
  // pas d'organisation — donc le cas « tout retourner ».
  const sourceIds = await getOrgSourceIds(session);

  // null → aucun filtre : tout retourner avec les libellés.
  if (sourceIds === null) {
    const labelMap = await buildLabelMap(supabase, allCats);
    return NextResponse.json({ categories: withLabels(allCats, labelMap) });
  }

  // [] → organisation connue mais sans aucune source : aucun accès.
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

  // Conserver l'ordre des catégories globales, filtré + labels
  const filteredCats = allCats.filter(c => orgCatSet.has(c));
  const labelMap     = await buildLabelMap(supabase, filteredCats);
  return NextResponse.json({ categories: withLabels(filteredCats, labelMap) });
}

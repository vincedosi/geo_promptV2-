/**
 * GET /api/map/categories
 * Retourne les catégories de POI visibles de l'espace actif, chacune avec son
 * origine : `{ categories: { id, label, origine: 'commune' | 'espace' }[] }`.
 * « espace » = au moins un POI visible vient d'une source propre à l'espace
 * (privée, possédée ou partagée) ; « commune » sinon (spec
 * droits-sur-la-carte R6, 2026-10-12).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getDistinctCategories, getCategoriesVisibles, invalidateCategoriesCache } from '@/lib/poi/categories';
import { libellesCategories, avecLibelles } from '@/lib/poi/libelles-categories';
import { getOrgSourceIds, getSourcesPropresEspace } from '@/lib/auth/getOrgSourceIds';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session  = await getSessionOrg(req);

  // Invalidation du cache réservée à un appelant connecté. Cette route est
  // publique (middleware.ts) : laisser un anonyme vider le cache lui permettait
  // de forcer à chaque appel la relecture des catégories (≈ 35 000 pages lues,
  // mesuré le 2026-10-09), la famille d'I/O des trois pannes.
  if (session && req.nextUrl.searchParams.get('refresh') === '1') {
    invalidateCategoriesCache();
  }

  // Catégories globales (cache 5 min)
  const allCats = await getDistinctCategories();
  const supabase = createAdminClient();

  // La règle « quelles sources cette organisation voit-elle » était réécrite ici
  // en ligne (`DUP-002`). Elle vit désormais à un seul endroit. Depuis le
  // 2026-10-08 elle ferme par défaut : `null` (« tout retourner ») est réservé
  // au super_admin. Cette route est publique (middleware.ts) : un appelant
  // SANS session reçoit les catégories du socle, et plus la liste complète —
  // qui révélait l'existence des catégories privées de chaque client.
  //
  // Vue espace (2026-10-12) : le super_admin voit la carte comme son espace
  // actif, exactement comme un client de cet espace — jamais « tout ».
  const sourceIds = await getOrgSourceIds(session, { vueEspace: true });

  // null → impossible avec `vueEspace` (branche gardée pour un appelant futur
  // qui retirerait l'option) : tout retourner avec les libellés.
  if (sourceIds === null) {
    const labelMap = await libellesCategories(supabase, allCats);
    return NextResponse.json({
      categories: avecLibelles(allCats, labelMap).map((c) => ({ ...c, origine: 'commune' as const })),
    });
  }

  // [] → organisation connue mais sans aucune source : aucun accès.
  if (sourceIds.length === 0) {
    return NextResponse.json({ categories: [] });
  }

  // Leapfrog sur les catégories restreintes aux sources de l'org — extrait
  // dans `getCategoriesVisibles` pour que le chat applique la même règle.
  const filteredCats = await getCategoriesVisibles(sourceIds);
  const labelMap     = await libellesCategories(supabase, filteredCats);

  // « Données de l'espace » : au moins un POI visible vient d'une source propre
  // à l'espace. Une catégorie mixte est rangée « espace » (ce que le client a
  // importé prime). Un leapfrog de plus, sur les seules sources propres, en
  // cache par empreinte comme le premier ; aucun s'il n'y en a pas. Les deux
  // lectures sont SÉQUENTIELLES — jamais de Promise.all ici (règles I/O).
  const propres    = await getSourcesPropresEspace(session);
  const catsEspace = new Set(propres.length > 0 ? await getCategoriesVisibles(propres) : []);
  return NextResponse.json({
    categories: avecLibelles(filteredCats, labelMap).map((c) => ({
      ...c,
      origine: catsEspace.has(c.id) ? ('espace' as const) : ('commune' as const),
    })),
  });
}

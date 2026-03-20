/**
 * GET /api/map/categories
 * Retourne les catégories de POI distinctes présentes dans la base.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDistinctCategories, invalidateCategoriesCache } from '@/lib/poi/categories';
import { requireAdmin } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('refresh') === '1') {
    // Cache invalidation is a privileged operation — require admin
    const profile = await requireAdmin(req);
    if (!profile) {
      return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 });
    }
    invalidateCategoriesCache();
  }
  const cats = await getDistinctCategories();
  return NextResponse.json({ categories: cats });
}

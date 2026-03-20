/**
 * GET /api/map/categories
 * Retourne les catégories de POI distinctes présentes dans la base.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDistinctCategories, invalidateCategoriesCache } from '@/lib/poi/categories';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('refresh') === '1') {
    invalidateCategoriesCache();
  }
  const cats = await getDistinctCategories();
  return NextResponse.json({ categories: cats });
}

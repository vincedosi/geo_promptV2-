/**
 * GET /api/map/categories
 * Retourne les catégories de POI distinctes présentes dans la base.
 */
import { NextResponse } from 'next/server';
import { getDistinctCategories } from '@/lib/poi/categories';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cats = await getDistinctCategories();
  return NextResponse.json({ categories: cats });
}

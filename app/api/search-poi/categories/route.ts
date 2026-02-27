/**
 * GENESIS — API Route — GET /api/search-poi/categories
 * Fetch distinct POI categories from poi table (cached 60s)
 */
import { NextResponse } from 'next/server';
import { getDistinctCategories } from '@/lib/poi/categories';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const categories = await getDistinctCategories();
    return NextResponse.json({ success: true, categories });
  } catch (error) {
    console.error('[categories] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

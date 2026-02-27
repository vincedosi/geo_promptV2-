/**
 * GEO.Prompt — API Route — POST /api/search-poi
 * Search POIs from Supabase poi table
 * Uses paginated .range() calls (1000/batch) to bypass PostgREST default row cap
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

const BATCH_SIZE = 1000; // PostgREST max-rows per request on Supabase hosted

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { categories, limit = 20000 } = body as { categories?: string[]; limit?: number };

    const supabase = createAdminClient();

    const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement, code_departement, code_postal, date_import, organization_id, data_source_id, metadata';

    // Paginate via .range() to fetch beyond the default 1000-row PostgREST cap
    const allPois: unknown[] = [];
    let from = 0;

    while (allPois.length < limit) {
      const to = from + BATCH_SIZE - 1;

      let query = supabase
        .from('poi_france')
        .select(SELECT_COLS)
        .range(from, to);

      if (categories && categories.length > 0) {
        query = query.in('categorie', categories);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[search-poi] Supabase error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data || data.length === 0) break;

      allPois.push(...data);
      from += BATCH_SIZE;

      // Stop if we got fewer rows than the batch size (no more data)
      if (data.length < BATCH_SIZE) break;
    }

    console.log(`[search-poi] Fetched ${allPois.length} POIs for categories:`, categories);

    return NextResponse.json({
      success: true,
      pois: allPois,
      count: allPois.length,
    });
  } catch (error) {
    console.error('[search-poi] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

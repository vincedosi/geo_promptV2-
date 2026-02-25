/**
 * GENESIS — API Route — POST /api/search-poi
 * Search POIs from Supabase poi_france table
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categories, limit = 10000 } = body;

    const supabase = createAdminClient();

    let query = supabase
      .from('poi_france')
      .select('id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement, code_departement, code_postal, date_import, organization_id, data_source_id, metadata')
      .limit(limit);

    // Filter by categories if specified
    if (categories && categories.length > 0) {
      query = query.in('categorie', categories);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[search-poi] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[search-poi] Found ${data?.length || 0} POIs for categories:`, categories);

    return NextResponse.json({
      success: true,
      pois: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('[search-poi] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

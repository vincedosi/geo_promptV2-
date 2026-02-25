/**
 * GENESIS — API Route — GET /api/search-poi/categories
 * Fetch distinct POI categories from poi_france table
 */
import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('poi_france')
      .select('categorie')
      .not('categorie', 'is', null);

    if (error) {
      console.error('[categories] Supabase error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Extract unique categories
    const categories = [...new Set((data || []).map((row: any) => row.categorie).filter(Boolean))];
    console.log('[categories] Found categories:', categories);

    return NextResponse.json({ success: true, categories });
  } catch (error) {
    console.error('[categories] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

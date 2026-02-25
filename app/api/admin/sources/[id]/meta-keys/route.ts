/**
 * GENESIS — API Route — GET /api/admin/sources/[id]/meta-keys
 * Returns all distinct metadata keys for POIs linked to this data source.
 * Used by the Sources page to show available columns for filter editing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { id } = params;

    // Fetch metadata from a sample of rows (max 100) to extract keys
    const { data, error } = await supabase
      .from('poi_france')
      .select('metadata')
      .eq('data_source_id', id)
      .not('metadata', 'is', null)
      .limit(100);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const keysSet = new Set<string>();
    for (const row of data || []) {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (meta && typeof meta === 'object') {
        for (const key of Object.keys(meta)) {
          if (meta[key] != null && meta[key] !== '') {
            keysSet.add(key);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      keys: [...keysSet].sort(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

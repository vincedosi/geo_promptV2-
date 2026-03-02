/**
 * GENESIS — API Route — GET /api/admin/source-filters
 * Fetch filter fields and their available values for each data source
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();

    // Get all data sources with filter config
    const { data: sources, error: sourcesError } = await supabase
      .from('data_sources')
      .select('id, name, category, filter_fields');

    if (sourcesError) {
      console.error('[source-filters] Error fetching sources:', sourcesError);
      return NextResponse.json({ success: false, error: sourcesError.message }, { status: 500 });
    }

    if (!sources || sources.length === 0) {
      return NextResponse.json({ success: true, sourceFilters: {} });
    }

    const sourceFilters: Record<string, any> = {};

    for (const source of sources) {
      const filterFields = source.filter_fields || [];
      if (filterFields.length === 0) continue;

      // Get distinct values for each filter field
      const filterValues: Record<string, string[]> = {};

      for (const field of filterFields) {
        // Check if field is a direct column (genesis fields) or metadata field
        const genesisColumns = ['nom', 'adresse', 'ville', 'code_postal', 'departement', 'region', 'code_departement', 'categorie', 'sous_categorie'];
        const isDirectColumn = genesisColumns.includes(field.toLowerCase());

        if (isDirectColumn) {
          const { data: values, error: valuesError } = await supabase
            .from('poi_france')
            .select(field)
            .eq('data_source_id', source.id)
            .not(field, 'is', null);

          if (!valuesError && values) {
            const distinctValues = [...new Set(values.map((r: any) => r[field]).filter(Boolean))].sort();
            filterValues[field] = distinctValues as string[];
          }
        } else {
          // Metadata JSONB field — query via Supabase JSONB arrow operator
          const { data: rows, error: metaError } = await supabase
            .from('poi_france')
            .select('metadata')
            .eq('data_source_id', source.id)
            .not('metadata', 'is', null);

          if (!metaError && rows) {
            const vals = new Set<string>();
            for (const row of rows) {
              const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
              if (meta && meta[field] != null && meta[field] !== '') {
                vals.add(String(meta[field]));
              }
            }
            filterValues[field] = [...vals].sort();
          }
        }
      }

      sourceFilters[source.id] = {
        name: source.name,
        category: source.category,
        filterFields,
        filterValues,
      };
    }

    console.log('[source-filters] Loaded filters for', Object.keys(sourceFilters).length, 'sources');

    return NextResponse.json({ success: true, sourceFilters });
  } catch (error) {
    console.error('[source-filters] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

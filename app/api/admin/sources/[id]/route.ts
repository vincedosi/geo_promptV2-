/**
 * GENESIS — API Route — /api/admin/sources/[id]
 * GET    : Détail d'une data source
 * PATCH  : Modifier (nom, org, partage, status)
 * DELETE : Supprime la source + toutes ses données
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { id } = params;

    const { data, error } = await supabase
      .from('data_sources')
      .select(`
        *,
        organizations(id, name, slug)
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Source non trouvee' }, { status: 404 });
    }

    // Count linked rows
    const [poiResult, panneauxResult] = await Promise.all([
      supabase.from('poi_france').select('id', { count: 'exact', head: true }).eq('data_source_id', id),
      supabase.from('panneaux_affichage').select('id', { count: 'exact', head: true }).eq('data_source_id', id),
    ]);

    return NextResponse.json({
      success: true,
      source: {
        ...data,
        linked_poi_count: poiResult.count || 0,
        linked_panneaux_count: panneauxResult.count || 0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { id } = params;
    const body = await request.json();

    // Allowed update fields
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.organization_id !== undefined) updates.organization_id = body.organization_id;
    if (body.shared_with !== undefined) updates.shared_with = body.shared_with;
    if (body.status !== undefined) updates.status = body.status;
    if (body.ai_summary !== undefined) updates.ai_summary = body.ai_summary;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Rien a modifier' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('data_sources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, source: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur modification';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { id } = params;

    // 1. Delete linked POIs
    const poiResult = await supabase
      .from('poi_france')
      .delete()
      .eq('data_source_id', id);
    
    console.log('[delete-source] POI delete result:', poiResult.error?.message || 'OK', 'count:', poiResult.count);

    // 2. Delete linked panneaux (may not exist)
    const panneauxResult = await supabase
      .from('panneaux_affichage')
      .delete()
      .eq('data_source_id', id);
    
    console.log('[delete-source] Panneaux delete result:', panneauxResult.error?.message || 'OK');

    // 3. Delete the data source itself (hard delete)
    const sourceResult = await supabase
      .from('data_sources')
      .delete()
      .eq('id', id);

    if (sourceResult.error) {
      console.error('[delete-source] Source delete error:', sourceResult.error);
      throw sourceResult.error;
    }

    console.log('[delete-source] Source deleted successfully:', id);

    return NextResponse.json({
      success: true,
      deleted: {
        poi: poiResult.count || 0,
        panneaux: panneauxResult.count || 0,
        source: true,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur suppression';
    console.error('[delete-source] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

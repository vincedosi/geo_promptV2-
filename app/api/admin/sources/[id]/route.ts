/**
 * GENESIS — API Route — /api/admin/sources/[id]
 * GET    : Détail d'une data source
 * PATCH  : Modifier (nom, org, partage, status)
 * DELETE : Supprime la source + toutes ses données
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();
    const { id } = await params;

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

    if (profile.role !== 'super_admin' && data.organization_id && data.organization_id !== profile.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
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
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const body = await request.json();

    if (profile.role !== 'super_admin' && body.organization_id && body.organization_id !== profile.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { id } = await params;

    // Allowed update fields
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.organization_id !== undefined) updates.organization_id = body.organization_id;
    if (body.shared_with !== undefined) updates.shared_with = body.shared_with;
    if (body.status !== undefined) updates.status = body.status;
    if (body.ai_summary !== undefined) updates.ai_summary = body.ai_summary;
    if (body.filter_fields !== undefined) updates.filter_fields = body.filter_fields;

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
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();
    const { id } = await params;

    // Fetch source details to know the type + check ownership
    const { data: sourceData, error: sourceFetchErr } = await supabase
      .from('data_sources')
      .select('type, geo_config, organization_id')
      .eq('id', id)
      .single();

    if (sourceFetchErr || !sourceData) {
      return NextResponse.json({ success: false, error: 'Source non trouvée' }, { status: 404 });
    }

    if (profile.role !== 'super_admin' && sourceData.organization_id && sourceData.organization_id !== profile.organization_id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    let deletedPoi = 0;
    let deletedPanneaux = 0;
    let deletedCarreaux = false;

    if (sourceData.type === 'carreaux') {
      // ── Carreaux : DROP la table dynamique via RPC ──────────────────────
      const tableName = rpcJson<{ table_name?: string }>(sourceData.geo_config)?.table_name;
      if (tableName && /^[a-z_][a-z0-9_]*$/.test(tableName)) {
        try {
          await supabase.rpc('drop_carreaux_table', { table_name: tableName });
          deletedCarreaux = true;
          logger.debug('delete-source', `Table carreaux '${tableName}' supprimée`);
        } catch (dropErr: unknown) {
          console.error(`[delete-source] Erreur DROP table '${tableName}':`, dropErr instanceof Error ? dropErr.message : String(dropErr));
          // Fallback: try deleting directly if RPC doesn't exist
          // The table will be orphaned but the source entry will still be removed
        }
      }
    } else {
      // ── POI / Panneaux : supprimer les lignes liées ───────────────────
      const poiResult = await supabase
        .from('poi_france')
        .delete()
        .eq('data_source_id', id);
      deletedPoi = poiResult.count || 0;
      logger.debug('delete-source', `POI delete result ${poiResult.error?.message || 'OK'} count: ${deletedPoi}`);

      const panneauxResult = await supabase
        .from('panneaux_affichage')
        .delete()
        .eq('data_source_id', id);
      deletedPanneaux = panneauxResult.count || 0;
      logger.debug('delete-source', `Panneaux delete result ${panneauxResult.error?.message || 'OK'}`);
    }

    // Supprimer l'entrée data_sources
    const sourceResult = await supabase
      .from('data_sources')
      .delete()
      .eq('id', id);

    if (sourceResult.error) {
      console.error('[delete-source] Source delete error:', sourceResult.error);
      throw sourceResult.error;
    }

    logger.debug('delete-source', `Source deleted successfully ${id}`);

    return NextResponse.json({
      success: true,
      deleted: {
        poi: deletedPoi,
        panneaux: deletedPanneaux,
        carreaux: deletedCarreaux,
        source: true,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur suppression';
    console.error('[delete-source] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

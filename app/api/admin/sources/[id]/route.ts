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
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

/**
 * Les sept seules clefs que la route recopie vers la base, toutes optionnelles :
 * `undefined` signifie « ne pas toucher », et le « Rien a modifier » plus bas
 * en depend. `filter_fields` est un `jsonb` de forme libre.
 */
const ModifierSourceSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  shared_with: z.array(z.string().uuid()).nullable().optional(),
  // 'socle' = visible de toutes les organisations ; 'privee' = propriétaire
  // et shared_with (sql/234, lib/auth/getOrgSourceIds.ts).
  visibilite: z.enum(['socle', 'privee']).optional(),
  status: z.string().optional(),
  filter_fields: z.unknown().optional(),
});
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
    const corps = await lireCorps(request, ModifierSourceSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const body = corps.valeur;

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
    if (body.visibilite !== undefined) updates.visibilite = body.visibilite;
    if (body.status !== undefined) updates.status = body.status;
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

    // Les POI et panneaux recopient l'organisation de leur source (sql/235).
    // La règle de visibilité ne lit plus cette copie, mais une valeur fausse y
    // mentirait au prochain lecteur : on la tient à jour au transfert.
    if (body.organization_id !== undefined) {
      for (const table of ['poi_france', 'panneaux_affichage'] as const) {
        const { error: errCopie } = await supabase
          .from(table)
          .update({ organization_id: body.organization_id })
          .eq('data_source_id', id);
        if (errCopie) throw errCopie;
      }
    }

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
          // Le DROP a echoue : on N'EFFACE PAS la source.
          //
          // Avant, la source partait quand meme et la reponse disait
          // `success: true` — la table restait en base, orpheline, sans plus
          // aucune trace de ce qui l'avait creee. Garder la source garde le lien
          // vers la table et rend l'operation REJOUABLE : c'est strictement
          // mieux qu'un succes annonce sur une base laissee incoherente.
          const detail = dropErr instanceof Error ? dropErr.message : String(dropErr);
          logger.error('delete-source',
            `DROP de la table carreaux '${tableName}' ECHOUE : ${detail}. `
            + `La source est CONSERVEE pour que la suppression reste rejouable.`);
          return NextResponse.json({
            success: false,
            error: `La table de carreaux « ${tableName} » n'a pas pu etre supprimee : ${detail}. `
                 + `La source est conservee — relancez la suppression.`,
          }, { status: 500 });
        }
      }
    } else {
      // ── POI / Panneaux : supprimer les lignes liées ───────────────────
      //
      // `{ count: 'exact' }` n'est pas cosmetique : sans cette option,
      // supabase-js laisse `count` a `null` (voir la signature de `delete` dans
      // @supabase/postgrest-js). La reponse annoncait donc « 0 POI supprimes »
      // meme quand elle venait d'en effacer des milliers.
      //
      // Et l'erreur de ces deux suppressions n'etait PAS testee : elle finissait
      // interpolee dans un `logger.debug`. En cas d'echec, les POI restaient en
      // base avec un `data_source_id` pointant vers une source effacee juste
      // apres — des orphelins invisibles, sous un `success: true`.
      const poiResult = await supabase
        .from('poi_france')
        .delete({ count: 'exact' })
        .eq('data_source_id', id);
      if (poiResult.error) {
        logger.error('delete-source', `Suppression des POI ECHOUEE : ${poiResult.error.message}`);
        return NextResponse.json({
          success: false,
          error: `Les POI liés n'ont pas pu être supprimés : ${poiResult.error.message}. `
               + `La source est conservée — relancez la suppression.`,
        }, { status: 500 });
      }
      deletedPoi = poiResult.count ?? 0;

      const panneauxResult = await supabase
        .from('panneaux_affichage')
        .delete({ count: 'exact' })
        .eq('data_source_id', id);
      if (panneauxResult.error) {
        logger.error('delete-source', `Suppression des panneaux ECHOUEE : ${panneauxResult.error.message}`);
        return NextResponse.json({
          success: false,
          error: `Les panneaux liés n'ont pas pu être supprimés : ${panneauxResult.error.message}. `
               + `La source est conservée — relancez la suppression.`,
        }, { status: 500 });
      }
      deletedPanneaux = panneauxResult.count ?? 0;

      logger.debug('delete-source', `${deletedPoi} POI et ${deletedPanneaux} panneaux supprimes`);
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

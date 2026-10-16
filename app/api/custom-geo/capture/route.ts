/**
 * MAGELIAN — API /api/custom-geo/capture (POST)
 *
 * Reçoit N géométries + une transformation. Appelle transform_geometries_for_save
 * côté DB pour obtenir UNE géométrie finale, puis enchaine create + resolve codes.
 *
 * Différent de /save qui attend une géométrie déjà finale.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { resolveOrgWriteAccess } from '@/lib/campaigns/access';
import { toJson, nullableArg } from '@/lib/supabase/rpc-json';
import { lireRecette } from '@/lib/zones/recette-schema';
import type { Recette } from '@/lib/zones/recette';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const SubzoneSchema = z.object({
  name: z.string().min(1).max(200),
  source_ref: z.string().max(200).optional().nullable(),
  geometry: z.record(z.unknown()),
  default_multiplier: z.number().min(0).max(5).optional(),
});

const CaptureSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  org_id: z.string().uuid(),
  source_type: z.string().min(1).max(100),
  source_metadata: z.record(z.unknown()).default({}),
  geometries: z.array(z.record(z.unknown())).min(1).max(100),
  transformation: z.enum(['union', 'convex_hull', 'envelope', 'raw']),
  /**
   * Sous-zones nommées (ex: 1 par POI battle). Si fourni :
   *   • La géométrie parente est l'union des sous-zones (calculée DB-side ici).
   *   • Chaque CP/IRIS résolu est rattaché à sa sous-zone d'origine.
   *   • Le wizard Custom Bidding peut pondérer chaque sous-zone séparément.
   */
  subzones: z.array(SubzoneSchema).max(50).optional(),
  /**
   * Lot 3 (carte en parcours) : la recette FIGÉE de la zone capturée — `isochrone` (une bataille) ou `capture` —,
   * validée par `lireRecette`. Facultative : React ne l'envoie pas, et son comportement est inchangé.
   */
  recette: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  // Early size check via Content-Length header avant de lire le body
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 0 && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', max_bytes: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = CaptureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!resolveOrgWriteAccess(profile.role, profile.organization_id, parsed.data.org_id)) {
    return NextResponse.json({ error: 'forbidden_org' }, { status: 403 });
  }

  // Lot 3 : la capture garde une recette FIGÉE (isochrone ou capture) ; React n'envoie pas le champ.
  // Contrôlée AVANT toute RPC : une recette refusée ne crée rien.
  let recette: Recette | null = null;
  if (parsed.data.recette !== undefined) {
    const lue = lireRecette(parsed.data.recette);
    if (!lue.ok || (lue.recette.type !== 'isochrone' && lue.recette.type !== 'capture')) {
      return NextResponse.json({ error: 'Recette invalide pour une capture.' }, { status: 400 });
    }
    recette = lue.recette;
  }

  const supabase = createAdminClient();

  // 1. Transformer les N géométries en UNE seule via RPC
  const { data: geomJson, error: transformError } = await supabase.rpc('transform_geometries_for_save', {
    p_geometries: toJson(parsed.data.geometries),
    p_method: parsed.data.transformation,
  });

  if (transformError || !geomJson) {
    console.error('[custom-geo/capture] transform', transformError?.message);
    return NextResponse.json(
      { error: 'transform_failed', message: transformError?.message ?? 'unknown' },
      { status: 400 },
    );
  }

  // 2. Créer la zone (avec sous-zones si fournies)
  // Si subzones[] présent → RPC v2 qui persiste les sous-zones individuelles.
  // Sinon → RPC legacy (back-compat parfaite, comportement inchangé).
  const hasSubzones = (parsed.data.subzones?.length ?? 0) > 0;
  const subzonesPayload = hasSubzones
    ? parsed.data.subzones!.map(sz => ({
        name: sz.name,
        source_ref: sz.source_ref ?? null,
        geometry_geojson: JSON.stringify(sz.geometry),
        default_multiplier: sz.default_multiplier ?? 1.0,
      }))
    : null;

  // Les deux RPC n'ont pas la meme signature (`p_subzones` n'existe que sur la
  // variante avec sous-zones) : un seul objet de params ne peut pas satisfaire
  // les deux. D'ou deux appels litteraux, que les types generes verifient
  // chacun contre sa propre fonction. `p_description` est un `text` SQL qui
  // accepte NULL, ce que les types generes ne savent pas exprimer.
  const createParams = {
    p_name: parsed.data.name,
    p_description: nullableArg(parsed.data.description),
    p_org_id: parsed.data.org_id,
    p_source_type: parsed.data.source_type,
    p_source_metadata: toJson({
      ...parsed.data.source_metadata,
      transformation: parsed.data.transformation,
    }),
    p_geometry_geojson: JSON.stringify(geomJson),
  };

  const { data: zoneId, error: createError } = hasSubzones
    ? await supabase.rpc('create_custom_geo_zone_with_subzones', {
        ...createParams,
        p_subzones: toJson(subzonesPayload),
      })
    : await supabase.rpc('create_custom_geo_zone', createParams);

  if (createError || !zoneId) {
    console.error('[custom-geo/capture] create', createError?.message);
    return NextResponse.json(
      { error: 'create_failed', message: 'Internal server error' },
      { status: 400 },
    );
  }

  // 2 bis. La recette, écrite AVANT la résolution des codes : une résolution en échec (207 plus bas) la garde.
  // Son échec n'emporte pas la zone : il est dit à la fin, par un 207 `recette_non_enregistree`.
  let recetteEnregistree = true;
  if (recette) {
    const { error: recetteError } = await supabase
      .from('custom_geo_zones')
      .update({ recette: toJson(recette) })
      .eq('id', zoneId);
    if (recetteError) {
      console.error('[custom-geo/capture] recette', recetteError.message);
      recetteEnregistree = false;
    }
  }

  // 3. Résoudre IRIS + CP
  // Si la zone a des sous-zones → resolve v2 (rattache chaque code à sa sous-zone).
  // Sinon → resolve legacy (équivalent fonctionnel pour zones sans sous-zones).
  const resolveRpc = hasSubzones
    ? 'resolve_custom_geo_zone_codes_with_subzones'
    : 'resolve_custom_geo_zone_codes';
  const { data: resolveData, error: resolveError } = await supabase.rpc(
    resolveRpc,
    { p_zone_id: zoneId, p_caller_user_id: profile.id },
  );

  if (resolveError) {
    console.error('[custom-geo/capture] resolve', resolveError.message);
    return NextResponse.json(
      {
        zone_id: zoneId,
        warning: 'zone_created_but_resolution_failed',
        ...(recetteEnregistree ? {} : { recette_non_enregistree: true }),
        // Lot 3 : le client Angular affiche `message` quand il est présent (React l'ignore).
        message: recetteEnregistree
          ? 'Zone créée ; ses codes postaux n’ont pas pu être résolus.'
          : 'Zone créée ; ses codes postaux n’ont pas pu être résolus, et sa recette n’a pas été enregistrée.',
      },
      { status: 207 },
    );
  }

  const resolved = (resolveData ?? {}) as { count_iris?: number; count_cp?: number };

  // 4. Calculer les stats audience (population, ménages, logements, revenus)
  // Non-bloquant : si le calcul échoue (zone trop large, timeout) on retourne
  // quand même la zone créée. Les stats peuvent être recalculées plus tard.
  const { error: statsError } = await supabase.rpc(
    'compute_zone_audience_stats',
    { p_zone_id: zoneId, p_caller_user_id: profile.id },
  );
  if (statsError) {
    console.warn('[custom-geo/capture] audience_stats', statsError.message);
  }

  if (!recetteEnregistree) {
    return NextResponse.json(
      {
        zone_id: zoneId, warning: 'recette_non_enregistree', count_iris: resolved.count_iris ?? 0, count_cp: resolved.count_cp ?? 0,
        message: 'Zone sauvegardée, mais sa recette n’a pas pu être enregistrée.',
      },
      { status: 207 },
    );
  }

  return NextResponse.json({
    zone_id: zoneId,
    count_iris: resolved.count_iris ?? 0,
    count_cp: resolved.count_cp ?? 0,
    audience_computed: !statsError,
  });
}

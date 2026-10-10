/**
 * MAGELIAN — POST /api/admin/dsp/dv360/targeting/push
 * Pousse le ciblage géo d'une zone custom (codes postaux → geo IDs Google)
 * sur un line item DV360 via bulkEditAssignedTargetingOptions.
 *
 * Additif : n'efface pas le ciblage géo existant du line item.
 * Renvoie 403/502 tant que le compte connecté n'a pas de droits DV360
 * (blocage droits Google en cours — voir /admin/api/dv360).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { resolveAccessToken, bulkAssignGeoRegions, type Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';
import { mapPostalCodesToGeoIds, GEO_POSTAL_FR_VERSION } from '@/lib/digital/dv360-geo';
import { lireCodesDeZone } from '@/lib/custom-geo/codes-zone';

export const dynamic = 'force-dynamic';

/** Garde-fou : au-delà, passer par l'export fichier (bulkEdit DV360 plafonne les opérations par requête). */
const MAX_GEO_IDS_PER_PUSH = 2000;

const PushSchema = z.object({
  zone_id: z.string().uuid(),
  advertiser_id: z.string().regex(/^\d+$/),
  line_item_id: z.string().regex(/^\d+$/),
});

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const parsed = PushSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { zone_id, advertiser_id, line_item_id } = parsed.data;

  const supabase = createAdminClient();

  // La zone doit appartenir à l'org du demandeur (client admin = pas de RLS).
  const { data: zone, error: zoneErr } = await supabase
    .from('custom_geo_zones')
    .select('id, name, org_id')
    .eq('id', zone_id)
    .single();
  if (zoneErr || !zone || zone.org_id !== orgId) {
    return NextResponse.json({ error: 'Zone introuvable.' }, { status: 404 });
  }

  const { data: conn, error: connErr } = await supabase
    .from('dsp_connections')
    .select('auth_method, credentials_encrypted, oauth_refresh_token_encrypted, oauth_client_id, oauth_client_secret_encrypted, partner_id')
    .eq('organization_id', orgId).eq('provider', 'dv360').single();
  if (connErr || !conn) {
    return NextResponse.json({ error: 'Aucune connexion DV360 enregistrée.' }, { status: 404 });
  }

  // Lecture paginée : PostgREST coupe une table à 1 000 lignes (`db-max-rows`),
  // l'ancien `.limit(100000)` poussait 1 000 CP d'une zone de 1 641 sans
  // erreur (lib/custom-geo/codes-zone.ts).
  let cps: string[];
  try {
    cps = await lireCodesDeZone(supabase, zone_id, 'cp');
  } catch (e) {
    console.error('[dv360/targeting/push] codes', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  if (cps.length === 0) {
    return NextResponse.json({ error: 'Aucun code postal résolu pour cette zone.' }, { status: 400 });
  }

  const { mapped, unmapped } = mapPostalCodesToGeoIds(cps);
  if (mapped.length === 0) {
    return NextResponse.json({ error: 'Aucun code postal mappé vers un geo ID Google.' }, { status: 400 });
  }
  if (mapped.length > MAX_GEO_IDS_PER_PUSH) {
    return NextResponse.json(
      {
        error: `Zone trop large : ${mapped.length} geo IDs (max ${MAX_GEO_IDS_PER_PUSH} par push). Utiliser l'export fichier.`,
      },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const token = await resolveAccessToken(conn as Dv360ConnectionRow);
    const result = await bulkAssignGeoRegions(
      token,
      advertiser_id,
      line_item_id,
      mapped.map((m) => m.geo_id),
    );
    const durationMs = Date.now() - started;

    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_geo_targeting',
      statusCode: 200, durationMs,
      message: `${mapped.length} geo IDs poussés sur le line item ${line_item_id} (zone « ${zone.name} »)`,
      detail: {
        zone_id, advertiser_id, line_item_id,
        geo_count: mapped.length,
        unmapped_count: unmapped.length,
        geotargets_version: GEO_POSTAL_FR_VERSION,
        failed_line_item_ids: result.failedLineItemIds,
      },
    });

    return NextResponse.json({
      ok: true,
      pushed_geo_ids: mapped.length,
      unmapped_postal_codes: unmapped,
      updated_line_item_ids: result.updatedLineItemIds,
      failed_line_item_ids: result.failedLineItemIds,
    });
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_geo_targeting',
      level: 'error', durationMs, message: msg,
      detail: { zone_id, advertiser_id, line_item_id, geo_count: mapped.length },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/**
 * MAGELIAN — POST /api/admin/dsp/dv360/zones/push
 * Crée dans DV360 une location list régionale nommée comme la zone custom,
 * peuplée avec les geo IDs Google des codes postaux de la zone.
 * La liste est ensuite attachable à n'importe quel line item depuis l'UI DV360.
 *
 * Renvoie 502 avec le message Google tant que le compte connecté n'a pas de
 * droits DV360 (blocage droits en cours — voir /admin/api/dv360).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import {
  resolveAccessToken,
  createLocationList,
  bulkAddAssignedLocations,
  type Dv360ConnectionRow,
} from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';
import { mapPostalCodesToGeoIds, GEO_POSTAL_FR_VERSION } from '@/lib/digital/dv360-geo';

export const dynamic = 'force-dynamic';

/** Plafond DV360 des localisations assignables à une location list régionale. */
const MAX_LOCATIONS_PER_LIST = 10000;

const PushSchema = z.object({
  zone_id: z.string().uuid(),
  advertiser_id: z.string().regex(/^\d+$/),
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
  const { zone_id, advertiser_id } = parsed.data;

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

  const { data: codes, error: codesErr } = await supabase
    .from('custom_geo_zone_codes')
    .select('code')
    .eq('zone_id', zone_id)
    .eq('code_type', 'cp')
    .order('code')
    .limit(100000); // PostgREST tronque à 5000 rows par défaut
  if (codesErr) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const cps = (codes ?? []).map((r) => r.code);
  if (cps.length === 0) {
    return NextResponse.json({ error: 'Aucun code postal résolu pour cette zone.' }, { status: 400 });
  }

  const { mapped, unmapped } = mapPostalCodesToGeoIds(cps);
  if (mapped.length === 0) {
    return NextResponse.json({ error: 'Aucun code postal mappé vers un geo ID Google.' }, { status: 400 });
  }
  if (mapped.length > MAX_LOCATIONS_PER_LIST) {
    return NextResponse.json(
      { error: `Zone trop large : ${mapped.length} geo IDs (max ${MAX_LOCATIONS_PER_LIST} par location list).` },
      { status: 400 },
    );
  }

  const started = Date.now();
  let locationListId: string | null = null;
  try {
    const token = await resolveAccessToken(conn as Dv360ConnectionRow);
    const created = await createLocationList(token, advertiser_id, zone.name);
    locationListId = created.locationListId;
    const { assignedCount } = await bulkAddAssignedLocations(
      token,
      advertiser_id,
      locationListId,
      mapped.map((m) => m.geo_id),
    );
    const durationMs = Date.now() - started;

    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_location_list',
      statusCode: 200, durationMs,
      message: `Location list « ${zone.name} » créée (${assignedCount} geo IDs) chez l'advertiser ${advertiser_id}`,
      detail: {
        zone_id, advertiser_id,
        location_list_id: locationListId,
        assigned_count: assignedCount,
        unmapped_count: unmapped.length,
        geotargets_version: GEO_POSTAL_FR_VERSION,
      },
    });

    return NextResponse.json({
      ok: true,
      location_list_id: locationListId,
      location_list_name: zone.name,
      assigned_count: assignedCount,
      unmapped_postal_codes: unmapped,
    });
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_location_list',
      level: 'error', durationMs, message: msg,
      detail: { zone_id, advertiser_id, location_list_id: locationListId, geo_count: mapped.length },
    });
    return NextResponse.json(
      {
        error: msg,
        // Si la liste a été créée mais le remplissage a échoué, l'ID permet
        // de reprendre/nettoyer dans l'UI DV360 au lieu de créer un doublon.
        location_list_id: locationListId,
      },
      { status: 502 },
    );
  }
}

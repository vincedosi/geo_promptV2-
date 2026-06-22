/** MAGELIAN — POST /api/admin/dsp/dv360/test : appel réel DV360 (list advertisers) prouvant l'auth. */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { resolveAccessToken, listAdvertisers, type Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: conn, error: readErr } = await supabase
    .from('dsp_connections')
    .select('auth_method, credentials_encrypted, oauth_refresh_token_encrypted, partner_id')
    .eq('organization_id', orgId).eq('provider', 'dv360').single();

  if (readErr || !conn) {
    return NextResponse.json({ error: 'Aucune connexion DV360 enregistrée.' }, { status: 404 });
  }
  if (!conn.partner_id) {
    return NextResponse.json({ error: 'Partner ID manquant.' }, { status: 400 });
  }

  const started = Date.now();
  try {
    const token = await resolveAccessToken(conn as Dv360ConnectionRow);
    const advertisers = await listAdvertisers(token, conn.partner_id);
    const durationMs = Date.now() - started;

    await supabase.from('dsp_connections').update({
      status: 'connected', advertiser_ids: advertisers, last_error: null,
    }).eq('organization_id', orgId).eq('provider', 'dv360');

    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'list_advertisers',
      statusCode: 200, durationMs,
      message: `${advertisers.length} advertisers récupérés`,
      detail: { count: advertisers.length, partner_id: conn.partner_id },
    });

    return NextResponse.json({ ok: true, advertisers });
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = (e as Error).message;
    await supabase.from('dsp_connections').update({ status: 'error', last_error: msg })
      .eq('organization_id', orgId).eq('provider', 'dv360');
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'list_advertisers',
      level: 'error', durationMs, message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

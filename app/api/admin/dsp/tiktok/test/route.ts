/** MAGELIAN — POST /api/admin/dsp/tiktok/test : appel réel TikTok (list advertisers) prouvant l'auth. */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { listTiktokAdvertisers } from '@/lib/dsp/tiktok/client';
import { decryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: conn, error: readErr } = await supabase
    .from('dsp_connections')
    .select('oauth_client_id, oauth_client_secret_encrypted, oauth_refresh_token_encrypted')
    .eq('organization_id', orgId).eq('provider', 'tiktok').single();

  if (readErr || !conn) {
    return NextResponse.json({ error: 'Aucune connexion TikTok enregistrée.' }, { status: 404 });
  }

  const appId = conn.oauth_client_id ?? process.env.TIKTOK_APP_ID ?? null;
  const secret = conn.oauth_client_secret_encrypted
    ? decryptSecret(conn.oauth_client_secret_encrypted)
    : process.env.TIKTOK_APP_SECRET ?? null;
  if (!appId || !secret) {
    return NextResponse.json({ error: 'App TikTok non configurée (App ID + Secret).' }, { status: 400 });
  }
  if (!conn.oauth_refresh_token_encrypted) {
    return NextResponse.json(
      { error: 'Aucun access token : lance d\'abord « Se connecter avec TikTok ».' },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const accessToken = decryptSecret(conn.oauth_refresh_token_encrypted);
    const advertisers = await listTiktokAdvertisers(appId, secret, accessToken);
    const durationMs = Date.now() - started;

    await supabase.from('dsp_connections').update({
      status: 'connected', advertiser_ids: advertisers, last_error: null,
    }).eq('organization_id', orgId).eq('provider', 'tiktok');

    await logDspEvent({
      orgId, provider: 'tiktok', category: 'api_call', action: 'list_advertisers',
      statusCode: 200, durationMs,
      message: `${advertisers.length} advertisers récupérés`,
      detail: { count: advertisers.length },
    });

    return NextResponse.json({ ok: true, advertisers });
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from('dsp_connections').update({ status: 'error', last_error: msg })
      .eq('organization_id', orgId).eq('provider', 'tiktok');
    await logDspEvent({
      orgId, provider: 'tiktok', category: 'api_call', action: 'list_advertisers',
      level: 'error', durationMs, message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

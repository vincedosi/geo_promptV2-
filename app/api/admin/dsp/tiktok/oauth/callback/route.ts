/**
 * MAGELIAN — GET /api/admin/dsp/tiktok/oauth/callback
 * Échange l'auth_code TikTok contre l'access token longue durée et l'enregistre
 * chiffré. Vérif anti-CSRF : state signé HMAC portant l'orgId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { exchangeTiktokAuthCode } from '@/lib/dsp/tiktok/client';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets';
import { verifyState } from '@/lib/dsp/oauth-state';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

function redirectToUi(request: NextRequest, query: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${base}/admin/api/tiktok?${query}`);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // TikTok renvoie `auth_code` (certaines versions du portail envoient `code`)
  const authCode = url.searchParams.get('auth_code') ?? url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!authCode || !state) return redirectToUi(request, 'oauth=error&reason=missing_code_or_state');

  let orgId: string;
  try {
    orgId = verifyState(state);
  } catch {
    return redirectToUi(request, 'oauth=error&reason=invalid_state');
  }

  try {
    const supabase = createAdminClient();
    const { data: conn } = await supabase
      .from('dsp_connections')
      .select('oauth_client_id, oauth_client_secret_encrypted')
      .eq('organization_id', orgId).eq('provider', 'tiktok').single();

    const appId = conn?.oauth_client_id ?? process.env.TIKTOK_APP_ID ?? null;
    const secret = conn?.oauth_client_secret_encrypted
      ? decryptSecret(conn.oauth_client_secret_encrypted)
      : process.env.TIKTOK_APP_SECRET ?? null;
    if (!appId || !secret) {
      return redirectToUi(request, 'oauth=error&reason=missing_app_credentials');
    }

    const { accessToken, advertiserIds } = await exchangeTiktokAuthCode(appId, secret, authCode);

    const { error: dbError } = await supabase.from('dsp_connections').upsert({
      organization_id: orgId,
      provider: 'tiktok',
      auth_method: 'oauth',
      status: 'disconnected', // « connected » seulement après un Test réussi
      // Token longue durée TikTok (pas de refresh token) — stocké chiffré
      oauth_refresh_token_encrypted: encryptSecret(accessToken),
      advertiser_ids: advertiserIds.map((id) => ({ id, name: id })),
      token_expires_at: null,
      last_error: null,
    }, { onConflict: 'organization_id,provider' });

    if (dbError) return redirectToUi(request, 'oauth=error&reason=db');

    await logDspEvent({
      orgId, provider: 'tiktok', category: 'connection', action: 'oauth_callback',
      message: `OAuth TikTok connecté (${advertiserIds.length} advertisers autorisés)`,
    });
    return redirectToUi(request, 'oauth=success');
  } catch (e) {
    return redirectToUi(request, `oauth=error&reason=${encodeURIComponent((e as Error).message)}`);
  }
}

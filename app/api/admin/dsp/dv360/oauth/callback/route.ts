/** MAGELIAN — GET /api/admin/dsp/dv360/oauth/callback : échange le code OAuth et enregistre la connexion. */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { exchangeCode } from '@/lib/dsp/dv360/auth';
import { encryptSecret } from '@/lib/crypto/secrets';
import { logDspEvent } from '@/lib/dsp/logger';

export const dynamic = 'force-dynamic';

function redirectToUi(request: NextRequest, query: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${base}/admin/api/dv360?${query}`);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const orgId = url.searchParams.get('state'); // orgId porté par le state
  const oauthError = url.searchParams.get('error');

  if (oauthError) return redirectToUi(request, `oauth=error&reason=${encodeURIComponent(oauthError)}`);
  if (!code || !orgId) return redirectToUi(request, 'oauth=error&reason=missing_code_or_state');

  try {
    const { refreshToken, expiryDate } = await exchangeCode(code);
    if (!refreshToken) {
      // Google n'a pas renvoyé de refresh token (consent déjà accordé sans prompt)
      return redirectToUi(request, 'oauth=error&reason=no_refresh_token');
    }
    const supabase = createAdminClient();
    const { error: dbError } = await supabase.from('dsp_connections').upsert({
      organization_id: orgId,
      provider: 'dv360',
      auth_method: 'oauth',
      status: 'disconnected',
      oauth_refresh_token_encrypted: encryptSecret(refreshToken),
      credentials_encrypted: null,
      token_expires_at: expiryDate ? new Date(expiryDate).toISOString() : null,
      last_error: null,
    }, { onConflict: 'organization_id,provider' });

    if (dbError) return redirectToUi(request, `oauth=error&reason=${encodeURIComponent('db')}`);

    await logDspEvent({ orgId, provider: 'dv360', category: 'connection', action: 'oauth_callback', message: 'OAuth Google connecté' });
    return redirectToUi(request, 'oauth=success');
  } catch (e) {
    return redirectToUi(request, `oauth=error&reason=${encodeURIComponent((e as Error).message)}`);
  }
}

/**
 * MAGELIAN — POST /api/admin/dsp/dv360/oauth/start : prépare le flux OAuth Google.
 *
 * Appelé en XHR (adminFetch) et NON en navigation directe : une navigation
 * `<a href>` n'envoie pas le header Authorization Bearer, donc requireDspAccess
 * renverrait 401. Le client récupère l'URL de consentement renvoyée puis
 * fait `window.location = url` lui-même.
 *
 * Persiste le partner_id AVANT la redirection : le callback OAuth ne le connaît
 * pas (Google ne le renvoie pas) et son upsert préserve la valeur écrite ici.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { buildAuthUrl } from '@/lib/dsp/dv360/auth';
import { oauthCredsFromRow } from '@/lib/dsp/dv360/client';
import { signState } from '@/lib/dsp/oauth-state';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée.' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const partnerId = typeof body.partner_id === 'string' ? body.partner_id.trim() : '';
  if (!partnerId) return NextResponse.json({ error: 'Partner ID requis.' }, { status: 400 });

  const supabase = createAdminClient();
  // Persiste le partner_id (et marque la méthode oauth) avant le détour Google.
  // Le callback upsert n'écrit pas partner_id → la valeur ci-dessous est conservée.
  const { error } = await supabase.from('dsp_connections').upsert({
    organization_id: orgId,
    provider: 'dv360',
    auth_method: 'oauth',
    status: 'disconnected',
    partner_id: partnerId,
    created_by: profile.id,
  }, { onConflict: 'organization_id,provider' });

  if (error) {
    console.error('[POST dv360/oauth/start]', error.message);
    return NextResponse.json({ error: 'Erreur enregistrement partner_id.' }, { status: 500 });
  }

  // Recharge les creds client OAuth de l'org (saisis via formulaire) pour
  // construire l'URL de consentement. Si absents → fallback env dans buildAuthUrl.
  const { data: conn } = await supabase
    .from('dsp_connections')
    .select('oauth_client_id, oauth_client_secret_encrypted')
    .eq('organization_id', orgId).eq('provider', 'dv360').single();
  const creds = conn
    ? oauthCredsFromRow({
        auth_method: 'oauth', credentials_encrypted: null, oauth_refresh_token_encrypted: null,
        oauth_client_id: conn.oauth_client_id, oauth_client_secret_encrypted: conn.oauth_client_secret_encrypted,
      })
    : undefined;

  try {
    return NextResponse.json({ url: buildAuthUrl(signState(orgId), creds) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

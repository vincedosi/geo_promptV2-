/**
 * MAGELIAN — diagnostic one-off : liste les partners DV360 accessibles
 * par le refresh token OAuth stocké dans dsp_connections.
 *
 * Usage : npx tsx scripts/dv360_list_partners.ts
 * Lit .env.local (DSP_ENC_KEY, SUPABASE) — serveur uniquement, n'affiche aucun secret.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const { decryptSecret } = await import('../lib/crypto/secrets');
  const { refreshAccessToken, getOAuthRedirectUri } = await import('../lib/dsp/dv360/auth');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: conn, error } = await supabase
    .from('dsp_connections')
    .select('partner_id, oauth_client_id, oauth_client_secret_encrypted, oauth_refresh_token_encrypted')
    .eq('provider', 'dv360')
    .single();

  if (error || !conn) throw new Error(`Connexion DV360 introuvable : ${error?.message}`);
  if (!conn.oauth_refresh_token_encrypted) throw new Error('Pas de refresh token stocké.');

  console.log(`Partner ID configuré : ${conn.partner_id}`);
  console.log(`Client OAuth org     : ${conn.oauth_client_id ? 'oui (formulaire)' : 'non (env vars)'}`);

  const creds = conn.oauth_client_id && conn.oauth_client_secret_encrypted
    ? {
        clientId: conn.oauth_client_id,
        clientSecret: decryptSecret(conn.oauth_client_secret_encrypted),
        redirectUri: getOAuthRedirectUri()!,
      }
    : undefined;

  const { accessToken } = await refreshAccessToken(
    decryptSecret(conn.oauth_refresh_token_encrypted),
    creds,
  );
  console.log('Refresh token → access token : OK');

  // Sonde plusieurs endpoints pour cartographier les droits réels du compte.
  const probe = async (label: string, url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.text();
    console.log(`\n── ${label} → HTTP ${res.status}`);
    console.log(body.slice(0, 600));
    return { status: res.status, body };
  };

  await probe('partners.list', 'https://displayvideo.googleapis.com/v3/partners?pageSize=100');
  await probe(`partners.get(${conn.partner_id})`, `https://displayvideo.googleapis.com/v3/partners/${conn.partner_id}`);
  await probe(`advertisers.list(partner=${conn.partner_id})`, `https://displayvideo.googleapis.com/v3/advertisers?partnerId=${conn.partner_id}&pageSize=10`);
}

main().catch((e) => { console.error('ERREUR :', (e as Error).message); process.exit(1); });

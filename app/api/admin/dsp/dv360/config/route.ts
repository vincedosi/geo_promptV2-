/**
 * MAGELIAN — GET /api/admin/dsp/dv360/config : diagnostic de configuration serveur.
 *
 * Rend visible côté UI ce qui manque AVANT de tenter une connexion, plutôt que
 * d'échouer par un popup cryptique. Ne renvoie JAMAIS de valeur secrète : pour
 * chaque variable sensible, un booléen « présente ou non ». Le redirect URI
 * (non secret) est renvoyé en clair pour vérifier qu'il matche la console Google.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDspAccess, authUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

function present(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export async function GET(request: NextRequest) {
  const profile = await requireDspAccess(request);
  if (!profile) return authUnauthorized();

  const env = {
    enc_key: present(process.env.DSP_ENC_KEY),
    oauth_client_id: present(process.env.DV360_OAUTH_CLIENT_ID),
    oauth_client_secret: present(process.env.DV360_OAUTH_CLIENT_SECRET),
    oauth_redirect_uri: present(process.env.DV360_OAUTH_REDIRECT_URI),
    redirect_uri_value: process.env.DV360_OAUTH_REDIRECT_URI ?? null, // non secret
  };

  // Une méthode est « prête » côté serveur si ses prérequis env sont là.
  const ready = {
    // Service Account : seul le chiffrement des secrets est requis côté env.
    service_account: env.enc_key,
    // OAuth : client id + secret + redirect uri + clé de chiffrement du refresh token.
    oauth: env.oauth_client_id && env.oauth_client_secret && env.oauth_redirect_uri && env.enc_key,
  };

  return NextResponse.json({ env, ready }, { headers: { 'Cache-Control': 'no-store' } });
}

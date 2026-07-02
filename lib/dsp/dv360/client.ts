/**
 * MAGELIAN — client REST DV360 (Display & Video 360 API v3).
 * Résout un access token depuis une connexion stockée (chiffrée) puis
 * effectue des appels REST. Serveur uniquement.
 */
import { getServiceAccountToken, refreshAccessToken, type OAuthClientCreds } from './auth';
import { decryptSecret } from '@/lib/crypto/secrets';

const DV360_BASE = 'https://displayvideo.googleapis.com/v3';

export interface Dv360ConnectionRow {
  auth_method: 'service_account' | 'oauth' | null;
  credentials_encrypted: string | null;
  oauth_refresh_token_encrypted: string | null;
  oauth_client_id?: string | null;
  oauth_client_secret_encrypted?: string | null;
}

/**
 * Reconstitue les credentials du client OAuth depuis une connexion (secret déchiffré).
 * Retourne undefined si rien n'est stocké → buildOAuthClient retombe sur les env vars.
 */
export function oauthCredsFromRow(conn: Dv360ConnectionRow): OAuthClientCreds | undefined {
  if (!conn.oauth_client_id || !conn.oauth_client_secret_encrypted) return undefined;
  const redirectUri = process.env.DV360_OAUTH_REDIRECT_URI;
  if (!redirectUri) return undefined; // sans redirect URI, fallback env (qui lèvera l'erreur explicite)
  return {
    clientId: conn.oauth_client_id,
    clientSecret: decryptSecret(conn.oauth_client_secret_encrypted),
    redirectUri,
  };
}

export async function resolveAccessToken(conn: Dv360ConnectionRow): Promise<string> {
  if (conn.auth_method === 'service_account') {
    if (!conn.credentials_encrypted) throw new Error('Aucune clé Service Account enregistrée.');
    return getServiceAccountToken(decryptSecret(conn.credentials_encrypted));
  }
  if (conn.auth_method === 'oauth') {
    if (!conn.oauth_refresh_token_encrypted) throw new Error('Aucun refresh token OAuth enregistré.');
    const { accessToken } = await refreshAccessToken(
      decryptSecret(conn.oauth_refresh_token_encrypted),
      oauthCredsFromRow(conn),
    );
    return accessToken;
  }
  throw new Error('Méthode d\'authentification DV360 non configurée.');
}

export async function listAdvertisers(
  accessToken: string,
  partnerId: string,
): Promise<{ id: string; name: string }[]> {
  const url = `${DV360_BASE}/advertisers?partnerId=${encodeURIComponent(partnerId)}&pageSize=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DV360 advertisers.list ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    advertisers?: { advertiserId: string; displayName: string }[];
  };
  return (data.advertisers ?? []).map((a) => ({ id: a.advertiserId, name: a.displayName }));
}

/**
 * MAGELIAN — client REST TikTok Business API (Marketing API v1.3).
 *
 * OAuth self-service : app développeur TikTok (App ID + Secret) → consentement
 * → auth_code → access_token LONGUE DURÉE (TikTok ne fournit pas de refresh
 * token : l'access token ne s'échange qu'une fois et reste valable).
 * Toutes les réponses sont enveloppées { code, message, data } : code !== 0 = erreur.
 * Serveur uniquement.
 */

import { fetchAvecDelai } from '@/lib/http/fetch-avec-delai';

const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const TIKTOK_PORTAL_AUTH = 'https://business-api.tiktok.com/portal/auth';

/** Redirect URI du callback OAuth : env explicite ou dérivée de NEXT_PUBLIC_APP_URL. */
export function getTiktokRedirectUri(): string | null {
  const explicit = process.env.TIKTOK_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/admin/dsp/tiktok/oauth/callback`;
}

/** URL de consentement TikTok (portail business-api). */
export function buildTiktokAuthUrl(appId: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({ app_id: appId, state, redirect_uri: redirectUri });
  return `${TIKTOK_PORTAL_AUTH}?${params.toString()}`;
}

interface TiktokEnvelope<T> {
  code: number;
  message: string;
  data: T;
  request_id?: string;
}

async function unwrapTiktok<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TikTok ${action} HTTP ${res.status} : ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as TiktokEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(`TikTok ${action} code ${json.code} : ${json.message}`);
  }
  return json.data;
}

/** Échange l'auth_code du callback contre l'access token longue durée. */
export async function exchangeTiktokAuthCode(
  appId: string,
  secret: string,
  authCode: string,
): Promise<{ accessToken: string; advertiserIds: string[] }> {
  const res = await fetchAvecDelai(`${TIKTOK_BASE}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
  });
  const data = await unwrapTiktok<{ access_token: string; advertiser_ids?: (string | number)[] }>(
    res,
    'oauth2/access_token',
  );
  return {
    accessToken: data.access_token,
    advertiserIds: (data.advertiser_ids ?? []).map(String),
  };
}

/** Liste les advertisers autorisés pour ce token (preuve de connexion). */
export async function listTiktokAdvertisers(
  appId: string,
  secret: string,
  accessToken: string,
): Promise<{ id: string; name: string }[]> {
  const params = new URLSearchParams({ app_id: appId, secret });
  const res = await fetchAvecDelai(`${TIKTOK_BASE}/oauth2/advertiser/get/?${params.toString()}`, {
    headers: { 'Access-Token': accessToken },
    cache: 'no-store',
  });
  const data = await unwrapTiktok<{ list?: { advertiser_id: string | number; advertiser_name: string }[] }>(
    res,
    'oauth2/advertiser/get',
  );
  return (data.list ?? []).map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name }));
}

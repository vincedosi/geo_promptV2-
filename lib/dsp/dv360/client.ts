/**
 * MAGELIAN — client REST DV360 (Display & Video 360 API v3).
 * Résout un access token depuis une connexion stockée (chiffrée) puis
 * effectue des appels REST. Serveur uniquement.
 */
import { getServiceAccountToken, refreshAccessToken, getOAuthRedirectUri, type OAuthClientCreds } from './auth';
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
  const redirectUri = getOAuthRedirectUri(); // env explicite ou dérivée de NEXT_PUBLIC_APP_URL
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

/**
 * Assigne des geo IDs Google (TARGETING_TYPE_GEO_REGION) à un line item via
 * bulkEditAssignedTargetingOptions. Additif : ne supprime pas le ciblage géo
 * existant (un delete nécessiterait de lister les options assignées au préalable).
 */
export async function bulkAssignGeoRegions(
  accessToken: string,
  advertiserId: string,
  lineItemId: string,
  geoIds: number[],
): Promise<{ updatedLineItemIds: string[]; failedLineItemIds: string[] }> {
  const url = `${DV360_BASE}/advertisers/${encodeURIComponent(advertiserId)}/lineItems:bulkEditAssignedTargetingOptions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      lineItemIds: [lineItemId],
      createRequests: [
        {
          targetingType: 'TARGETING_TYPE_GEO_REGION',
          assignedTargetingOptions: geoIds.map((id) => ({
            geoRegionDetails: { targetingOptionId: String(id) },
          })),
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DV360 bulkEditAssignedTargetingOptions ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    updatedLineItemIds?: string[];
    failedLineItemIds?: string[];
  };
  return {
    updatedLineItemIds: data.updatedLineItemIds ?? [],
    failedLineItemIds: data.failedLineItemIds ?? [],
  };
}

/**
 * Crée une liste de localisations régionale (location list) chez un advertiser.
 * C'est l'objet DV360 « zone » réutilisable : attachable ensuite à n'importe
 * quel line item / insertion order depuis l'UI DV360.
 */
export async function createLocationList(
  accessToken: string,
  advertiserId: string,
  displayName: string,
): Promise<{ locationListId: string }> {
  const url = `${DV360_BASE}/advertisers/${encodeURIComponent(advertiserId)}/locationLists`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      // DV360 plafonne displayName à 240 bytes
      displayName: displayName.slice(0, 240),
      locationType: 'TARGETING_LOCATION_TYPE_REGIONAL',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DV360 locationLists.create ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { locationListId?: string };
  if (!data.locationListId) {
    throw new Error('DV360 locationLists.create : locationListId absent de la réponse.');
  }
  return { locationListId: data.locationListId };
}

/** Taille de lot pour assignedLocations:bulkEdit (limite la taille de payload par requête). */
const ASSIGNED_LOCATIONS_CHUNK = 500;

/** Ajoute des geo IDs Google à une location list, par lots séquentiels. */
export async function bulkAddAssignedLocations(
  accessToken: string,
  advertiserId: string,
  locationListId: string,
  geoIds: number[],
): Promise<{ assignedCount: number }> {
  const url = `${DV360_BASE}/advertisers/${encodeURIComponent(advertiserId)}/locationLists/${encodeURIComponent(locationListId)}/assignedLocations:bulkEdit`;
  let assignedCount = 0;
  for (let i = 0; i < geoIds.length; i += ASSIGNED_LOCATIONS_CHUNK) {
    const chunk = geoIds.slice(i, i + ASSIGNED_LOCATIONS_CHUNK);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        createdAssignedLocations: chunk.map((id) => ({ targetingOptionId: String(id) })),
        deletedAssignedLocationIds: [],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `DV360 assignedLocations.bulkEdit ${res.status} après ${assignedCount}/${geoIds.length} assignations : ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as { assignedLocations?: unknown[] };
    assignedCount += data.assignedLocations?.length ?? chunk.length;
  }
  return { assignedCount };
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

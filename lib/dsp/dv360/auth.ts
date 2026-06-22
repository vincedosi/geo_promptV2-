/**
 * MAGELIAN — authentification Google DV360.
 * Deux méthodes : Service Account (JWT) et OAuth2 utilisateur (3-legged).
 * Scopes centralisés ici (no hardcode ailleurs). Serveur uniquement.
 */
import { JWT, OAuth2Client } from 'google-auth-library';

export const DV360_SCOPES = [
  'https://www.googleapis.com/auth/display-video',
  // 'https://www.googleapis.com/auth/doubleclickbidmanager' — reporting, itération 2
];

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccountKey {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('Clé Service Account : JSON invalide.');
  }
  const sa = obj as Partial<ServiceAccountKey>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error('Clé Service Account : champs client_email / private_key manquants.');
  }
  return { client_email: sa.client_email, private_key: sa.private_key };
}

export async function getServiceAccountToken(saJson: string): Promise<string> {
  const sa = parseServiceAccount(saJson);
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: DV360_SCOPES,
  });
  const { access_token } = await client.authorize();
  if (!access_token) throw new Error('DV360 : échec obtention access token (Service Account).');
  return access_token;
}

export function buildOAuthClient(): OAuth2Client {
  const id = process.env.DV360_OAUTH_CLIENT_ID;
  const secret = process.env.DV360_OAUTH_CLIENT_SECRET;
  const redirect = process.env.DV360_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redirect) {
    throw new Error('Variables OAuth DV360 manquantes (DV360_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI).');
  }
  return new OAuth2Client(id, secret, redirect);
}

export function buildAuthUrl(state: string): string {
  return buildOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DV360_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<{
  refreshToken: string | null;
  accessToken: string;
  expiryDate: number | null;
}> {
  const { tokens } = await buildOAuthClient().getToken(code);
  if (!tokens.access_token) throw new Error('DV360 OAuth : access token absent de la réponse.');
  return {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token,
    expiryDate: tokens.expiry_date ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiryDate: number | null;
}> {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('DV360 OAuth : échec refresh access token.');
  const expiry = client.credentials.expiry_date ?? null;
  return { accessToken: token, expiryDate: expiry };
}

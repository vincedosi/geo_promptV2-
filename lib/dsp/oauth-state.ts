/**
 * MAGELIAN — signature HMAC du paramètre `state` OAuth (anti-CSRF).
 * Le state porte l'orgId : sans signature, un attaquant pourrait rattacher
 * ses tokens à une autre organisation en falsifiant le paramètre.
 * Format : `orgId.expiresAtMs.signatureB64url` (orgId = UUID, jamais de '.').
 * Secret : DSP_ENC_KEY (réutilisée) avec séparation de domaine. Serveur uniquement.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DOMAIN = 'dsp-oauth-state:v1';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // state valable 10 min

function getHmacKey(): Buffer {
  const b64 = process.env.DSP_ENC_KEY;
  if (!b64) throw new Error('[oauth-state] DSP_ENC_KEY manquante dans l\'environnement.');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('[oauth-state] DSP_ENC_KEY doit faire 32 bytes (base64).');
  }
  return key;
}

function sign(message: string): string {
  return createHmac('sha256', getHmacKey())
    .update(`${DOMAIN}|${message}`)
    .digest('base64url');
}

/** Construit un state signé liant l'orgId, avec expiration. `now` injectable pour les tests. */
export function signState(orgId: string, now: number = Date.now(), ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = now + ttlMs;
  const message = `${orgId}.${expiresAt}`;
  return `${message}.${sign(message)}`;
}

/**
 * Vérifie un state signé et retourne l'orgId.
 * Lève une erreur si la signature est invalide, le format est incorrect, ou le state a expiré.
 */
export function verifyState(state: string, now: number = Date.now()): string {
  const parts = state.split('.');
  if (parts.length !== 3) throw new Error('state invalide : format incorrect.');
  const [orgId, expiresAtStr, sig] = parts;

  const expected = sign(`${orgId}.${expiresAtStr}`);
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('state invalide : signature non vérifiée.');
  }

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || now > expiresAt) {
    throw new Error('state invalide : expiré.');
  }
  return orgId;
}

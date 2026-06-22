/**
 * MAGELIAN — chiffrement symétrique des secrets DSP (AES-256-GCM).
 * Clé : DSP_ENC_KEY (base64, 32 bytes) en variable d'environnement serveur.
 * Format stocké : iv_b64:tag_b64:ciphertext_b64.
 * À importer côté serveur uniquement (jamais bundlé client).
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const b64 = process.env.DSP_ENC_KEY;
  if (!b64) throw new Error('[secrets] DSP_ENC_KEY manquante dans l\'environnement.');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('[secrets] DSP_ENC_KEY doit faire 32 bytes (base64). Générer : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))".');
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('[secrets] payload chiffré invalide.');
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

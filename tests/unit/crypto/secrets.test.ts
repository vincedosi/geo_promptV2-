import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  // Clé 32 bytes en base64, injectée avant import du module
  process.env.DSP_ENC_KEY = randomBytes(32).toString('base64');
});

describe('secrets', () => {
  it('round-trip : decrypt(encrypt(x)) === x', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto/secrets');
    const plain = '{"client_email":"sa@x.iam.gserviceaccount.com","private_key":"-----BEGIN..."}';
    const enc = encryptSecret(plain);
    expect(enc).not.toContain('client_email'); // chiffré
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('deux chiffrements du même clair diffèrent (IV aléatoire)', async () => {
    const { encryptSecret } = await import('@/lib/crypto/secrets');
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'));
  });

  it('payload altéré → throw', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto/secrets');
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split(':');
    const tampered = [iv, tag, Buffer.from('zzzz').toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

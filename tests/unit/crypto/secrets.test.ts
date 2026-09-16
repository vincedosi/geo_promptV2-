import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
/**
 * Import HISSÉ EN TÊTE — même famille que `dsp/dv360-auth.test.ts` et
 * `dsp/oauth-state.test.ts`, corrigés en même temps. Un `await import()` à
 * l'intérieur d'un `it()` fait porter le coût de chargement du module au
 * délai de 5 s de ce test ; sous la charge d'une passe complète, c'est ce qui
 * a rendu les deux autres fichiers instables. Celui-ci ne l'était pas encore,
 * il l'aurait été au prochain module lourd ajouté à son graphe.
 *
 * Sûr ici : `DSP_ENC_KEY` est lue par `getKey()`, appelée à chaque
 * chiffrement, jamais capturée au chargement du module.
 */
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets';

beforeAll(() => {
  // Clé 32 bytes en base64. Lue paresseusement par getKey() : la poser ici
  // suffit, l'import du module peut être en tête.
  process.env.DSP_ENC_KEY = randomBytes(32).toString('base64');
});

describe('secrets', () => {
  it('round-trip : decrypt(encrypt(x)) === x', () => {
    const plain = '{"client_email":"sa@x.iam.gserviceaccount.com","private_key":"-----BEGIN..."}';
    const enc = encryptSecret(plain);
    expect(enc).not.toContain('client_email'); // chiffré
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('deux chiffrements du même clair diffèrent (IV aléatoire)', () => {
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'));
  });

  it('payload altéré → throw', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split(':');
    const tampered = [iv, tag, Buffer.from('zzzz').toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

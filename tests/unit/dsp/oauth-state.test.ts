import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
/**
 * Import HISSÉ EN TÊTE — même correctif que `dv360-auth.test.ts`, même cause.
 *
 * Les quatre cas faisaient `await import('@/lib/dsp/oauth-state')` dans le
 * `it()` : la résolution et la transformation Vite du module étaient donc
 * facturées au DÉLAI DE 5 s du premier test qui l'importe, et sous la charge
 * des 133 fichiers en parallèle ce délai était dépassé. Ce fichier-ci ne
 * génère aucune clé RSA — `randomBytes(32)` coûte quelques microsecondes ;
 * c'est bien le chargement de module qui dépassait, pas la cryptographie.
 *
 * Sûr ici pour la même raison que l'autre : `DSP_ENC_KEY` est lue par
 * `getHmacKey()`, APPELÉE à chaque signature, jamais capturée au chargement du
 * module. Le `beforeAll` ci-dessous garde donc son effet malgré l'import
 * anticipé. (Le commentaire « injectée avant import du module » décrivait une
 * précaution qui n'était pas nécessaire — et qui coûtait la stabilité.)
 */
import { signState, verifyState } from '@/lib/dsp/oauth-state';

beforeAll(() => {
  // Clé 32 bytes en base64. Lue paresseusement par getHmacKey(), donc poser
  // la variable ici suffit — l'import du module peut être en tête.
  process.env.DSP_ENC_KEY = randomBytes(32).toString('base64');
});

const ORG = '11111111-1111-1111-1111-111111111111';

describe('oauth-state', () => {
  it('round-trip : verifyState(signState(orgId)) === orgId', () => {
    const state = signState(ORG);
    expect(verifyState(state)).toBe(ORG);
  });

  it('state falsifié (orgId modifié) → throw', () => {
    const state = signState(ORG);
    const [, exp, sig] = state.split('.');
    const forged = `22222222-2222-2222-2222-222222222222.${exp}.${sig}`;
    expect(() => verifyState(forged)).toThrow();
  });

  it('signature tronquée / format incorrect → throw', () => {
    expect(() => verifyState(ORG)).toThrow();
    expect(() => verifyState(`${ORG}.123`)).toThrow();
  });

  it('state expiré → throw', () => {
    const past = 1_000_000; // now figé dans le passé
    const state = signState(ORG, past, 60_000); // expire à past+60s
    expect(() => verifyState(state, past + 61_000)).toThrow();
    expect(verifyState(state, past + 30_000)).toBe(ORG); // encore valide
  });
});

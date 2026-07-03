import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  // Clé 32 bytes en base64, injectée avant import du module
  process.env.DSP_ENC_KEY = randomBytes(32).toString('base64');
});

const ORG = '11111111-1111-1111-1111-111111111111';

describe('oauth-state', () => {
  it('round-trip : verifyState(signState(orgId)) === orgId', async () => {
    const { signState, verifyState } = await import('@/lib/dsp/oauth-state');
    const state = signState(ORG);
    expect(verifyState(state)).toBe(ORG);
  });

  it('state falsifié (orgId modifié) → throw', async () => {
    const { signState, verifyState } = await import('@/lib/dsp/oauth-state');
    const state = signState(ORG);
    const [, exp, sig] = state.split('.');
    const forged = `22222222-2222-2222-2222-222222222222.${exp}.${sig}`;
    expect(() => verifyState(forged)).toThrow();
  });

  it('signature tronquée / format incorrect → throw', async () => {
    const { verifyState } = await import('@/lib/dsp/oauth-state');
    expect(() => verifyState(ORG)).toThrow();
    expect(() => verifyState(`${ORG}.123`)).toThrow();
  });

  it('state expiré → throw', async () => {
    const { signState, verifyState } = await import('@/lib/dsp/oauth-state');
    const past = 1_000_000; // now figé dans le passé
    const state = signState(ORG, past, 60_000); // expire à past+60s
    expect(() => verifyState(state, past + 61_000)).toThrow();
    expect(verifyState(state, past + 30_000)).toBe(ORG); // encore valide
  });
});

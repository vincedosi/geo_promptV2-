import { describe, expect, it } from 'vitest';
import { MockProvider } from '@/lib/civic-health/mock-provider';

describe('MockProvider', () => {
  const provider = new MockProvider();

  it('returns null for empty code_insee', async () => {
    const r = await provider.fetchHealth('');
    expect(r).toBeNull();
  });

  it('returns deterministic payload for same code', async () => {
    const a = await provider.fetchHealth('75056');
    const b = await provider.fetchHealth('75056');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Same indices for same code (fetchedAt diffère car ISO timestamp)
    expect(a!.air?.indice).toBe(b!.air?.indice);
    expect(a!.pollen?.indice_global).toBe(b!.pollen?.indice_global);
    expect(a!.air?.sous_indices).toEqual(b!.air?.sous_indices);
    expect(a!.pollen?.especes).toEqual(b!.pollen?.especes);
  });

  it('returns different payloads for different codes', async () => {
    const a = await provider.fetchHealth('75056');
    const b = await provider.fetchHealth('13201');
    // Au moins une métrique doit différer (sinon hash trop faible).
    const same =
      a!.air?.indice === b!.air?.indice &&
      a!.pollen?.indice_global === b!.pollen?.indice_global;
    expect(same).toBe(false);
  });

  it('produces valid AtmoLevel and PollenLevel values', async () => {
    const r = await provider.fetchHealth('75056');
    expect(r!.air!.indice).toBeGreaterThanOrEqual(1);
    expect(r!.air!.indice).toBeLessThanOrEqual(6);
    expect(r!.pollen!.indice_global).toBeGreaterThanOrEqual(0);
    expect(r!.pollen!.indice_global).toBeLessThanOrEqual(6);
    for (const v of Object.values(r!.pollen!.especes)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('exposes the ODbL source string', async () => {
    const r = await provider.fetchHealth('75056');
    expect(r!.source).toBe('Atmo France et AASQA');
  });

  it('marks payload as not stale by default', async () => {
    const r = await provider.fetchHealth('75056');
    expect(r!.stale).toBe(false);
  });
});

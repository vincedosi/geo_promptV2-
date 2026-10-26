/**
 * `pousserCiblageDv360` (lot 7, T1, A-2 ; Review Focus 5) : le simulé fait les MÊMES contrôles et rend les MÊMES
 * comptes que le réel, sans jamais appeler Google ni lire de connexion. Client Google et journal simulés.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import geoPostalFr from '@/lib/digital/google-geo-postal-fr.json';

const google = vi.hoisted(() => ({
  resolveAccessToken: vi.fn(async () => 'jeton'),
  bulkAssignGeoRegions: vi.fn(async (_t: string, _a: string, li: string) => ({ updatedLineItemIds: [li], failedLineItemIds: [] })),
}));
vi.mock('@/lib/dsp/dv360/client', () => google);
const journal = vi.hoisted(() => ({ logDspEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/dsp/logger', () => journal);

const { pousserCiblageDv360, MAX_GEO_IDS_PER_PUSH } = await import('@/lib/dsp/dv360/pousser-ciblage');

/** Un client dont seule la lecture de `dsp_connections` répond ; tout autre accès est compté. */
function clientFactice(connexion: Record<string, unknown> | null) {
  const from = vi.fn(() => {
    const q = { select: () => q, eq: () => q, single: async () => ({ data: connexion, error: connexion ? null : { message: 'absente' } }) };
    return q;
  });
  return { client: { from } as never, from };
}

const CONNEXION = { auth_method: 'oauth', oauth_refresh_token_encrypted: 'x', credentials_encrypted: null };
const TOUS_LES_CP = Object.keys((geoPostalFr as { postal: Record<string, number> }).postal);
const base = { orgId: 'org', advertiserId: '1', lineItemId: '42', libelle: 'essai' };

beforeEach(() => { vi.clearAllMocks(); });

describe('pousserCiblageDv360', () => {
  it('simulé : aucun appel Google, aucune lecture de connexion, mêmes comptes que le réel', async () => {
    const cps = [...TOUS_LES_CP.slice(0, 5), '00000', '99999'];
    const sim = clientFactice(null);
    const simule = await pousserCiblageDv360({ ...base, supabase: sim.client, cps, mode: 'simule' });
    expect(google.bulkAssignGeoRegions).not.toHaveBeenCalled();
    expect(google.resolveAccessToken).not.toHaveBeenCalled();
    expect(sim.from).not.toHaveBeenCalled();
    expect(journal.logDspEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'push_geo_targeting_simule' }));

    const reel = await pousserCiblageDv360({ ...base, supabase: clientFactice(CONNEXION).client, cps, mode: 'reel' });
    expect(google.bulkAssignGeoRegions).toHaveBeenCalledTimes(1);
    expect(simule).toEqual(reel);
    expect(simule).toMatchObject({ ok: true, pushed_geo_ids: 5, unmapped_postal_codes: ['00000', '99999'] });
  });

  it(`au-delà de ${MAX_GEO_IDS_PER_PUSH} geo IDs : 400 « Utiliser l'export fichier », dans les deux modes`, async () => {
    const cps = TOUS_LES_CP.slice(0, MAX_GEO_IDS_PER_PUSH + 1);
    for (const mode of ['simule', 'reel'] as const) {
      const r = await pousserCiblageDv360({ ...base, supabase: clientFactice(CONNEXION).client, cps, mode });
      expect(r).toMatchObject({ ok: false, status: 400 });
      expect(!r.ok && r.error).toContain("Utiliser l'export fichier");
    }
    expect(google.bulkAssignGeoRegions).not.toHaveBeenCalled();
  });

  it('0 CP mappé, ou 0 CP : 400, dans les deux modes', async () => {
    for (const mode of ['simule', 'reel'] as const) {
      const sb = clientFactice(CONNEXION).client;
      expect(await pousserCiblageDv360({ ...base, supabase: sb, cps: ['00000'], mode }))
        .toEqual({ ok: false, status: 400, error: 'Aucun code postal mappé vers un geo ID Google.' });
      expect(await pousserCiblageDv360({ ...base, supabase: sb, cps: [], mode }))
        .toMatchObject({ ok: false, status: 400 });
    }
    expect(google.bulkAssignGeoRegions).not.toHaveBeenCalled();
  });

  it('réel sans connexion : 404 inchangé ; erreur Google : 502', async () => {
    expect(await pousserCiblageDv360({ ...base, supabase: clientFactice(null).client, cps: TOUS_LES_CP.slice(0, 2), mode: 'reel' }))
      .toEqual({ ok: false, status: 404, error: 'Aucune connexion DV360 enregistrée.' });
    google.bulkAssignGeoRegions.mockRejectedValueOnce(new Error('DV360 403'));
    expect(await pousserCiblageDv360({ ...base, supabase: clientFactice(CONNEXION).client, cps: TOUS_LES_CP.slice(0, 2), mode: 'reel' }))
      .toEqual({ ok: false, status: 502, error: 'DV360 403' });
  });
});

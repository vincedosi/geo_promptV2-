/**
 * `pousserCiblageDv360` (lot 7, T1, A-2 ; Review Focus 5) : le simulé fait les MÊMES contrôles et rend les MÊMES
 * comptes que le réel, sans jamais appeler Google ni lire de connexion. Client Google et journal simulés.
 * Relecture 1 du lot 7 (I-2) : en réel, un jeton Google qui ne répond jamais fait échouer la cible au bout de
 * `DELAI_JETON_GOOGLE_MS`, et `POST …/activation/pousser` clôt quand même son lot (pré-vol, accès et base simulés).
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

/** La base vue par la route `pousser` : chaque insert et update est noté. */
const base_ = vi.hoisted(() => ({ ecritures: [] as { table: string; op: string; valeur: unknown }[] }));
vi.mock('@/lib/auth', async (original) => ({
  ...(await original<typeof import('@/lib/auth')>()),
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const note = (op: string) => (valeur: unknown) => { base_.ecritures.push({ table, op, valeur }); return q; };
      Object.assign(q, {
        insert: note('insert'), update: note('update'), select: () => q,
        // Chaînable ET attendable : `update().eq()` s'attend, `select().eq().eq().single()` se chaîne.
        eq: () => q,
        then: (ok: (v: unknown) => unknown) => ok({ error: null }),
        single: async () => ({ data: { id: `${table}-1` }, error: null }),
      });
      return q;
    },
  }),
}));
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: 'u', role: 'super_admin', organization_id: 'org' }),
}));
vi.mock('@/lib/campaigns/access', () => ({ checkCampaignAccess: async () => 'ok' }));
vi.mock('@/lib/campaigns/etat-activation', () => ({
  lireEtatActivation: async () => ({
    strategie: { id: 's' }, versionPubliee: 1, zonesModifiees: [], source: { type: 'zone', zoneId: 'z' },
    extraction: null, cpsDv360: ['13001'], connexions: [], mode: 'reel', motifs: [],
  }),
}));

const { pousserCiblageDv360, MAX_GEO_IDS_PER_PUSH, DELAI_JETON_GOOGLE_MS } = await import('@/lib/dsp/dv360/pousser-ciblage');
const pousserRoute = await import('@/app/api/campaigns/[campaignId]/activation/pousser/route');

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

describe('jeton Google qui ne répond jamais (relecture 1, I-2)', () => {
  it('pousserCiblageDv360 réel : 502 au bout du délai, bulkEdit jamais appelé', async () => {
    vi.useFakeTimers();
    try {
      google.resolveAccessToken.mockImplementationOnce(() => new Promise<string>(() => {}));
      const issue = pousserCiblageDv360({ ...base, supabase: clientFactice(CONNEXION).client, cps: TOUS_LES_CP.slice(0, 2), mode: 'reel' });
      await vi.advanceTimersByTimeAsync(DELAI_JETON_GOOGLE_MS);
      expect(await issue).toEqual({ ok: false, status: 502, error: 'Jeton Google DV360 : aucune réponse après 30 s.' });
      expect(google.bulkAssignGeoRegions).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('POST …/activation/pousser : la cible passe en échec et le lot est clos (`finally` atteint)', async () => {
    vi.useFakeTimers();
    try {
      base_.ecritures = [];
      google.resolveAccessToken.mockImplementation(() => new Promise<string>(() => {}));
      const { NextRequest } = await import('next/server');
      const r = await pousserRoute.POST(
        new NextRequest('http://localhost/api/campaigns/c/activation/pousser', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canal: 'dv360', advertiser_id: '1', cibles: [{ line_item_id: '42' }] }),
        }),
        { params: Promise.resolve({ campaignId: '11111111-2222-4333-8444-555555555555' }) },
      );
      const texte = r.text();
      await vi.advanceTimersByTimeAsync(DELAI_JETON_GOOGLE_MS);
      const lignes = (await texte).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lignes.find((l) => l.etape === 'cible' && l.statut === 'echec'))
        .toMatchObject({ erreur: 'Jeton Google DV360 : aucune réponse après 30 s.' });
      expect(lignes.at(-1)).toMatchObject({ etape: 'fin', statut: 'echec', pousses: 0, echecs: 1 });
      expect(base_.ecritures).toContainEqual({ table: 'activation_lots', op: 'insert', valeur: expect.objectContaining({ mode: 'reel', statut: 'en_cours' }) });
      expect(base_.ecritures).toContainEqual({ table: 'activation_lots', op: 'update', valeur: expect.objectContaining({ statut: 'echec' }) });
    } finally {
      google.resolveAccessToken.mockImplementation(async () => 'jeton');
      vi.useRealTimers();
    }
  });
});

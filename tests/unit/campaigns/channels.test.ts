import { describe, it, expect } from 'vitest';
import {
  CampaignChannelsSchema, resolveChannelAvailability, validateSelection,
  EMPTY_CHANNELS, sumBudgets, pruneBudgets, pruneLinks, DspLinksSchema, ChannelsPutSchema,
  type ChannelRow,
} from '@/lib/campaigns/channels';

const REG: ChannelRow[] = [
  { code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: 'dv360', active: true },
  { code: 'ttd', label: 'The Trade Desk', category: 'dsp', connection_provider: null, active: true },
  { code: 'meta', label: 'Meta', category: 'social', connection_provider: 'meta', active: true },
  { code: 'adform', label: 'Adform', category: 'adserver', connection_provider: null, active: true },
];

describe('CampaignChannelsSchema', () => {
  it('accepte une sélection valide et EMPTY', () => {
    expect(CampaignChannelsSchema.safeParse(EMPTY_CHANNELS).success).toBe(true);
    expect(CampaignChannelsSchema.safeParse({ dsps: ['dv360'], socials: [], ad_server: 'adform' }).success).toBe(true);
  });
  it('rejette ad_server non-string/non-null et dsps > 10', () => {
    expect(CampaignChannelsSchema.safeParse({ dsps: [], socials: [], ad_server: 5 }).success).toBe(false);
    expect(CampaignChannelsSchema.safeParse({ dsps: Array(11).fill('x'), socials: [], ad_server: null }).success).toBe(false);
  });
});

describe('resolveChannelAvailability', () => {
  it('réel : seulement les connectés sont available', () => {
    const out = resolveChannelAvailability(REG, ['dv360'], false);
    const dv = out.find((r) => r.code === 'dv360')!;
    const ttd = out.find((r) => r.code === 'ttd')!;
    const meta = out.find((r) => r.code === 'meta')!;
    expect(dv.connected).toBe(true); expect(dv.available).toBe(true);
    expect(ttd.connected).toBe(false); expect(ttd.available).toBe(false);
    expect(meta.available).toBe(false); // meta connu mais org pas connectée
  });
  it('démo : tout est available', () => {
    const out = resolveChannelAvailability(REG, [], true);
    expect(out.every((r) => r.available)).toBe(true);
    expect(out.find((r) => r.code === 'dv360')!.connected).toBe(false);
  });
  it('exclut les canaux inactifs (active=false)', () => {
    const withInactive: ChannelRow[] = [
      ...REG,
      { code: 'inactif', label: 'Canal off', category: 'dsp', connection_provider: 'inactif', active: false },
    ];
    const out = resolveChannelAvailability(withInactive, ['inactif'], true);
    expect(out.find((r) => r.code === 'inactif')).toBeUndefined();
  });
  it('trie par catégorie puis par label', () => {
    const out = resolveChannelAvailability(REG, [], true);
    const keys = out.map((r) => `${r.category}/${r.label}`);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });
});

describe('validateSelection', () => {
  it('réel : refuse un code non connecté', () => {
    expect(validateSelection({ dsps: ['ttd'], socials: [], ad_server: null }, REG, ['dv360'], false))
      .toEqual({ ok: false, badCode: 'ttd' });
  });
  it('réel : accepte un connecté', () => {
    expect(validateSelection({ dsps: ['dv360'], socials: [], ad_server: null }, REG, ['dv360'], false))
      .toEqual({ ok: true });
  });
  it('refuse un code de mauvaise catégorie (dsp mis en ad_server)', () => {
    expect(validateSelection({ dsps: [], socials: [], ad_server: 'dv360' }, REG, ['dv360'], true))
      .toEqual({ ok: false, badCode: 'dv360' });
  });
  it('démo : accepte tout code du registre', () => {
    expect(validateSelection({ dsps: ['ttd'], socials: ['meta'], ad_server: 'adform' }, REG, [], true))
      .toEqual({ ok: true });
  });
  it('refuse un code inconnu', () => {
    expect(validateSelection({ dsps: ['nope'], socials: [], ad_server: null }, REG, [], true))
      .toEqual({ ok: false, badCode: 'nope' });
  });
  it('réel : refuse un réseau social non connecté', () => {
    expect(validateSelection({ dsps: [], socials: ['meta'], ad_server: null }, REG, [], false))
      .toEqual({ ok: false, badCode: 'meta' });
  });
});

describe('budgets par canal', () => {
  it('sumBudgets additionne les lignes et ignore les valeurs non finies', () => {
    expect(sumBudgets({ dv360: 30000, tiktok: 15000 })).toBe(45000);
    expect(sumBudgets({})).toBe(0);
    expect(sumBudgets(undefined)).toBe(0);
    expect(sumBudgets({ dv360: 100, bad: Number.NaN })).toBe(100);
  });

  it('pruneBudgets purge les lignes des canaux retirés', () => {
    const sel = { dsps: ['dv360'], socials: [], ad_server: 'adform' as string | null };
    expect(pruneBudgets({ dv360: 30000, tiktok: 15000 }, sel)).toEqual({ dv360: 30000 });
  });

  it("pruneBudgets garde les lignes des socials et tolère l'absence de budgets", () => {
    const sel = { dsps: ['dv360'], socials: ['tiktok'], ad_server: null };
    expect(pruneBudgets({ dv360: 1, tiktok: 2 }, sel)).toEqual({ dv360: 1, tiktok: 2 });
    expect(pruneBudgets(undefined, sel)).toEqual({});
  });

  it("pruneBudgets purge une ligne d'ad_server (budgets ne portent que sur dsps+socials)", () => {
    const sel = { dsps: ['dv360'], socials: [], ad_server: 'adform' as string | null };
    expect(pruneBudgets({ dv360: 1, adform: 5 }, sel)).toEqual({ dv360: 1 });
  });
});

describe('liaisons DSP (links) — ré-export depuis platform-links', () => {
  const dv360Link = { advertiser_id: '123', campaign_id: '456', insertion_order_id: '789' };

  it('pruneLinks garde la liaison du canal encore sélectionné (clé = code)', () => {
    const sel = { dsps: ['dv360'], socials: [], ad_server: null };
    expect(pruneLinks({ dv360: dv360Link }, sel)).toEqual({ dv360: dv360Link });
  });

  it('pruneLinks purge la liaison quand le canal est retiré', () => {
    const sel = { dsps: ['ttd'], socials: ['tiktok'], ad_server: null };
    expect(pruneLinks({ dv360: dv360Link }, sel)).toEqual({});
    expect(pruneLinks(undefined, sel)).toEqual({});
  });

  it('DspLinksSchema accepte les IDs + noms d’affichage DV360', () => {
    const parsed = DspLinksSchema.safeParse({
      dv360: { ...dv360Link, advertiser_name: 'ACME', campaign_name: 'Q3', insertion_order_name: 'IO 1' },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ChannelsPutSchema — cpm_prevus (⑥, lot 6, A-10)', () => {
  const sel = { dsps: ['dv360'], socials: ['meta'], ad_server: null };

  it('accepte des CPM par canal, facultatifs (un PUT de sélection seule reste valide)', () => {
    expect(ChannelsPutSchema.safeParse({ ...sel, cpm_prevus: { dv360: 4.5, meta: 0 } }).success).toBe(true);
    expect(ChannelsPutSchema.safeParse(sel).success).toBe(true);
  });

  it('refuse un CPM négatif, non fini ou une clé vide', () => {
    expect(ChannelsPutSchema.safeParse({ ...sel, cpm_prevus: { dv360: -1 } }).success).toBe(false);
    expect(ChannelsPutSchema.safeParse({ ...sel, cpm_prevus: { dv360: Number.POSITIVE_INFINITY } }).success).toBe(false);
    expect(ChannelsPutSchema.safeParse({ ...sel, cpm_prevus: { '': 3 } }).success).toBe(false);
  });

  it('une clé inconnue de la sélection est élaguée par pruneBudgets, comme un budget', () => {
    const lu = ChannelsPutSchema.parse({ ...sel, cpm_prevus: { dv360: 4.5, inconnu: 9 } });
    expect(pruneBudgets(lu.cpm_prevus, lu)).toEqual({ dv360: 4.5 });
  });
});

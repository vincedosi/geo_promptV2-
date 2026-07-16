import { describe, it, expect } from 'vitest';
import {
  DspLinksSchema, pruneLinks, linksComplete, linksSummary,
  type LinkLevel,
} from '@/lib/campaigns/platform-links';

const DV360_LEVELS: LinkLevel[] = [
  { key: 'advertiser', label: 'Annonceur' },
  { key: 'campaign', label: 'Campagne DV360' },
  { key: 'insertion_order', label: 'Insertion order' },
];

const dv360Link = {
  advertiser_id: '123', advertiser_name: 'ACME',
  campaign_id: '456', campaign_name: 'Q3',
  insertion_order_id: '789', insertion_order_name: 'IO 1',
};

describe('DspLinksSchema (générique)', () => {
  it('accepte une entrée DV360 (IDs + noms + algorithm_id)', () => {
    expect(DspLinksSchema.safeParse({ dv360: { ...dv360Link, algorithm_id: '42' } }).success).toBe(true);
  });
  it('accepte plusieurs canaux dont un ad server et une saisie manuelle partielle', () => {
    const parsed = DspLinksSchema.safeParse({
      tiktok: { advertiser_id: 'a1', campaign_name: 'Vague été' },
      cm360: { advertiser_id: 'x', campaign_id: 'y', placement_id: 'z' },
    });
    expect(parsed.success).toBe(true);
  });
  it('rejette une valeur non-string et une clé de niveau trop longue', () => {
    expect(DspLinksSchema.safeParse({ dv360: { advertiser_id: 12 } }).success).toBe(false);
    expect(DspLinksSchema.safeParse({ dv360: { ['k'.repeat(61)]: 'v' } }).success).toBe(false);
  });
});

describe('pruneLinks (par code canal)', () => {
  it('garde les entrées des canaux encore sélectionnés (dsps + socials + ad_server)', () => {
    const sel = { dsps: ['dv360'], socials: ['tiktok'], ad_server: 'cm360' as string | null };
    const links = {
      dv360: dv360Link,
      tiktok: { advertiser_id: 'a1' },
      cm360: { placement_id: 'p1' },
      meta: { ad_account_id: 'm1' },
    };
    expect(pruneLinks(links, sel)).toEqual({
      dv360: dv360Link, tiktok: { advertiser_id: 'a1' }, cm360: { placement_id: 'p1' },
    });
  });
  it('purge l’entrée quand le canal est retiré et tolère null/undefined', () => {
    const sel = { dsps: ['ttd'], socials: [], ad_server: null };
    expect(pruneLinks({ dv360: dv360Link }, sel)).toEqual({});
    expect(pruneLinks(undefined, sel)).toEqual({});
    expect(pruneLinks(null, sel)).toEqual({});
  });
  it('purge les entrées vides (aucune valeur non blanche)', () => {
    const sel = { dsps: ['dv360', 'ttd'], socials: [], ad_server: null };
    expect(pruneLinks({ dv360: dv360Link, ttd: { advertiser_id: '  ' } }, sel))
      .toEqual({ dv360: dv360Link });
  });
});

describe('linksComplete', () => {
  it('true quand chaque niveau a un ID', () => {
    expect(linksComplete(dv360Link, DV360_LEVELS)).toBe(true);
  });
  it('false si un niveau manque, si l’entrée est vide ou sans niveaux définis', () => {
    expect(linksComplete({ advertiser_id: '123' }, DV360_LEVELS)).toBe(false);
    expect(linksComplete(undefined, DV360_LEVELS)).toBe(false);
    expect(linksComplete(dv360Link, [])).toBe(false);
  });
});

describe('linksSummary', () => {
  it('enchaîne les noms renseignés (fallback ID) des niveaux non vides', () => {
    expect(linksSummary(dv360Link, DV360_LEVELS)).toBe('ACME → Q3 → IO 1');
    expect(linksSummary({ advertiser_id: '123', campaign_id: '456' }, DV360_LEVELS)).toBe('123 → 456');
    expect(linksSummary(undefined, DV360_LEVELS)).toBe('');
  });
});

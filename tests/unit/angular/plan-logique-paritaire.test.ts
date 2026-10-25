/**
 * La logique du plan de campagne copiée dans angular/ pour ⑥ (lot 6, T2) rend la MÊME chose que celle du wizard React
 * (`components/campaign/wizard/steps/types.ts`, `useDraftAutosave.ts`, `ForecastStrip.tsx`) et de
 * `lib/campaigns/{channels,platform-links}.ts`. Ce test empêche la copie de dériver pendant la cohabitation (gel P5) :
 * un brouillon écrit par l'un doit se relire à l'identique par l'autre (A-2).
 */
import { describe, expect, it } from 'vitest';
import * as Rt from '@/components/campaign/wizard/steps/types';
import * as Ra from '@/components/campaign/wizard/useDraftAutosave';
import { computeForecast } from '@/components/campaign/wizard/steps/ForecastStrip';
import * as Rc from '@/lib/campaigns/channels';
import * as Rl from '@/lib/campaigns/platform-links';
import * as Ab from '../../../angular/src/app/features/carte/logique/plan/brouillon';
import * as Ac from '../../../angular/src/app/features/carte/logique/plan/canaux';
import * as Al from '../../../angular/src/app/features/carte/logique/plan/liens-plateformes';
import { impressionsPrevues } from '../../../angular/src/app/features/carte/logique/plan/impressions';

const REG: Rc.ChannelRow[] = [
  { code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: 'dv360', active: true },
  { code: 'ttd', label: 'The Trade Desk', category: 'dsp', connection_provider: null, active: true },
  { code: 'meta', label: 'Meta', category: 'social', connection_provider: 'meta', active: true },
  { code: 'tiktok', label: 'TikTok', category: 'social', connection_provider: 'tiktok', active: false },
  { code: 'adform', label: 'Adform', category: 'adserver', connection_provider: null, active: true },
];
const SELECTIONS: Rc.CampaignChannels[] = [
  Rc.EMPTY_CHANNELS,
  { dsps: ['dv360'], socials: [], ad_server: null },
  { dsps: ['ttd', 'dv360'], socials: ['meta'], ad_server: 'adform' },
  { dsps: [], socials: ['tiktok'], ad_server: 'dv360' },
  { dsps: ['nope'], socials: [], ad_server: null },
];
const LIENS: Rl.DspLinks[] = [
  {},
  { dv360: { advertiser_id: '1', advertiser_name: 'ACME', campaign_id: '2', insertion_order_id: '3' } },
  { meta: { account_id: ' ', account_name: '' }, adform: { advertiser_id: '9' }, ttd: undefined },
  { tiktok: { advertiser_id: '7' }, dv360: {} },
];
const NIVEAUX: Rl.LinkLevel[][] = [
  [],
  [{ key: 'advertiser', label: 'Annonceur' }, { key: 'campaign', label: 'Campagne' }, { key: 'insertion_order', label: 'IO' }],
  [{ key: 'account', label: 'Compte' }],
];

describe('logique du plan de campagne : Angular = React', () => {
  it('ProgDraft — le défaut est le même, champ pour champ', () => {
    expect(Ab.DEFAULT_PROG_DRAFT).toEqual(Rt.DEFAULT_PROG_DRAFT);
  });

  it('draftTotalBudget et linksSelectionHash', () => {
    const budgets: Record<string, number>[] = [{}, { dv360: 30000.004, meta: 15000 }, { dv360: 1, ttd: Number.NaN, adform: 5 }, { meta: 0 }];
    for (const channels of SELECTIONS) for (const channelBudgets of budgets) {
      const d = { ...Rt.DEFAULT_PROG_DRAFT, channels, channelBudgets };
      expect(Ab.draftTotalBudget(d)).toBe(Rt.draftTotalBudget(d));
    }
    for (const channels of SELECTIONS) for (const links of LIENS) {
      expect(Ab.linksSelectionHash(channels, links)).toBe(Rt.linksSelectionHash(channels, links));
    }
  });

  it('brouillon serveur : un brouillon React se relit à l’identique, et réciproquement (champs hors V1 compris)', () => {
    const react = { ...Rt.DEFAULT_PROG_DRAFT, name: 'X', pressure: 2.8, objective: 'maximize_clicks', pacing: 'front_loaded' as const,
      cibles: [{ id: 'z', name: 'Zone', sourceType: 'custom', population: 1200 }], channelLinks: { dv360: { advertiser_id: '1' } } };
    expect(Ab.deserializeDraft(Ra.serializeDraft(react))).toEqual(Ra.deserializeDraft(Ra.serializeDraft(react)));
    // Les champs ajoutés par Angular (A-2) voyagent sans gêner React, qui les garde par son `...`.
    const angular = { ...Ab.DEFAULT_PROG_DRAFT, cpmPrevus: { dv360: 4.5 }, jeuZones: { id: 'j', nom: 'Jeu', version: 2, extraction: { id: 'x', version: 1 } } };
    expect(Ra.deserializeDraft(Ab.serializeDraft(angular))).toEqual(angular);
    for (const brut of [null, { foo: 'bar' }, { v: 2, draft: {} }, { v: 1, draft: 'x' }, { v: 1, draft: { name: 'Y' } }]) {
      expect(Ab.deserializeDraft(brut)).toEqual(Ra.deserializeDraft(brut));
    }
  });

  it('formats : montant en euros et date courte', () => {
    for (const n of [null, 0, 1234.5, 30000, -12]) expect(Ab.fmtEUR(n)).toBe(Rt.fmtEUR(n));
    for (const d of ['', '2026-10-25', 'pas une date', '2026-01-03T10:00:00Z']) expect(Ab.fmtDateShort(d)).toBe(Rt.fmtDateShort(d));
  });

  it('impressions prévues : la formule de computeForecast', () => {
    const budgets = [null, 0, 1000, 52000, 333.33];
    const cpms = [null, 0, -1, 3, 7.1, 0.5];
    for (const b of budgets) for (const c of cpms) expect(impressionsPrevues(b, c)).toBe(computeForecast(b, c, []).impressions);
  });

  it('canaux — disponibilité, validation, budgets', () => {
    for (const connectes of [[], ['dv360'], ['dv360', 'meta', 'tiktok']]) for (const demo of [false, true]) {
      expect(Ac.resolveChannelAvailability(REG, connectes, demo)).toEqual(Rc.resolveChannelAvailability(REG, connectes, demo));
      for (const sel of SELECTIONS) expect(Ac.validateSelection(sel, REG, connectes, demo)).toEqual(Rc.validateSelection(sel, REG, connectes, demo));
    }
    expect(Ac.EMPTY_CHANNELS).toEqual(Rc.EMPTY_CHANNELS);
    const lignes: (Rc.ChannelBudgets | null | undefined)[] = [undefined, null, {}, { dv360: 1, meta: 2, adform: 5, x: Number.NaN }];
    for (const b of lignes) {
      expect(Ac.sumBudgets(b)).toBe(Rc.sumBudgets(b));
      for (const sel of SELECTIONS) expect(Ac.pruneBudgets(b, sel)).toEqual(Rc.pruneBudgets(b, sel));
    }
  });

  it('liaisons plateforme — élagage, complétude, résumé', () => {
    for (const links of [null, undefined, ...LIENS]) for (const sel of SELECTIONS) {
      expect(Al.pruneLinks(links, sel)).toEqual(Rl.pruneLinks(links, sel));
    }
    for (const links of LIENS) for (const entry of [undefined, ...Object.values(links)]) for (const niveaux of NIVEAUX) {
      expect(Al.linksComplete(entry, niveaux)).toBe(Rl.linksComplete(entry, niveaux));
      expect(Al.linksSummary(entry, niveaux)).toBe(Rl.linksSummary(entry, niveaux));
    }
  });
});

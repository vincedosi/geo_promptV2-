import { describe, it, expect } from 'vitest';
import { effectiveCampaignStatus, campaignNeedsAttention, FRESHNESS_DAYS } from '@/lib/campaigns/status';

const base = { date_start: '2026-07-01', date_end: '2026-07-31', status_override: null };

describe('effectiveCampaignStatus', () => {
  it('à venir quand today < date_start', () => {
    expect(effectiveCampaignStatus(base, '2026-06-30')).toBe('a_venir');
  });
  it('en cours dans la fenêtre', () => {
    expect(effectiveCampaignStatus(base, '2026-07-15')).toBe('en_cours');
    expect(effectiveCampaignStatus(base, '2026-07-01')).toBe('en_cours'); // borne incluse
    expect(effectiveCampaignStatus(base, '2026-07-31')).toBe('en_cours'); // borne incluse
  });
  it('terminée quand today > date_end', () => {
    expect(effectiveCampaignStatus(base, '2026-08-01')).toBe('terminee');
  });
  it('override prime sur le calendrier', () => {
    expect(effectiveCampaignStatus({ ...base, status_override: 'paused' }, '2026-07-15')).toBe('en_pause');
    expect(effectiveCampaignStatus({ ...base, status_override: 'ended' }, '2026-07-15')).toBe('terminee');
    expect(effectiveCampaignStatus({ ...base, status_override: 'archived' }, '2026-07-15')).toBe('archivee');
  });
  it('dates nulles : jamais à venir sans date_start, jamais terminée sans date_end', () => {
    expect(effectiveCampaignStatus({ date_start: null, date_end: '2026-07-31', status_override: null }, '2026-06-01')).toBe('en_cours');
    expect(effectiveCampaignStatus({ date_start: '2026-07-01', date_end: null, status_override: null }, '2026-09-01')).toBe('en_cours');
    expect(effectiveCampaignStatus({ date_start: null, date_end: null, status_override: null }, '2026-07-15')).toBe('en_cours');
  });
});

describe('campaignNeedsAttention', () => {
  const today = '2026-07-15';
  it('faux si pas en cours', () => {
    expect(campaignNeedsAttention({ status: 'terminee', last_data_date: null }, today)).toBe(false);
    expect(campaignNeedsAttention({ status: 'a_venir', last_data_date: null }, today)).toBe(false);
  });
  it('vrai si en cours sans aucune donnée', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: null }, today)).toBe(true);
  });
  it('vrai si en cours et dernière donnée > FRESHNESS_DAYS', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-10' }, today)).toBe(true); // 5 jours
  });
  it('faux si en cours et donnée fraîche (<= FRESHNESS_DAYS)', () => {
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-13' }, today)).toBe(false); // 2 jours
    expect(campaignNeedsAttention({ status: 'en_cours', last_data_date: '2026-07-12' }, today)).toBe(false); // 3 jours = seuil
  });
  it('FRESHNESS_DAYS vaut 3', () => {
    expect(FRESHNESS_DAYS).toBe(3);
  });
});

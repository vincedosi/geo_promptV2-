import { describe, it, expect } from 'vitest';
import { resolveCampaignAccess } from '@/lib/campaigns/access';

describe('resolveCampaignAccess', () => {
  it('super_admin : autorisé quelle que soit l’org', () => {
    expect(resolveCampaignAccess('super_admin', null, 'org-a', [])).toBe(true);
    expect(resolveCampaignAccess('super_admin', 'org-b', 'org-a', [])).toBe(true);
  });
  it('org propriétaire : autorisé', () => {
    expect(resolveCampaignAccess('admin', 'org-a', 'org-a', [])).toBe(true);
    expect(resolveCampaignAccess('client', 'org-a', 'org-a', [])).toBe(true);
  });
  it('org liée via campaign_organizations : autorisé', () => {
    expect(resolveCampaignAccess('client', 'org-b', 'org-a', ['org-b', 'org-c'])).toBe(true);
  });
  it('org étrangère : refusé', () => {
    expect(resolveCampaignAccess('admin', 'org-z', 'org-a', ['org-b'])).toBe(false);
  });
  it('utilisateur sans org (non super_admin) : refusé', () => {
    expect(resolveCampaignAccess('client', null, 'org-a', ['org-a'])).toBe(false);
  });
  it('campagne sans org propriétaire : seule une org liée passe', () => {
    expect(resolveCampaignAccess('admin', 'org-a', null, [])).toBe(false);
    expect(resolveCampaignAccess('admin', 'org-a', null, ['org-a'])).toBe(true);
  });
});

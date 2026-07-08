import { describe, it, expect } from 'vitest';
import { resolveCampaignAccess, resolveZoneAccess, resolveOrgWriteAccess } from '@/lib/campaigns/access';

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

describe('resolveZoneAccess', () => {
  it('super_admin : autorisé partout', () => {
    expect(resolveZoneAccess('super_admin', null, 'org-a')).toBe(true);
    expect(resolveZoneAccess('super_admin', 'org-b', 'org-a')).toBe(true);
  });
  it('org propriétaire : autorisé', () => {
    expect(resolveZoneAccess('client', 'org-a', 'org-a')).toBe(true);
  });
  it('org étrangère : refusé', () => {
    expect(resolveZoneAccess('admin', 'org-b', 'org-a')).toBe(false);
  });
  it('sans org, ou zone sans org : refusé (non super_admin)', () => {
    expect(resolveZoneAccess('client', null, 'org-a')).toBe(false);
    expect(resolveZoneAccess('client', 'org-a', null)).toBe(false);
  });
});

describe('resolveOrgWriteAccess', () => {
  it('super_admin : peut agir pour n’importe quelle org', () => {
    expect(resolveOrgWriteAccess('super_admin', 'org-a', 'org-b')).toBe(true);
    expect(resolveOrgWriteAccess('super_admin', null, 'org-b')).toBe(true);
  });
  it('même org : autorisé', () => {
    expect(resolveOrgWriteAccess('admin', 'org-a', 'org-a')).toBe(true);
  });
  it('org cible différente : refusé', () => {
    expect(resolveOrgWriteAccess('admin', 'org-a', 'org-b')).toBe(false);
  });
  it('org cible ou org active manquante : refusé (non super_admin)', () => {
    expect(resolveOrgWriteAccess('client', 'org-a', null)).toBe(false);
    expect(resolveOrgWriteAccess('client', null, 'org-a')).toBe(false);
  });
});

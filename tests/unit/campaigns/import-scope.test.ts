import { describe, it, expect } from 'vitest';
import { resolveImportScope } from '@/lib/campaigns/import-scope';

describe('resolveImportScope', () => {
  it('super_admin : autorisé quelle que soit l’org', () => {
    expect(resolveImportScope('super_admin', null, 'org-a')).toEqual({ allowed: true });
    expect(resolveImportScope('super_admin', 'org-b', 'org-a')).toEqual({ allowed: true });
  });
  it('même org : autorisé', () => {
    expect(resolveImportScope('admin', 'org-a', 'org-a')).toEqual({ allowed: true });
  });
  it('org différente : refusé', () => {
    expect(resolveImportScope('admin', 'org-b', 'org-a')).toEqual({ allowed: false, reason: 'org_mismatch' });
  });
  it('campagne sans org (non super_admin) : refusé', () => {
    expect(resolveImportScope('admin', 'org-a', null)).toEqual({ allowed: false, reason: 'campaign_no_org' });
  });
});

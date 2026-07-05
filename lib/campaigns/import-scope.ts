/**
 * Décide si un profil peut importer de la délivrance sur une campagne EXISTANTE.
 * Pur (aucune I/O). super_admin passe partout ; sinon même org obligatoire.
 */
export function resolveImportScope(
  role: string,
  profileOrgId: string | null,
  campaignOrgId: string | null,
): { allowed: boolean; reason?: string } {
  if (role === 'super_admin') return { allowed: true };
  if (!campaignOrgId) return { allowed: false, reason: 'campaign_no_org' };
  if (campaignOrgId === profileOrgId) return { allowed: true };
  return { allowed: false, reason: 'org_mismatch' };
}

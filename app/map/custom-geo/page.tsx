'use client';

import { CustomGeoPageClient } from './CustomGeoPageClient';
import { useSession } from '@/lib/auth-client';

export default function CustomGeoPage() {
  const { session, isLoading } = useSession();
  // Bug fix : auth-client expose la session comme { user: { organizationId } },
  // pas comme { org_id } au top-level. Les anciens casts `session.org_id`
  // retournaient toujours undefined → boucle "Chargement..." infinie.
  const orgId = session?.user?.organizationId ?? '';

  // Tant que la session n'est pas resolue, on patiente
  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', fontFamily: "'Inter', sans-serif", color: 'var(--text-tertiary)', fontSize: 13 }}>
        Chargement...
      </div>
    );
  }

  // Session resolue mais pas d'organisation : afficher un message clair
  if (!orgId) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)',
        fontFamily: "'Inter', sans-serif", color: 'var(--text-secondary)', fontSize: 13,
        gap: 12, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          Aucun workspace actif
        </div>
        <div style={{ maxWidth: 380, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
          Votre compte n&apos;est rattache a aucune organisation.
          Les zones personnalisees sont scopees par workspace.
          Contactez un administrateur pour etre ajoute a un workspace.
        </div>
      </div>
    );
  }

  return <CustomGeoPageClient orgId={orgId} />;
}

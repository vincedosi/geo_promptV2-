'use client';

import { CustomGeoPageClient } from './CustomGeoPageClient';
import { useSession } from '@/lib/auth-client';

export default function CustomGeoPage() {
  const { session } = useSession();
  const orgId = (session as { org_id?: string } | null)?.org_id ?? '';

  if (!orgId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', fontFamily: "'Inter', sans-serif", color: 'var(--text-tertiary)', fontSize: 13 }}>
        Chargement...
      </div>
    );
  }

  return <CustomGeoPageClient orgId={orgId} />;
}

'use client';

import type { AdminCustomZone } from '../../_hooks/useAdminCustomZones';
import { ZonesTableRow } from './ZonesTableRow';

const fInter = "'Inter', sans-serif";

interface Props {
  zones: AdminCustomZone[];
  loading: boolean;
  hasActiveFilters: boolean;
  onDelete: (zone: AdminCustomZone) => void;
}

export function ZonesTable({ zones, loading, hasActiveFilters, onDelete }: Props) {
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 12 }}>
        Chargement...
      </div>
    );
  }

  if (zones.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 12, lineHeight: 1.6 }}>
        {hasActiveFilters
          ? 'Aucune zone ne correspond a ces filtres.'
          : 'Aucune zone personnalisee dans aucun workspace pour l\'instant.'}
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-level-2)', borderBottom: '0.5px solid var(--border-subtle)' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nom</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Workspace</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>IRIS</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>CP</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Créé le</th>
            <th style={{ padding: '10px 12px', textAlign: 'right', fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)' }}></th>
          </tr>
        </thead>
        <tbody>
          {zones.map(z => (
            <ZonesTableRow key={z.id} zone={z} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import type { AdminCustomZone } from '../../_hooks/useAdminCustomZones';

interface Props {
  zone: AdminCustomZone;
  onConfirm: () => void;
  onCancel: () => void;
  deleting?: boolean;
}

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

export function ZoneAdminDeleteDialog({ zone, onConfirm, onCancel, deleting }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 24,
        width: 460,
        maxWidth: '90vw',
      }}>
        <div style={{ fontFamily: fInter, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
          Supprimer &quot;{zone.name}&quot; ?
        </div>

        <div style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 16 }}>
          <div>Workspace : {zone.org_name ?? '—'}</div>
          <div>Source : {zone.source_type}</div>
          <div>Features : {zone.feature_count_iris.toLocaleString('fr-FR')} IRIS · {zone.feature_count_cp.toLocaleString('fr-FR')} CP</div>
        </div>

        <div style={{
          background: 'rgba(255,87,87,0.06)',
          border: '0.5px solid rgba(255,87,87,0.2)',
          borderRadius: 4,
          padding: 10,
          fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          marginBottom: 20,
        }}>
          ⚠️ Action irréversible. Les users de ce workspace ne pourront plus utiliser cette zone dans leurs analyses.
          Les campagnes qui la référencent continueront de fonctionner (l&apos;agrégation est déjà calculée).
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)',
              fontFamily: fInter, fontSize: 12,
              padding: '8px 16px', borderRadius: 4,
              cursor: deleting ? 'not-allowed' : 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              background: 'var(--danger)',
              border: 'none',
              color: '#050505',
              fontFamily: fInter, fontSize: 12, fontWeight: 500,
              padding: '8px 16px', borderRadius: 4,
              cursor: deleting ? 'not-allowed' : 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            {deleting ? 'Suppression...' : 'Supprimer definitivement'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

const fInter = "'Inter', system-ui, sans-serif";

interface Props {
  zoneName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ZoneDeleteDialog({ zoneName, onConfirm, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onConfirm(); }
    finally { setDeleting(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)', borderRadius: 10, width: 380, fontFamily: fInter }}>
        <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-subtle)', fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>
          Supprimer la zone
        </div>
        <div style={{ padding: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Supprimer <strong style={{ color: 'var(--text-primary)' }}>{zoneName}</strong> ?
          Cette action est irreversible. Les codes IRIS et CP resolus seront aussi supprimes.
        </div>
        <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={deleting} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Annuler</button>
          <button onClick={handleDelete} disabled={deleting} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'rgba(255,87,87,0.1)', border: '0.5px solid rgba(255,87,87,0.3)', color: 'var(--danger)', cursor: deleting ? 'not-allowed' : 'pointer' }}>
            {deleting ? 'Suppression...' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

const fInter = "'Inter', system-ui, sans-serif";

interface Props {
  zoneId: string;
  currentName: string;
  currentDescription: string;
  onRename: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

export function ZoneRenameDialog({ currentName, currentDescription, onRename, onClose }: Props) {
  const [name, setName] = useState(currentName);
  const [desc, setDesc] = useState(currentDescription);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onRename(name.trim(), desc.trim()); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)', borderRadius: 10, width: 400, fontFamily: fInter }}>
        <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-subtle)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          Renommer la zone
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: fInter, fontSize: 13, outline: 'none' }} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Description..." style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: fInter, fontSize: 13, outline: 'none', resize: 'vertical' }} />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Annuler</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'var(--brand-teal)', border: 'none', color: '#050505', cursor: 'pointer', opacity: !name.trim() ? 0.5 : 1 }}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

interface OrgRef {
  id: string;
  name: string;
}

interface Props {
  value: string | null;
  onChange: (orgId: string | null) => void;
}

export function WorkspaceFilter({ value, onChange }: Props) {
  const [orgs, setOrgs] = useState<OrgRef[]>([]);

  useEffect(() => {
    adminFetch('/api/admin/organizations')
      .then(r => r.ok ? r.json() : null)
      .then((data: { organizations?: OrgRef[] } | null) => {
        if (data?.organizations) setOrgs(data.organizations);
      })
      .catch(() => {});
  }, []);

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-subtle)',
        color: 'var(--text-primary)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        padding: '6px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        minWidth: 180,
      }}
    >
      <option value="">Tous les workspaces</option>
      {orgs.map(o => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

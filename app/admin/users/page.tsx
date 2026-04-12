'use client';
import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  admin: { bg: 'rgba(249,115,22,0.15)', text: '#f97316' },
  editor: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6' },
  client: { bg: 'rgba(161,161,170,0.15)', text: '#a1a1aa' },
};

interface User {
  id: string; email: string; full_name: string | null; role: string;
  organization_id: string | null; organization_name: string | null; created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch('/api/admin/users')
      .then(r => r.ok ? r.json() : [])
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 600, color: '#f0f0f0', margin: 0 }}>Users</h1>
        <span style={{ fontFamily: fMono, fontSize: 12, color: '#8a8a8a' }}>{users.length} users</span>
      </div>

      {loading ? (
        <div style={{ fontFamily: fInter, fontSize: 13, color: '#8a8a8a', padding: 20 }}>Chargement...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Nom', 'Email', 'Organisation', 'Role', 'Cree le'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#4ecdc4', borderBottom: '0.5px solid #1a1a1a', position: 'sticky', top: 0, background: '#050505' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const rc = ROLE_COLORS[u.role] ?? ROLE_COLORS.client;
              return (
                <tr key={u.id} style={{ borderBottom: '0.5px solid #111111' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#111111'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <td style={{ padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: '#f0f0f0' }}>{u.full_name || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: fMono, fontSize: 12, color: '#b0b0b0' }}>{u.email}</td>
                  <td style={{ padding: '8px 12px', fontFamily: fInter, fontSize: 12, color: '#8a8a8a' }}>{u.organization_name || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontFamily: fInter, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: rc.bg, color: rc.text }}>{u.role}</span>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: fMono, fontSize: 11, color: '#8a8a8a' }}>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

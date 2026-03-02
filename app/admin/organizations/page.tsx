'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  created_at: string;
  member_count: number;
  source_count: number;
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newOrgName, setNewOrgName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchOrgs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/organizations');
      const data = await res.json();
      if (data.success) setOrgs(data.organizations || []);
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const handleCreate = async () => {
    if (!newOrgName.trim()) return;
    setIsCreating(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setNewOrgName('');
        fetchOrgs();
      } else {
        setError(data.error || 'Erreur creation');
      }
    } catch {
      setError('Erreur reseau');
    }
    setIsCreating(false);
  };

  return (
    <div className="genesis-content" style={{ maxWidth: 900 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / organisations</h1>
          <span className="g-badge g-badge-orange">ADMIN</span>
          <span className="g-badge">{orgs.length} orgs</span>
        </div>
        <p className="page-subtitle">Gestion des clients — isolation des donnees, partage entre organisations</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Create new org */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>+</span>
            <span className="g-card-title">Nouvelle organisation</span>
          </div>
          <div className="g-card-body">
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                className="g-input"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder='Nom du client (ex: "BMW France", "Mercedes-Benz")'
                style={{ flex: 1 }}
              />
              <button
                className="g-btn g-btn-primary"
                onClick={handleCreate}
                disabled={isCreating || !newOrgName.trim()}
                style={{ flexShrink: 0 }}
              >
                {isCreating ? <Spinner /> : 'Creer'}
              </button>
            </div>
            {error && <div className="g-alert g-alert-error" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>
              // chaque organisation a ses propres donnees isolees. Un admin peut partager des sources entre orgs.
            </div>
          </div>
        </div>

        {/* Orgs list */}
        <div className="g-card">
          <div className="g-card-header">
            <span className="g-card-title">Organisations</span>
          </div>
          <div className="g-card-body" style={{ padding: 0 }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spinner size={20} /></div>
            ) : orgs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>Aucune organisation</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Organisation', 'Slug', 'Membres', 'Sources', 'Cree le'].map((h) => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', fontWeight: 600 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr key={org.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{org.name}</div>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                        {org.slug}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="g-badge">{org.member_count}</span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="g-badge g-badge-purple">{org.source_count}</span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-dim)' }}>
                        {new Date(org.created_at).toLocaleDateString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Rights explanation */}
        <div className="g-card">
          <div className="g-card-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="g-card-title">Isolation des donnees</span>
          </div>
          <div className="g-card-body">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}><strong>Principe :</strong> Chaque organisation ne voit que ses propres donnees.</p>
              <p style={{ margin: '0 0 8px' }}>Quand un admin importe des panneaux pour <strong>BMW France</strong>, ces donnees sont taggees avec l&apos;organisation BMW. Un utilisateur <strong>Mercedes</strong> ne les verra jamais.</p>
              <p style={{ margin: 0 }}>L&apos;admin GENESIS (super_admin) peut <strong>partager</strong> une source entre organisations depuis la page <em>Sources</em>.</p>
            </div>
            <div className="g-code" style={{ marginTop: 10, fontSize: 11 }}>
              <div style={{ color: 'var(--text-dim)' }}>// roles</div>
              <div><span style={{ color: 'var(--accent)' }}>super_admin</span> : voit tout, gere tout</div>
              <div><span style={{ color: 'var(--green)' }}>admin</span> : gere son organisation</div>
              <div><span style={{ color: 'var(--orange)' }}>client</span> : lecture seule, son org uniquement</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

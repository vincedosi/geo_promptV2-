'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import type { Organization } from '@/types/admin';

const C = {
  bg:          '#050505',
  bgElevated:  '#0a0a0a',
  bgSurface:   '#111111',
  border:      '#1a1a1a',
  borderLight: 'rgba(78,205,196,0.2)',
  accent:      '#4ecdc4',
  accentDim:   'rgba(78,205,196,0.08)',
  text:        '#f0f0f0',
  textDim:     '#a0a0a0',
  textSec:     '#666666',
  muted:       '#505050',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.12)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.1)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.1)',
  blue:        '#3b82f6',
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newOrgName, setNewOrgName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchOrgs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/organizations');
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { setError(`HTTP ${res.status} — réponse non-JSON`); setIsLoading(false); return; }
      if (data.success) setOrgs((data.organizations as typeof orgs) || []);
      else setError(`${res.status} — ${data.error ?? 'Erreur inconnue'}`);
    } catch (e) { setError(String(e)); }
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
    <div style={{ maxWidth: 900, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: C.text, margin: 0 }}>
            Organisations
          </h1>
          <span style={{
            fontFamily: fontInter, fontSize: 11,
            color: C.textSec, background: '#181818', border: `1px solid #262626`, borderRadius: 2,
            padding: '2px 6px',
          }}>
            {orgs.length}
          </span>
        </div>
        <p style={{ fontFamily: fontInter, fontSize: 12, color: C.textDim, margin: 0, lineHeight: 1.5 }}>
          Gestion des clients — isolation des donnees, partage entre organisations
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Create new org */}
        <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
            <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>Nouvelle organisation</span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder='Nom du client (ex: "BMW France", "Mercedes-Benz")'
                style={{
                  flex: 1,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 2,
                  padding: '8px 12px',
                  color: C.text,
                  fontFamily: fontMono,
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleCreate}
                disabled={isCreating || !newOrgName.trim()}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  background: isCreating || !newOrgName.trim() ? C.muted : C.accent,
                  border: 'none',
                  borderRadius: 2,
                  color: '#050505',
                  fontFamily: fontInter,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: isCreating || !newOrgName.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isCreating ? <Spinner /> : 'Creer'}
              </button>
            </div>
            {error && (
              <div style={{
                marginTop: 8,
                padding: '8px 12px',
                background: C.redDim,
                border: `1px solid ${C.red}`,
                borderRadius: 2,
                fontSize: 11,
                color: C.red,
                fontFamily: fontMono,
              }}>
                ! {error}
              </div>
            )}
            <div style={{ fontSize: 11, color: C.textSec, marginTop: 8, fontFamily: fontMono }}>
              // chaque organisation a ses propres donnees isolees. Un admin peut partager des sources entre orgs.
            </div>
          </div>
        </div>

        {/* Orgs list */}
        <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
            <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>Organisations</span>
          </div>
          <div style={{ padding: 0 }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.textDim }}><Spinner size={20} /></div>
            ) : orgs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>
                Aucune organisation
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Organisation', 'Slug', 'Membres', 'Sources', 'Créé le'].map((h) => (
                      <th key={h} style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontFamily: fontInter,
                        fontSize: 11,
                        color: C.textDim,
                        fontWeight: 400,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr
                      key={org.id}
                      onClick={() => router.push(`/admin/organizations/${org.id}`)}
                      style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.bgSurface)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.accent, fontFamily: fontInter }}>{org.name}</div>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 11, fontFamily: fontMono, color: C.textDim }}>
                        {org.slug}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{
                          fontFamily: fontMono, fontSize: 11,
                          color: C.textDim, background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2,
                          padding: '2px 6px',
                        }}>
                          {org.member_count}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{
                          fontFamily: fontMono, fontSize: 11,
                          color: C.accent, background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2,
                          padding: '2px 6px',
                        }}>
                          {org.source_count}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 11, color: C.textDim, fontFamily: fontMono }}>
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
        <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>
              Isolation des données
            </span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6, fontFamily: fontInter }}>
              <p style={{ margin: '0 0 8px' }}><strong style={{ color: C.text }}>Principe :</strong> Chaque organisation ne voit que ses propres donnees.</p>
              <p style={{ margin: '0 0 8px' }}>Quand un admin importe des panneaux pour <strong style={{ color: C.text }}>BMW France</strong>, ces donnees sont taggees avec l&apos;organisation BMW. Un utilisateur <strong style={{ color: C.text }}>Mercedes</strong> ne les verra jamais.</p>
              <p style={{ margin: 0 }}>L&apos;admin GENESIS (super_admin) peut <strong style={{ color: C.text }}>partager</strong> une source entre organisations depuis la page <em>Sources</em>.</p>
            </div>
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: C.bgSurface,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              fontFamily: fontMono,
              fontSize: 11,
              lineHeight: 1.8,
            }}>
              <div style={{ color: C.textDim }}>// roles</div>
              <div><span style={{ color: C.accent }}>super_admin</span> <span style={{ color: C.textSec }}>:</span> voit tout, gere tout</div>
              <div><span style={{ color: C.green }}>admin</span> <span style={{ color: C.textSec }}>:</span> gere son organisation</div>
              <div><span style={{ color: C.warn }}>client</span> <span style={{ color: C.textSec }}>:</span> lecture seule, son org uniquement</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

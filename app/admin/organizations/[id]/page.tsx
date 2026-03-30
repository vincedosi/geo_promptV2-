'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

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
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

interface Member { id: string; email: string; full_name: string | null; role: string; created_at: string; }
interface Source { id: string; name: string; type: string; row_count: number; import_date: string; status: string; shared_with?: string[]; }
interface AvailableSource { id: string; name: string; type: string; row_count: number; import_date: string; organization_id: string; shared_with?: string[]; organizations?: { name: string; slug: string } | null; }
interface Org {
  id: string; name: string; slug: string; description: string | null;
  config: Record<string, unknown>; created_at: string; active: boolean;
}
interface SystemStats {
  iris:      { total: number; enrichis: number };
  transport: { total: number; bus: number; train: number; tram: number; metro: number; flux: number };
}

const ROLES = ['client', 'admin', 'super_admin'];

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2,
  padding: '8px 12px', color: C.text, fontFamily: fontMono, fontSize: 12, outline: 'none', boxSizing: 'border-box',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, marginBottom: 16 }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, flexShrink: 0 }} />
        <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>{title}</span>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = role === 'super_admin' ? C.warn : role === 'admin' ? C.green : C.textDim;
  const bg    = role === 'super_admin' ? C.warnDim : role === 'admin' ? C.greenDim : C.bgSurface;
  const bd    = role === 'super_admin' ? C.warn : role === 'admin' ? C.green : C.border;
  return (
    <span style={{ fontFamily: fontMono, fontSize: 10, color, background: bg, border: `1px solid ${bd}`, borderRadius: 2, padding: '2px 6px' }}>
      {role}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const color = type === 'panneaux' ? C.accent : type === 'poi' ? C.green : C.warn;
  const bg    = type === 'panneaux' ? C.accentDim : type === 'poi' ? C.greenDim : C.warnDim;
  const bd    = type === 'panneaux' ? C.borderLight : type === 'poi' ? C.green : C.warn;
  return (
    <span style={{ fontFamily: fontMono, fontSize: 10, color, background: bg, border: `1px solid ${bd}`, borderRadius: 2, padding: '2px 6px' }}>
      {type}
    </span>
  );
}

function BtnSmall({ onClick, color = C.accent, children, disabled }: { onClick: () => void; color?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: 'none', border: `1px solid ${color}`, borderRadius: 2, color, fontFamily: fontInter,
      fontSize: 11, padding: '3px 8px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
  );
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [org, setOrg]               = useState<Org | null>(null);
  const [members, setMembers]         = useState<Member[]>([]);
  const [sources, setSources]         = useState<Source[]>([]);
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading]     = useState(true);

  // Config
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [siteCentricUrl, setSiteCentricUrl] = useState('');
  const [siteCentricKey, setSiteCentricKey] = useState('');
  const [maxPoi, setMaxPoi]           = useState('');
  const [maxAi, setMaxAi]             = useState('');
  const [active, setActive]           = useState(true);
  const [isSaving, setIsSaving]       = useState(false);
  const [saved, setSaved]             = useState(false);
  const [configError, setConfigError] = useState('');
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Membres
  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviteRole, setInviteRole]     = useState('client');
  const [isInviting, setIsInviting]     = useState(false);
  const [inviteError, setInviteError]   = useState('');
  const [inviteOk, setInviteOk]         = useState(false);
  const [memberAction, setMemberAction] = useState<string | null>(null);
  const [resetLink, setResetLink]       = useState<{ email: string; link: string | null } | null>(null);
  const [resetAction, setResetAction]   = useState<string | null>(null);

  // Sources
  const [editSourceId, setEditSourceId]     = useState<string | null>(null);
  const [editSourceName, setEditSourceName] = useState('');
  const [sourceAction, setSourceAction]     = useState<string | null>(null);
  const [assignAction, setAssignAction]     = useState<string | null>(null);

  const fetchSystemStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/sources-stats');
      if (!res.ok) { console.error('[fetchSystemStats] HTTP', res.status); return; }
      const data = await res.json();
      if (data.success) {
        setSystemStats({
          iris:      data.iris,
          transport: { ...data.transport, flux: data.flux.total },
        });
      } else {
        console.error('[fetchSystemStats] error:', data.error);
      }
    } catch (e) { console.error('[fetchSystemStats] exception:', e); }
  }, []);

  const fetchOrg = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/organizations/${id}`);
      const data = await res.json();
      if (data.success) {
        setOrg(data.organization);
        setMembers(data.members);
        setSources(data.sources);
        setAvailableSources(data.available_sources ?? []);
        setName(data.organization.name);
        setDescription(data.organization.description ?? '');
        setSiteCentricUrl(data.organization.config?.site_centric_url as string ?? '');
        setSiteCentricKey(data.organization.config?.site_centric_key as string ?? '');
        setMaxPoi(data.organization.config?.max_poi != null ? String(data.organization.config.max_poi) : '');
        setMaxAi(data.organization.config?.max_ai_requests != null ? String(data.organization.config.max_ai_requests) : '');
        setActive(data.organization.active !== false);
      }
    } catch { /* ignore */ }
    setIsLoading(false);
  }, [id]);

  useEffect(() => { fetchOrg(); fetchSystemStats(); }, [fetchOrg, fetchSystemStats]);

  // ── Sauvegarder config ──────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setIsSaving(true); setConfigError('');
    try {
      const res = await adminFetch(`/api/admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          config: {
            ...(org?.config ?? {}),
            site_centric_url: siteCentricUrl.trim() || null,
            site_centric_key: siteCentricKey.trim() || null,
            max_poi: maxPoi.trim() ? parseInt(maxPoi) : null,
            max_ai_requests: maxAi.trim() ? parseInt(maxAi) : null,
          },
        }),
      });
      const data = await res.json();
      if (data.success) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
      else setConfigError(data.error || 'Erreur');
    } catch { setConfigError('Erreur réseau'); }
    setIsSaving(false);
  };

  // ── Activer / Désactiver workspace ─────────────────────────────────────────
  const handleToggleActive = async () => {
    setIsTogglingActive(true);
    const newActive = !active;
    try {
      const res = await adminFetch(`/api/admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      });
      const data = await res.json();
      if (data.success) setActive(newActive);
    } catch { /* ignore */ }
    setIsTogglingActive(false);
  };

  // ── Reset password membre ───────────────────────────────────────────────────
  const handleResetPassword = async (email: string) => {
    setResetAction(email);
    setResetLink(null);
    try {
      const res = await adminFetch(`/api/admin/organizations/${id}/members/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) setResetLink({ email, link: data.link });
    } catch { /* ignore */ }
    setResetAction(null);
  };

  // ── Inviter un membre ───────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setIsInviting(true); setInviteError(''); setInviteOk(false);
    try {
      const res = await adminFetch(`/api/admin/organizations/${id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (data.success) { setInviteOk(true); setInviteEmail(''); fetchOrg(); }
      else setInviteError(data.error || 'Erreur');
    } catch { setInviteError('Erreur réseau'); }
    setIsInviting(false);
  };

  // ── Changer rôle membre ─────────────────────────────────────────────────────
  const handleChangeRole = async (userId: string, role: string) => {
    setMemberAction(userId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      fetchOrg();
    } catch { /* ignore */ }
    setMemberAction(null);
  };

  // ── Retirer un membre ───────────────────────────────────────────────────────
  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Retirer ce membre du workspace ?')) return;
    setMemberAction(userId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      fetchOrg();
    } catch { /* ignore */ }
    setMemberAction(null);
  };

  // ── Renommer source ─────────────────────────────────────────────────────────
  const handleRenameSource = async (sourceId: string) => {
    setSourceAction(sourceId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/sources`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, name: editSourceName.trim() }),
      });
      setEditSourceId(null);
      fetchOrg();
    } catch { /* ignore */ }
    setSourceAction(null);
  };

  // ── Assigner source ─────────────────────────────────────────────────────────
  const handleAssignSource = async (sourceId: string) => {
    setAssignAction(sourceId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/sources/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      fetchOrg();
    } catch { /* ignore */ }
    setAssignAction(null);
  };

  // ── Révoquer source ─────────────────────────────────────────────────────────
  const handleRevokeSource = async (sourceId: string) => {
    setAssignAction(sourceId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/sources/assign`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      fetchOrg();
    } catch { /* ignore */ }
    setAssignAction(null);
  };

  // ── Supprimer source ────────────────────────────────────────────────────────
  const handleDeleteSource = async (sourceId: string, sourceName: string) => {
    if (!confirm(`Supprimer la source "${sourceName}" ?`)) return;
    setSourceAction(sourceId);
    try {
      await adminFetch(`/api/admin/organizations/${id}/sources`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      fetchOrg();
    } catch { /* ignore */ }
    setSourceAction(null);
  };

  if (isLoading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: fontMono }}>
      chargement...
    </div>
  );

  if (!org) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.red, fontFamily: fontMono }}>
      ! organisation introuvable
    </div>
  );

  return (
    <div style={{ maxWidth: 900, padding: '24px 20px', fontFamily: fontInter, color: C.text, background: C.bg, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <button onClick={() => router.push('/admin/organizations')} style={{ background: 'none', border: 'none', color: C.textDim, fontFamily: fontMono, fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
          ← organisations
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: active ? C.text : C.textSec, margin: 0 }}>{org.name}</h1>
          <span style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim }}>{org.slug}</span>
          {!active && <span style={{ fontFamily: fontMono, fontSize: 10, color: C.red, background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 2, padding: '2px 6px' }}>désactivé</span>}
          <button onClick={handleToggleActive} disabled={isTogglingActive} style={{
            marginLeft: 'auto', padding: '5px 14px', borderRadius: 2, border: `1px solid ${active ? C.red : C.green}`,
            background: 'none', color: active ? C.red : C.green, fontFamily: fontInter, fontSize: 12,
            cursor: 'pointer', opacity: isTogglingActive ? 0.5 : 1,
          }}>
            {active ? 'Désactiver workspace' : 'Réactiver workspace'}
          </button>
        </div>
        <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 6 }}>id: {org.id}</div>
      </div>

      {/* ── Config ── */}
      <Section title="Configuration workspace">
        <Field label="Nom">
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Description courte du client..." />
        </Field>
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Quota POI max (vide = illimité)">
            <input style={{ ...inputStyle, width: 'auto' }} type="number" min="0" value={maxPoi} onChange={e => setMaxPoi(e.target.value)} placeholder="ex: 500000" />
          </Field>
          <Field label="Quota requêtes AI max / mois (vide = illimité)">
            <input style={{ ...inputStyle, width: 'auto' }} type="number" min="0" value={maxAi} onChange={e => setMaxAi(e.target.value)} placeholder="ex: 1000" />
          </Field>
        </div>
      </Section>

      {/* ── Site Centric ── */}
      <Section title="Intégration Site Centric">
        <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginBottom: 14, lineHeight: 1.6 }}>
          // Endpoint API Site Centric isolé pour ce workspace. Les données ne sont jamais partagées entre organisations.
        </div>
        <Field label="URL endpoint API">
          <input style={inputStyle} value={siteCentricUrl} onChange={e => setSiteCentricUrl(e.target.value)} placeholder="https://api.sitecentric.fr/v2/..." />
        </Field>
        <Field label="Clé API (optionnel)">
          <input style={{ ...inputStyle }} type="password" value={siteCentricKey} onChange={e => setSiteCentricKey(e.target.value)} placeholder="sk_..." />
        </Field>
      </Section>

      {/* ── Bouton save ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={handleSaveConfig} disabled={isSaving} style={{
          padding: '8px 20px', background: saved ? C.green : C.accent, border: 'none', borderRadius: 2,
          color: '#000', fontFamily: fontInter, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
          cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 700,
        }}>
          {isSaving ? 'Sauvegarde...' : saved ? '✓ Sauvegardé' : 'Sauvegarder'}
        </button>
        {configError && <span style={{ fontFamily: fontMono, fontSize: 11, color: C.red }}>! {configError}</span>}
      </div>

      {/* ── Membres ── */}
      <Section title={`Membres (${members.length})`}>

        {/* Inviter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>Email</div>
            <input
              style={inputStyle}
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              placeholder="email@client.fr"
            />
          </div>
          <div style={{ width: 130 }}>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>Rôle</div>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
              <option value="client">client</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()} style={{
            padding: '8px 16px', background: C.accent, border: 'none', borderRadius: 2, color: '#000',
            fontFamily: fontInter, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: isInviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer', fontWeight: 700, flexShrink: 0,
            opacity: isInviting || !inviteEmail.trim() ? 0.5 : 1,
          }}>
            Ajouter
          </button>
        </div>

        {inviteError && <div style={{ fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10 }}>! {inviteError}</div>}
        {inviteOk    && <div style={{ fontFamily: fontMono, fontSize: 11, color: C.green, marginBottom: 10 }}>✓ Membre ajouté</div>}

        {resetLink && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: C.greenDim, border: `1px solid ${C.green}`, borderRadius: 2 }}>
            <div style={{ fontFamily: fontInter, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.green, marginBottom: 6 }}>
              Lien reset password — {resetLink.email}
            </div>
            {resetLink.link ? (
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.text, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {resetLink.link}
              </div>
            ) : (
              <div style={{ fontFamily: fontMono, fontSize: 11, color: C.green }}>✓ Email de reset envoyé</div>
            )}
            <button onClick={() => setResetLink(null)} style={{ marginTop: 8, background: 'none', border: 'none', color: C.textDim, fontFamily: fontMono, fontSize: 10, cursor: 'pointer', padding: 0 }}>fermer</button>
          </div>
        )}

        {members.length === 0 ? (
          <div style={{ fontFamily: fontMono, fontSize: 12, color: C.textDim }}>Aucun membre</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Email / Nom', 'Rôle', 'Modifier', 'Depuis', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400, padding: '0 8px 10px 0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <div style={{ fontFamily: fontMono, fontSize: 12, color: C.text }}>{m.email}</div>
                    {m.full_name && <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginTop: 2 }}>{m.full_name}</div>}
                  </td>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <RoleBadge role={m.role} />
                  </td>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <select
                      value={m.role}
                      disabled={memberAction === m.id}
                      onChange={e => handleChangeRole(m.id, e.target.value)}
                      style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, color: C.text, fontFamily: fontMono, fontSize: 11, padding: '3px 6px', cursor: 'pointer' }}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>{new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <BtnSmall onClick={() => handleResetPassword(m.email)} color={C.warn} disabled={resetAction === m.email}>
                        Reset mdp
                      </BtnSmall>
                      <BtnSmall onClick={() => handleRemoveMember(m.id)} color={C.red} disabled={memberAction === m.id}>
                        Retirer
                      </BtnSmall>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Sources propres ── */}
      <Section title={`Sources de données (${sources.length + (systemStats ? 2 : 0)})`}>

        {/* Données Système */}
        {systemStats && (
          <>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 8 }}>Données Système</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
              <thead>
                <tr>
                  {['Nom', 'Type', 'Lignes', 'Source'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400, padding: '0 8px 10px 0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontSize: 12, color: C.text }}>IRIS — Contours géographiques INSEE</span>
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginTop: 2 }}>{systemStats.iris.enrichis.toLocaleString('fr-FR')} zones enrichies (population)</div>
                  </td>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontFamily: fontInter, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 2, padding: '2px 6px' }}>SYSTÈME</span>
                  </td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 12, color: '#06b6d4' }}>{systemStats.iris.total.toLocaleString('fr-FR')}</td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 10, color: C.textSec }}>table: iris</td>
                </tr>
                <tr style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontSize: 12, color: C.text }}>Transport & Flux routier</span>
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginTop: 2 }}>
                      {systemStats.transport.bus.toLocaleString('fr-FR')} bus · {systemStats.transport.train.toLocaleString('fr-FR')} train · {systemStats.transport.tram.toLocaleString('fr-FR')} tram · {systemStats.transport.flux.toLocaleString('fr-FR')} flux routiers
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontFamily: fontInter, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 2, padding: '2px 6px' }}>SYSTÈME</span>
                  </td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 12, color: '#22c55e' }}>{(systemStats.transport.total + systemStats.transport.flux).toLocaleString('fr-FR')}</td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 10, color: C.textSec }}>tables: poi_france + comptages_routiers</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim, marginBottom: 8 }}>Sources Importées</div>
          </>
        )}

        {sources.length === 0 ? (
          <div style={{ fontFamily: fontMono, fontSize: 12, color: C.textDim }}>Aucune source importée pour ce workspace</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nom', 'Type', 'Lignes', 'Importé le', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400, padding: '0 8px 10px 0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    {editSourceId === s.id ? (
                      <input
                        style={{ ...inputStyle, width: 200 }}
                        value={editSourceName}
                        onChange={e => setEditSourceName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleRenameSource(s.id)}
                        autoFocus
                      />
                    ) : (
                      <span style={{ fontSize: 12, color: C.text }}>{s.name}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <TypeBadge type={s.type} />
                  </td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 12, color: C.textDim }}>{(s.row_count ?? 0).toLocaleString('fr-FR')}</td>
                  <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>{s.import_date ? new Date(s.import_date).toLocaleDateString('fr-FR') : '—'}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {editSourceId === s.id ? (
                        <>
                          <BtnSmall onClick={() => handleRenameSource(s.id)} color={C.green} disabled={sourceAction === s.id}>✓</BtnSmall>
                          <BtnSmall onClick={() => setEditSourceId(null)} color={C.textDim}>✕</BtnSmall>
                        </>
                      ) : (
                        <>
                          <BtnSmall onClick={() => { setEditSourceId(s.id); setEditSourceName(s.name); }} disabled={sourceAction === s.id}>
                            Renommer
                          </BtnSmall>
                          <BtnSmall onClick={() => handleDeleteSource(s.id, s.name)} color={C.red} disabled={sourceAction === s.id}>
                            Supprimer
                          </BtnSmall>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Sources disponibles (partage) ── */}
      <Section title={`Données disponibles (${availableSources.length})`}>
        <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginBottom: 14, lineHeight: 1.6 }}>
          // Sources importées dans d&apos;autres workspaces. Assigner une source donne accès en lecture à ce workspace.
        </div>
        {availableSources.length === 0 ? (
          <div style={{ fontFamily: fontMono, fontSize: 12, color: C.textDim }}>Aucune source disponible dans les autres workspaces</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nom', 'Type', 'Lignes', 'Workspace source', 'Accès', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontFamily: fontInter, fontSize: 11, color: C.textDim, fontWeight: 400, padding: '0 8px 10px 0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availableSources.map(s => {
                const isShared = Array.isArray(s.shared_with) && s.shared_with.includes(id as string);
                return (
                  <tr key={s.id} style={{ borderTop: `1px solid ${C.border}`, background: isShared ? 'rgba(61,255,160,0.03)' : 'transparent' }}>
                    <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: C.text }}>{s.name}</td>
                    <td style={{ padding: '10px 8px 10px 0' }}>
                      <TypeBadge type={s.type} />
                    </td>
                    <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 12, color: C.textDim }}>{(s.row_count ?? 0).toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '10px 8px 10px 0', fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                      {s.organizations?.name ?? '—'}
                    </td>
                    <td style={{ padding: '10px 8px 10px 0' }}>
                      {isShared ? (
                        <span style={{ fontFamily: fontInter, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.green, background: C.greenDim, border: `1px solid ${C.green}`, borderRadius: 2, padding: '2px 6px' }}>
                          Assigné
                        </span>
                      ) : (
                        <span style={{ fontFamily: fontInter, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textSec, background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: '2px 6px' }}>
                          Non assigné
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 0', textAlign: 'right' }}>
                      {isShared ? (
                        <BtnSmall onClick={() => handleRevokeSource(s.id)} color={C.red} disabled={assignAction === s.id}>
                          Révoquer
                        </BtnSmall>
                      ) : (
                        <BtnSmall onClick={() => handleAssignSource(s.id)} color={C.green} disabled={assignAction === s.id}>
                          Assigner
                        </BtnSmall>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

    </div>
  );
}

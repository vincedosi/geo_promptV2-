'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';

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
interface Org { id: string; name: string; }
interface Role { value: string; label: string; level: number; }

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('client');
  const [formOrg, setFormOrg] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const groupedUsers = useMemo(() => {
    const superAdmins = users.filter(u => u.role === 'super_admin');
    const others = users.filter(u => u.role !== 'super_admin');
    const byOrg = new Map<string, { name: string; users: User[] }>();
    for (const u of others) {
      const key = u.organization_id || '__none__';
      const name = u.organization_name || 'Sans organisation';
      if (!byOrg.has(key)) byOrg.set(key, { name, users: [] });
      byOrg.get(key)!.users.push(u);
    }
    const orgGroups = Array.from(byOrg.values()).sort((a, b) => {
      if (a.name === 'Sans organisation') return 1;
      if (b.name === 'Sans organisation') return -1;
      return a.name.localeCompare(b.name);
    });
    return { superAdmins, orgGroups };
  }, [users]);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    adminFetch('/api/admin/users').then(r => r.ok ? r.json() : []).then(setUsers).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchUsers();
    adminFetch('/api/admin/organizations').then(r => r.ok ? r.json() : null).then((d: { organizations?: Org[] } | Org[] | null) => {
      if (Array.isArray(d)) setOrgs(d);
      else if (d && Array.isArray(d.organizations)) setOrgs(d.organizations);
      else setOrgs([]);
    });
    adminFetch('/api/admin/roles').then(r => r.ok ? r.json() : []).then((d: Role[]) => setRoles(Array.isArray(d) ? d : []));
  }, [fetchUsers]);

  const openInvite = () => { setEditUser(null); setFormEmail(''); setFormName(''); setFormRole('client'); setFormOrg(''); setShowInvite(true); };
  const openEdit = (u: User) => { setEditUser(u); setFormEmail(u.email); setFormName(u.full_name || ''); setFormRole(u.role); setFormOrg(u.organization_id || ''); setShowInvite(true); };
  const closeModal = () => { setShowInvite(false); setEditUser(null); };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (editUser) {
        const res = await adminFetch(`/api/admin/users/${editUser.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: formName, role: formRole, organization_id: formOrg || null }),
        });
        if (!res.ok) { const e = await res.json(); toast.error('Erreur', e.error); return; }
        toast.success('User mis a jour');
      } else {
        const res = await adminFetch('/api/admin/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formEmail, full_name: formName, role: formRole, organization_id: formOrg || null }),
        });
        if (!res.ok) { const e = await res.json(); toast.error('Erreur', e.error); return; }
        toast.success('Invitation envoyee');
      }
      closeModal();
      fetchUsers();
    } catch { toast.error('Erreur', 'Erreur reseau'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/users/${deleteUser.id}`, { method: 'DELETE' });
      if (!res.ok) { const e = await res.json(); toast.error('Erreur', e.error); return; }
      toast.success('User supprime');
      setDeleteUser(null);
      fetchUsers();
    } catch { toast.error('Erreur', 'Erreur reseau'); }
    finally { setDeleting(false); }
  };

  const inputStyle = { width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)', outline: 'none' };

  const renderUserRow = (u: User) => {
    const rc = ROLE_COLORS[u.role] ?? ROLE_COLORS.client;
    return (
      <tr key={u.id} style={{ borderBottom: '0.5px solid var(--bg-level-2)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-level-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
        <td style={{ padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)' }}>{u.full_name || '—'}</td>
        <td style={{ padding: '8px 12px', fontFamily: fMono, fontSize: 12, color: 'var(--text-secondary)' }}>{u.email}</td>
        <td style={{ padding: '8px 12px' }}>
          <span style={{ fontFamily: fInter, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: rc.bg, color: rc.text }}>{u.role}</span>
        </td>
        <td style={{ padding: '8px 12px', fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={() => openEdit(u)} style={{ background: 'none', border: '0.5px solid var(--border-subtle)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>Editer</button>
            <button onClick={() => setDeleteUser(u)} style={{ background: 'none', border: '0.5px solid rgba(255,87,87,0.3)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: fInter, fontSize: 10, color: 'var(--danger)' }}>Supprimer</button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Users</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-tertiary)' }}>{users.length} users</span>
          <button onClick={openInvite} style={{ padding: '7px 14px', fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 6 }}>+ Invite user</button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: 20 }}>Chargement...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Nom', 'Email', 'Role', 'Cree le', ''].map(h => (
                <th key={h} style={{ textAlign: h === '' ? 'right' : 'left', padding: '8px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--brand-teal)', borderBottom: '0.5px solid var(--border-subtle)', position: 'sticky', top: 0, background: 'var(--bg-primary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedUsers.superAdmins.length > 0 && [
              <tr key="h-super">
                <td colSpan={5} style={{ padding: '14px 12px 6px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', display: 'inline-block' }} />
                    Super admins
                    <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4 }}>{groupedUsers.superAdmins.length}</span>
                  </span>
                </td>
              </tr>,
              ...groupedUsers.superAdmins.map(renderUserRow),
            ]}
            {groupedUsers.orgGroups.flatMap(group => [
              <tr key={`h-${group.name}`}>
                <td colSpan={5} style={{ padding: '14px 12px 6px', fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', display: 'inline-block' }} />
                    {group.name}
                    <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4 }}>{group.users.length}</span>
                  </span>
                </td>
              </tr>,
              ...group.users.map(renderUserRow),
            ])}
          </tbody>
        </table>
      )}

      {/* Invite / Edit modal */}
      {showInvite && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw' }}>
            <h2 style={{ fontFamily: fInter, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 16px' }}>{editUser ? 'Editer user' : 'Inviter un user'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!editUser && (
                <div>
                  <label style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Email</label>
                  <input value={formEmail} onChange={e => setFormEmail(e.target.value)} style={inputStyle} placeholder="email@example.com" />
                </div>
              )}
              <div>
                <label style={{ fontFamily: fInter, fontSize: 11, color: '#8a8a8a', display: 'block', marginBottom: 4 }}>Nom complet</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontFamily: fInter, fontSize: 11, color: '#8a8a8a', display: 'block', marginBottom: 4 }}>Organisation</label>
                <select value={formOrg} onChange={e => setFormOrg(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Aucune</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: fInter, fontSize: 11, color: '#8a8a8a', display: 'block', marginBottom: 4 }}>Role</label>
                <select value={formRole} onChange={e => setFormRole(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={closeModal} style={{ padding: '8px 16px', fontFamily: fInter, fontSize: 13, cursor: 'pointer', background: 'transparent', border: '0.5px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-tertiary)' }}>Annuler</button>
              <button onClick={handleSubmit} disabled={saving || (!editUser && !formEmail)} style={{ padding: '8px 16px', fontFamily: fInter, fontSize: 13, fontWeight: 500, cursor: saving ? 'wait' : 'pointer', background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 6, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Envoi...' : editUser ? 'Sauvegarder' : 'Inviter'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Supprimer cet utilisateur"
        message={deleteUser ? `Supprimer definitivement ${deleteUser.full_name || deleteUser.email} ? Cette action est irreversible.` : ''}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}

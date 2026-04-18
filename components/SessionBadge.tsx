'use client';

import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { useSession, useSignOut } from '@/lib/auth-client';

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

interface OrgItem { id: string; name: string; slug: string; logo_url: string | null; }

export const SessionBadge = memo(function SessionBadge() {
  const { session, isLoading } = useSession();
  const { signOut }            = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const orgRef = useRef<HTMLDivElement>(null);

  // Org switcher state
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [activeOrgName, setActiveOrgName] = useState<string>('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [orgsFetched, setOrgsFetched] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Close org dropdown on outside click
  useEffect(() => {
    if (!orgDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) setOrgDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [orgDropdownOpen]);

  // Fetch orgs on mount (once session is available)
  useEffect(() => {
    if (!session || orgsFetched) return;
    const token = session.id;
    if (!token) return;
    fetch('/api/user/organizations', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setOrgs(data.organizations ?? []);
        setActiveOrgId(data.active_org_id ?? null);
        setIsSuperAdmin(data.is_super_admin ?? false);
        const name = (data.organizations ?? []).find((o: OrgItem) => o.id === data.active_org_id)?.name;
        setActiveOrgName(name ?? (data.active_org_id ? '...' : 'Toutes'));
        setOrgsFetched(true);
      })
      .catch(() => {});
  }, [session, orgsFetched]);

  const handleSwitchOrg = useCallback(async (orgId: string | null) => {
    if (!session) return;
    setSwitching(true);
    const token = session.id;
    try {
      const res = await fetch('/api/user/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ organization_id: orgId }),
      });
      if (res.ok) {
        setActiveOrgId(orgId);
        setOrgDropdownOpen(false);
        window.location.reload();
      }
    } catch { /* ignore */ }
    finally { setSwitching(false); }
  }, [session]);

  if (!isLoading && !session) return null;

  const email = session?.user.email ?? '';
  const displayEmail = email.length > 25 ? email.slice(0, 22) + '…' : email;
  const role = session?.user.role ?? 'authenticated';
  const showOrgDropdown = orgs.length > 1 || isSuperAdmin;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', flexShrink: 0 }}>

      {/* ── Org selector (replaces logo) ─────────────────────────── */}
      <div ref={orgRef} style={{ position: 'relative' }}>
        <button
          onClick={() => { if (showOrgDropdown) setOrgDropdownOpen(o => !o); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', cursor: showOrgDropdown ? 'pointer' : 'default',
            background: orgDropdownOpen ? 'var(--bg-level-2)' : 'transparent',
            border: `0.5px solid ${orgDropdownOpen ? 'var(--border-default)' : 'transparent'}`,
            borderRadius: 6, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (showOrgDropdown) e.currentTarget.style.background = 'var(--bg-level-2)'; }}
          onMouseLeave={e => { if (!orgDropdownOpen) e.currentTarget.style.background = 'transparent'; }}
        >
          {/* Org initial or icon */}
          <div style={{
            width: 22, height: 22, borderRadius: 5, flexShrink: 0,
            background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: fInter, fontSize: 10, fontWeight: 700, color: 'var(--brand-teal)',
          }}>
            {activeOrgName ? activeOrgName.charAt(0).toUpperCase() : '●'}
          </div>
          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeOrgName || 'Organisation'}
          </span>
          {showOrgDropdown && (
            <span style={{ fontSize: 8, color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: orgDropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
          )}
        </button>

        {/* Org dropdown */}
        {orgDropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 8,
            padding: 4, minWidth: 200, zIndex: 20000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            animation: 'sbFadeIn 0.15s ease',
          }}>
            {isSuperAdmin && (
              <button onClick={() => handleSwitchOrg(null)} disabled={switching} style={{
                width: '100%', textAlign: 'left', padding: '7px 10px', cursor: switching ? 'wait' : 'pointer',
                background: activeOrgId === null ? 'rgba(78,205,196,0.08)' : 'transparent',
                border: 'none', borderRadius: 5, fontFamily: fInter, fontSize: 11,
                color: activeOrgId === null ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.1s',
              }}
                onMouseEnter={e => { if (activeOrgId !== null) e.currentTarget.style.background = 'var(--bg-level-3)'; }}
                onMouseLeave={e => { if (activeOrgId !== null) e.currentTarget.style.background = 'transparent'; }}
              >
                {activeOrgId === null && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--brand-teal)' }} />}
                Toutes les organisations
              </button>
            )}
            {orgs.map(org => (
              <button key={org.id} onClick={() => handleSwitchOrg(org.id)} disabled={switching} style={{
                width: '100%', textAlign: 'left', padding: '7px 10px', cursor: switching ? 'wait' : 'pointer',
                background: activeOrgId === org.id ? 'rgba(78,205,196,0.08)' : 'transparent',
                border: 'none', borderRadius: 5, fontFamily: fInter, fontSize: 11,
                color: activeOrgId === org.id ? 'var(--brand-teal)' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.1s',
              }}
                onMouseEnter={e => { if (activeOrgId !== org.id) e.currentTarget.style.background = 'var(--bg-level-3)'; }}
                onMouseLeave={e => { if (activeOrgId !== org.id) e.currentTarget.style.background = 'transparent'; }}
              >
                {activeOrgId === org.id && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--brand-teal)' }} />}
                {org.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Separator ────────────────────────────────────────────── */}
      <div style={{ width: '0.5px', height: 18, background: 'var(--border-default)', flexShrink: 0 }} />

      {/* ── User badge + menu ────────────────────────────────────── */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', cursor: 'pointer',
            background: menuOpen ? 'var(--bg-level-2)' : 'transparent',
            border: `0.5px solid ${menuOpen ? 'var(--border-default)' : 'transparent'}`,
            borderRadius: 6, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-level-2)'; }}
          onMouseLeave={e => { if (!menuOpen) e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isLoading ? 'var(--warning)' : 'var(--success)', animation: isLoading ? 'sbPulse 1s ease-in-out infinite' : 'none' }} />
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isLoading ? '…' : displayEmail}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: menuOpen ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
        </button>

        {/* User menu dropdown */}
        {menuOpen && session && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 8,
            padding: 10, width: 220, zIndex: 20000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            animation: 'sbFadeIn 0.15s ease',
          }}>
            <div style={{ padding: '4px 8px', marginBottom: 6 }}>
              <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{email}</div>
              <span style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', padding: '1px 5px', background: 'var(--bg-level-2)', borderRadius: 3, marginTop: 4, display: 'inline-block' }}>{role}</span>
            </div>
            <div style={{ height: '0.5px', background: 'var(--border-subtle)', margin: '4px 0' }} />
            <button
              onClick={async () => { setMenuOpen(false); await signOut(); }}
              style={{
                width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', transition: 'all 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(255,87,87,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
            >Deconnexion</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes sbPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sbFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { * { animation-duration: 0s !important; transition-duration: 0s !important; } }
      `}</style>
    </div>
  );
});

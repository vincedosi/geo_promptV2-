'use client';

import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { useSession, useSignOut } from '@/lib/auth-client';

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

interface OrgItem { id: string; name: string; slug: string; logo_url: string | null; }

export const SessionBadge = memo(function SessionBadge() {
  const { session, isLoading } = useSession();
  const { signOut }            = useSignOut();
  const [open, setOpen]        = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Org switcher state
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Fetch user orgs when dropdown opens
  useEffect(() => {
    if (!open || !session) return;
    const token = (session as unknown as { access_token?: string }).access_token;
    if (!token) return;
    fetch('/api/user/organizations', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setOrgs(data.organizations ?? []);
        setActiveOrgId(data.active_org_id ?? null);
        setIsSuperAdmin(data.is_super_admin ?? false);
      })
      .catch(() => {});
  }, [open, session]);

  const handleSwitchOrg = useCallback(async (orgId: string | null) => {
    if (!session) return;
    setSwitching(true);
    const token = (session as unknown as { access_token?: string }).access_token;
    try {
      const res = await fetch('/api/user/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ organization_id: orgId }),
      });
      if (res.ok) {
        setActiveOrgId(orgId);
        setOpen(false);
        // Reload to refresh all org-scoped data
        window.location.reload();
      }
    } catch { /* ignore */ }
    finally { setSwitching(false); }
  }, [session]);

  // Don't render when no session (login page, loading done)
  if (!isLoading && !session) return null;

  const email      = session?.user.email ?? '';
  const role       = session?.user.role  ?? 'authenticated';
  const displayEmail = email.length > 25 ? email.slice(0, 22) + '…' : email;
  const activeOrgName = orgs.find(o => o.id === activeOrgId)?.name ?? (activeOrgId ? activeOrgId.slice(0, 8) + '…' : 'Toutes les orgs');

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* ── Trigger ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          animation: 'sbEntrance 0.3s ease-out',
        }}
        onMouseEnter={e => { e.currentTarget.querySelectorAll<HTMLElement>('[data-hover]').forEach(el => { el.style.color = '#f0f0f0'; }); }}
        onMouseLeave={e => { e.currentTarget.querySelectorAll<HTMLElement>('[data-hover]').forEach(el => { el.style.color = el.dataset.hoverColor ?? '#a0a0a0'; }); }}
      >
        <img src="/geomatik-icon.svg" width={20} height={20} alt="" style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontWeight: 700, fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap' }}>
          <span style={{ color: '#f0f0f0' }}>GEOM</span><span style={{ color: '#4ecdc4' }}>ATIK</span>
        </span>

        <div style={{ width: '0.5px', height: 18, background: '#262626', flexShrink: 0, margin: '0 6px' }} />

        <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isLoading ? '#f7b731' : '#3dffa0', animation: isLoading ? 'sbPulse 1s ease-in-out infinite' : 'none' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span data-hover="" data-hover-color="#a0a0a0" style={{ fontFamily: fInter, fontWeight: 400, fontSize: 11, color: '#a0a0a0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', transition: 'color 0.2s ease' }}>
            {isLoading ? '…' : displayEmail}
          </span>
        </div>
      </button>

      {/* ── Dropdown ────────────────────────────────────────────────── */}
      {open && session && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8,
          padding: 12, width: 260, zIndex: 20000,
          display: 'flex', flexDirection: 'column', gap: 8,
          animation: 'sbFadeIn 0.2s ease',
        }}>
          {/* Email + role */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: fInter, fontSize: 12, color: '#b0b0b0', wordBreak: 'break-all' }}>{email}</span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: '#8a8a8a', padding: '2px 6px', background: '#111111', borderRadius: 3 }}>{role}</span>
          </div>

          <div style={{ height: '0.5px', background: '#1a1a1a' }} />

          {/* Org switcher */}
          <div>
            <span style={{ fontFamily: fInter, fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organisation</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              {/* "All orgs" for super_admin */}
              {isSuperAdmin && (
                <button onClick={() => handleSwitchOrg(null)} disabled={switching} style={{
                  width: '100%', textAlign: 'left', padding: '6px 10px', cursor: switching ? 'wait' : 'pointer',
                  background: activeOrgId === null ? 'rgba(78,205,196,0.08)' : 'transparent',
                  border: `0.5px solid ${activeOrgId === null ? 'rgba(78,205,196,0.3)' : 'transparent'}`,
                  borderRadius: 4, fontFamily: fInter, fontSize: 11,
                  color: activeOrgId === null ? '#4ecdc4' : '#8a8a8a',
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                }}>
                  {activeOrgId === null && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ecdc4', flexShrink: 0 }} />}
                  Toutes les organisations
                </button>
              )}
              {/* Org list */}
              {orgs.map(org => (
                <button key={org.id} onClick={() => handleSwitchOrg(org.id)} disabled={switching} style={{
                  width: '100%', textAlign: 'left', padding: '6px 10px', cursor: switching ? 'wait' : 'pointer',
                  background: activeOrgId === org.id ? 'rgba(78,205,196,0.08)' : 'transparent',
                  border: `0.5px solid ${activeOrgId === org.id ? 'rgba(78,205,196,0.3)' : 'transparent'}`,
                  borderRadius: 4, fontFamily: fInter, fontSize: 11,
                  color: activeOrgId === org.id ? '#4ecdc4' : '#b0b0b0',
                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { if (activeOrgId !== org.id) e.currentTarget.style.background = '#111111'; }}
                  onMouseLeave={e => { if (activeOrgId !== org.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  {activeOrgId === org.id && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ecdc4', flexShrink: 0 }} />}
                  {org.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: '0.5px', background: '#1a1a1a' }} />

          {/* Logout */}
          <button
            onClick={async () => { setOpen(false); await signOut(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fInter, fontSize: 12, color: '#8a8a8a', textAlign: 'left', padding: '4px 0', transition: 'color 0.2s ease' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ff5757'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#8a8a8a'; }}
          >Deconnexion</button>
        </div>
      )}

      <style>{`
        @keyframes sbPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes sbFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes sbEntrance { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { * { animation-duration: 0s !important; transition-duration: 0s !important; } }
      `}</style>
    </div>
  );
});

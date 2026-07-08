'use client';

/**
 * Helpers partagés entre CampaignCockpit (wizard) et CampaignOverview (aperçu KPI).
 * Tokens de design + composants de présentation réutilisés des deux côtés.
 */
import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import type { DspCampaignData } from '@/types/campaign';

// ── Design tokens ─────────────────────────────────────────────────────────────
export const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)', borderDefault: 'var(--border-default)',
  teal: 'var(--brand-teal)', tealDim: 'var(--brand-teal-10)',
  green: 'var(--success)', greenDim: 'rgba(61,255,160,0.1)',
  red: 'var(--danger)', redDim: 'rgba(255,87,87,0.08)',
  text: 'var(--text-primary)', textSec: 'var(--text-secondary)', textDim: 'var(--text-tertiary)',
};
export const fInter = "'Inter', system-ui, sans-serif";
export const fMono = "'JetBrains Mono', monospace";

export function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtNum(n: number) {
  return n.toLocaleString('fr-FR');
}

// ── Section header ────────────────────────────────────────────────────────────
export function SH({ label }: { label: string }) {
  return (
    <div style={{ background: C.elevated, borderTop: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{label}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '14px 16px',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderDefault; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: fMono, fontSize: 22, fontWeight: 500, color: color ?? C.text, marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>{sub}</div>}
    </div>
  );
}

// ── Organization ref (multi-org sharing per campaign) ───────────────────────────
type OrgRef = { id: string; name: string; slug?: string };

export function OrganizationsSection({ campaignId }: { campaignId: string }) {
  const { toast: toastApi } = useToast();
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  const [linked, setLinked] = useState<(OrgRef & { is_owner?: boolean })[]>([]);
  const [allOrgs, setAllOrgs] = useState<OrgRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchLinked = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`);
      if (res.ok) {
        const data = await res.json();
        setOwnerOrgId(data.owner_organization_id ?? null);
        setLinked(data.organizations ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchLinked(); }, [fetchLinked]);

  // Load all orgs for the "add" picker (super_admin sees all, admin sees own org).
  useEffect(() => {
    adminFetch('/api/admin/organizations')
      .then(r => r.ok ? r.json() : { organizations: [] })
      .then(d => setAllOrgs(Array.isArray(d) ? d : (d.organizations ?? [])))
      .catch(() => {});
  }, []);

  const linkedIds = new Set(linked.map(o => o.id));
  const available = allOrgs.filter(o => !linkedIds.has(o.id));

  const removeOrg = async (orgId: string) => {
    if (orgId === ownerOrgId) return;
    if (linked.length <= 1) {
      toastApi.error('Action impossible', 'Une campagne doit rester liée à au moins une organisation');
      return;
    }
    setBusy(true);
    const res = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations/${orgId}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) { toastApi.success('Organisation retirée'); fetchLinked(); }
    else { const err = await res.json().catch(() => ({})); toastApi.error('Erreur', err.error ?? `HTTP ${res.status}`); }
  };

  const addOrg = async (orgId: string) => {
    setPickerOpen(false);
    setBusy(true);
    const res = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId }),
    });
    setBusy(false);
    if (res.ok) { toastApi.success('Organisation ajoutée'); fetchLinked(); }
    else { const err = await res.json().catch(() => ({})); toastApi.error('Erreur', err.error ?? `HTTP ${res.status}`); }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <SH label="Organisations" />
      {loading ? (
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, padding: '0 14px' }}>Chargement…</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', position: 'relative', padding: '0 14px' }}>
          {linked.map(o => {
            const isOwner = o.id === ownerOrgId;
            return (
              <span key={o.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 8px', borderRadius: 4,
                fontFamily: fInter, fontSize: 11, fontWeight: 500,
                background: isOwner ? 'rgba(78,205,196,0.08)' : C.elevated,
                border: `0.5px solid ${isOwner ? C.teal + '66' : C.borderDefault}`,
                color: isOwner ? C.teal : C.textSec,
              }}>
                {o.name}
                {isOwner && <span style={{ fontSize: 9, opacity: 0.7 }}>★ propriétaire</span>}
                {!isOwner && (
                  <button
                    onClick={() => removeOrg(o.id)}
                    disabled={busy}
                    style={{
                      background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                      padding: 0, marginLeft: 2, color: C.textDim, fontSize: 13, lineHeight: 1,
                    }}
                    title="Retirer cette organisation"
                  >×</button>
                )}
              </span>
            );
          })}
          {available.length > 0 && (
            <>
              <button
                onClick={() => setPickerOpen(p => !p)}
                disabled={busy}
                style={{
                  background: 'transparent', border: `0.5px dashed ${C.borderDefault}`, borderRadius: 4,
                  padding: '3px 8px', fontFamily: fInter, fontSize: 11, color: C.textDim,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >+ Ajouter</button>
              {pickerOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 14, zIndex: 20,
                  background: C.card, border: `0.5px solid ${C.borderDefault}`, borderRadius: 4,
                  padding: 4, minWidth: 180,
                }}>
                  {available.map(o => (
                    <button
                      key={o.id}
                      onClick={() => addOrg(o.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        padding: '5px 8px', fontFamily: fInter, fontSize: 12, color: C.textSec,
                        borderRadius: 3,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.elevated; e.currentTarget.style.color = C.teal; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textSec; }}
                    >{o.name}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Override action button ─────────────────────────────────────────────────────
export function ActionButton({
  label, onClick, variant = 'neutral', disabled,
}: { label: string; onClick: () => void; variant?: 'neutral' | 'teal'; disabled?: boolean }) {
  const isTeal = variant === 'teal';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: `0.5px solid ${isTeal ? C.teal : C.borderDefault}`,
        color: isTeal ? C.teal : C.textSec,
        borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ── Stats table component ─────────────────────────────────────────────────────
export function StatsTable({
  data,
  labelHeader,
}: {
  data: { label: string; tracked_ads: number; row_count: number }[];
  labelHeader: string;
}) {
  if (data.length === 0) {
    return (
      <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: 20, textAlign: 'center' }}>
        Aucune donnée
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500, fontSize: 11, color: C.textDim, borderBottom: `0.5px solid ${C.border}` }}>
              {labelHeader}
            </th>
            <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 500, fontSize: 11, color: C.textDim, borderBottom: `0.5px solid ${C.border}` }}>
              Tracked ads
            </th>
            <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 500, fontSize: 11, color: C.textDim, borderBottom: `0.5px solid ${C.border}` }}>
              Lignes
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}` }}>
              <td style={{ padding: '8px 12px', color: C.text }}>{row.label}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: fMono, fontSize: 11, color: C.textSec }}>
                {fmtNum(row.tracked_ads)}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: fMono, fontSize: 11, color: C.textSec }}>
                {fmtNum(row.row_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Data table component ──────────────────────────────────────────────────────
export function DataTable({ rows }: { rows: DspCampaignData[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: 20, textAlign: 'center' }}>
        Aucune donnée
      </div>
    );
  }

  const columns: { key: keyof DspCampaignData; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'city', label: 'Ville' },
    { key: 'postal_code', label: 'Code postal' },
    { key: 'country', label: 'Pays' },
    { key: 'region', label: 'Région' },
    { key: 'tracked_ads', label: 'Tracked ads' },
    { key: 'code_iris', label: 'Code IRIS' },
    { key: 'code_commune', label: 'Code commune' },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  textAlign: 'left', padding: '8px 10px', fontWeight: 500, fontSize: 10,
                  color: C.textDim, borderBottom: `0.5px solid ${C.border}`, whiteSpace: 'nowrap',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}` }}>
              {columns.map((col) => {
                const val = row[col.key];
                const isNum = col.key === 'tracked_ads';
                const isIris = col.key === 'code_iris';
                return (
                  <td
                    key={col.key}
                    style={{
                      padding: '6px 10px', whiteSpace: 'nowrap',
                      fontFamily: isNum || isIris ? fMono : fInter,
                      fontSize: 11,
                      color: isIris && val ? C.green : isNum ? C.text : C.textSec,
                    }}
                  >
                    {val != null ? (isNum ? fmtNum(val as number) : String(val)) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

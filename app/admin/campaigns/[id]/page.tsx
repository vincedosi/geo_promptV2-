'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { CampaignDetail, DspCampaignData } from '@/types/campaign';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#050505', card: '#0a0a0a', elevated: '#111111',
  border: '#1a1a1a', borderDefault: '#262626',
  teal: '#4ecdc4', tealDim: 'rgba(78,205,196,0.1)',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.1)',
  red: '#ff5757', redDim: 'rgba(255,87,87,0.08)',
  text: '#f0f0f0', textSec: '#a0a0a0', textDim: '#666666',
};
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtNum(n: number) {
  return n.toLocaleString('fr-FR');
}

// ── Section header ────────────────────────────────────────────────────────────
function SH({ label }: { label: string }) {
  return (
    <div style={{ background: C.elevated, borderTop: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{label}</span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
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

// ═══════════════════════════════════════════════════════════════════════════════
export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast: toastApi } = useToast();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'pays' | 'regions' | 'departements' | 'donnees'>('pays');

  const fetchDetail = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}?page=${p}`);
      if (res.ok) {
        const data: CampaignDetail = await res.json();
        setDetail(data);
      } else {
        toastApi.error('Erreur', 'Campagne introuvable');
        router.push('/admin/campaigns');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [id, router, toastApi]);

  useEffect(() => { fetchDetail(page); }, [fetchDetail, page]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toastApi.success('Campagne supprimée');
        router.push('/admin/campaigns');
      } else {
        toastApi.error('Erreur', 'Suppression échouée');
      }
    } catch { /* ignore */ }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  if (loading && !detail) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', padding: 24 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
      </div>
    );
  }

  if (!detail) return null;

  const { campaign: camp, stats, data } = detail;

  const totalRows = data.total;
  const franceRows = stats.by_country.find((c) => c.country === 'France')?.row_count ?? 0;
  const matchedIris = stats.by_department.reduce((sum, d) => sum + d.row_count, 0);
  const pctMatched = franceRows > 0 ? Math.round((matchedIris / franceRows) * 100) : 0;
  const totalPages = Math.ceil(data.total / 50);

  // ── Tab data ──────────────────────────────────────────────────────────────
  const tabs = [
    { key: 'pays' as const, label: 'Par pays' },
    { key: 'regions' as const, label: 'Par région' },
    { key: 'departements' as const, label: 'Par département' },
    { key: 'donnees' as const, label: 'Données brutes' },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <button
            onClick={() => router.push('/admin/campaigns')}
            style={{
              background: 'transparent', border: 'none', color: C.textDim,
              fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 8,
            }}
          >
            ← Campagnes DSP
          </button>
          <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 500, color: C.text, margin: 0 }}>
            {camp.name}
          </h1>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{
              background: '#181818', border: `0.5px solid ${C.borderDefault}`,
              borderRadius: 4, padding: '2px 8px', fontSize: 10, color: C.textDim, fontFamily: fInter,
            }}>
              {camp.dsp_source}
            </span>
            <span style={{ fontFamily: fMono, fontSize: 11, color: C.textSec }}>
              {fmtDate(camp.date_start)} → {fmtDate(camp.date_end)}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          style={{
            background: C.redDim, border: `0.5px solid rgba(255,87,87,0.2)`,
            borderRadius: 6, padding: '8px 16px', fontFamily: fInter, fontSize: 12,
            color: C.red, cursor: 'pointer',
          }}
        >
          Supprimer
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Tracked ads" value={fmtNum(camp.total_tracked_ads)} />
        <StatCard label="Lignes" value={fmtNum(totalRows)} />
        <StatCard label="Pays" value={String(camp.countries?.length ?? 0)} sub={camp.countries?.join(', ')} />
        <StatCard label="Lignes France" value={fmtNum(franceRows)} />
        <StatCard
          label="IRIS matchés"
          value={`${fmtNum(matchedIris)}`}
          sub={pctMatched > 0 ? `${pctMatched}% matchés` : 'Aucun match'}
          color={matchedIris > 0 ? C.green : C.textDim}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `0.5px solid ${C.border}`, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: 'transparent', border: 'none', borderBottom: activeTab === t.key ? `2px solid ${C.teal}` : '2px solid transparent',
              padding: '8px 16px', fontFamily: fInter, fontSize: 12, fontWeight: 500,
              color: activeTab === t.key ? C.text : C.textDim, cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'pays' && (
        <StatsTable
          data={stats.by_country.map((c) => ({ label: c.country, tracked_ads: c.tracked_ads, row_count: c.row_count }))}
          labelHeader="Pays"
        />
      )}

      {activeTab === 'regions' && (
        <StatsTable
          data={stats.by_region.map((r) => ({
            label: (r as Record<string, unknown>).region as string ?? '(vide)',
            tracked_ads: r.tracked_ads,
            row_count: r.row_count,
          }))}
          labelHeader="Région"
        />
      )}

      {activeTab === 'departements' && (
        <StatsTable
          data={stats.by_department.map((d) => ({ label: d.code_dept, tracked_ads: d.tracked_ads, row_count: d.row_count }))}
          labelHeader="Département"
        />
      )}

      {activeTab === 'donnees' && (
        <>
          <DataTable rows={data.rows} />
          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  background: 'transparent', border: `0.5px solid ${C.borderDefault}`,
                  borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 12,
                  color: page <= 1 ? C.textDim : C.textSec, cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Précédent
              </button>
              <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>
                {page}/{totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  background: 'transparent', border: `0.5px solid ${C.borderDefault}`,
                  borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 12,
                  color: page >= totalPages ? C.textDim : C.textSec, cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Supprimer cette campagne ?"
        message={`La campagne "${camp.name}" et toutes ses données (${fmtNum(totalRows)} lignes) seront définitivement supprimées.`}
        confirmLabel={deleting ? 'Suppression…' : 'Supprimer'}
        variant="danger"
      />
    </div>
  );
}

// ── Stats table component ─────────────────────────────────────────────────────
function StatsTable({
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
function DataTable({ rows }: { rows: DspCampaignData[] }) {
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

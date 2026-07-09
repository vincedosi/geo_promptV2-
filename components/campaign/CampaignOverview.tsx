'use client';

/**
 * CampaignOverview — aperçu autonome d'une campagne (KPI + organisations +
 * onglets stats/données + actions de gestion). Composant AUTONOME : fetch
 * son propre détail (`/api/admin/campaigns/[id]`) et gère son propre état
 * (page, onglet actif, override de statut, confirmation de suppression).
 *
 * Utilisé :
 * - embarqué dans CampaignCockpit (view "overview", page /campaigns/[id])
 * - embarqué dans CampaignSuivi (onglet "Suivi campagne" de l'overlay MAGELIAN)
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { effectiveCampaignStatus, type StatusOverride } from '@/lib/campaigns/status';
import type { CampaignChannels } from '@/lib/campaigns/channels';
import type { CampaignDetail } from '@/types/campaign';
import { AdjustPanel } from './AdjustPanel';
import {
  C, fInter, fMono, fmtDate, fmtNum,
  StatCard, StatsTable, DataTable, OrganizationsSection, ActionButton,
} from './_shared';

type OverviewTab = 'pays' | 'regions' | 'departements' | 'donnees';

export function CampaignOverview({
  campaignId, embedded, onDeleted,
}: { campaignId: string; embedded?: boolean; onDeleted?: () => void }) {
  const id = campaignId;
  const router = useRouter();
  const { toast: toastApi } = useToast();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [overridePending, setOverridePending] = useState(false);
  const [activeTab, setActiveTab] = useState<OverviewTab>('pays');
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { strategies: [] };
        const match = (d.strategies ?? []).find(
          (s: { campaign_id: string; status?: string }) => s.campaign_id === id,
        );
        if (!cancelled) { setStrategyId(match?.id ?? null); setStrategyStatus(match?.status ?? null); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const fetchDetail = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}?page=${p}`);
      if (res.ok) {
        const data: CampaignDetail = await res.json();
        setDetail(data);
      } else {
        toastApi.error('Erreur', 'Campagne introuvable');
        router.push('/campaigns');
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
        if (onDeleted) onDeleted();
        else router.push('/campaigns');
      } else {
        toastApi.error('Erreur', 'Suppression échouée');
      }
    } catch { /* ignore */ }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  const setOverride = async (value: StatusOverride | null) => {
    setOverridePending(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_override: value }),
      });
      if (res.ok) {
        await fetchDetail(page); // recharge la campagne → badge recalculé
      } else {
        console.error('[setOverride] PATCH échoué', res.status);
        toastApi.error('Erreur', 'Mise à jour du statut échouée');
      }
    } catch (err) {
      console.error('[setOverride]', err);
      toastApi.error('Erreur', 'Mise à jour du statut échouée');
    }
    setOverridePending(false);
  };

  if (loading && !detail) {
    return (
      <div style={{ background: embedded ? 'transparent' : C.bg, minHeight: embedded ? 0 : '100vh', padding: 24 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
      </div>
    );
  }

  if (!detail) return null;

  const { campaign: camp, stats, data } = detail;
  const channels = (camp.geo_strategy as { channels?: CampaignChannels } | null | undefined)?.channels ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const status = effectiveCampaignStatus(camp, today);

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
    <div style={{ background: embedded ? 'transparent' : C.bg, minHeight: embedded ? 0 : '100vh', padding: embedded ? 0 : 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          {!embedded && (
            <button
              onClick={() => router.push('/campaigns')}
              style={{
                background: 'transparent', border: 'none', color: C.textDim,
                fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 8,
              }}
            >
              ← Campagnes DSP
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 500, color: C.text, margin: 0 }}>
              {camp.name}
            </h1>
            <CampaignStatusBadge status={status} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{
              background: 'var(--bg-level-3)', border: `0.5px solid ${C.borderDefault}`,
              borderRadius: 4, padding: '2px 8px', fontSize: 10, color: C.textDim, fontFamily: fInter,
            }}>
              {camp.dsp_source}
            </span>
            <span style={{ fontFamily: fMono, fontSize: 11, color: C.textSec }}>
              {fmtDate(camp.date_start)} → {fmtDate(camp.date_end)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {strategyId && strategyStatus === 'active' && status === 'en_cours' && (
            <ActionButton label="Ajuster" variant="teal" onClick={() => setAdjustOpen(true)} disabled={overridePending} />
          )}
          {status === 'en_cours' && (
            <>
              <ActionButton label="Mettre en pause" onClick={() => setOverride('paused')} disabled={overridePending} />
              <ActionButton label="Clôturer" onClick={() => setOverride('ended')} disabled={overridePending} />
            </>
          )}
          {status === 'en_pause' && (
            <ActionButton label="Reprendre" onClick={() => setOverride(null)} variant="teal" disabled={overridePending} />
          )}
          {camp.status_override === 'ended' && (
            <ActionButton label="Rouvrir" onClick={() => setOverride(null)} disabled={overridePending} />
          )}
          {status === 'archivee' ? (
            <ActionButton label="Désarchiver" onClick={() => setOverride(null)} disabled={overridePending} />
          ) : (
            <ActionButton label="Archiver" onClick={() => setOverride('archived')} disabled={overridePending} />
          )}
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

      {channels && (channels.dsps?.length || channels.socials?.length || channels.ad_server) && (
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, marginBottom: 16 }}>
          <span style={{ color: C.textDim }}>Canaux : </span>
          {[...(channels.dsps ?? []), ...(channels.socials ?? [])].join(', ') || '—'}
          {channels.ad_server ? ` · ad server ${channels.ad_server}` : ''}
        </div>
      )}

      {/* Organisations liées */}
      <OrganizationsSection campaignId={id} />

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

      {strategyId && (
        <AdjustPanel
          campaignId={id}
          strategyId={strategyId}
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          onApplied={() => { fetchDetail(page); }}
        />
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

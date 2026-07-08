'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { effectiveCampaignStatus, type StatusOverride } from '@/lib/campaigns/status';
import type { CampaignDetail, DspCampaignData } from '@/types/campaign';
import { FilAriane, type FilArianeStep } from '@/app/campaigns/[id]/_components/FilAriane';
import { StepCible } from '@/app/campaigns/[id]/_components/steps/StepCible';
import { StepBudget } from '@/app/campaigns/[id]/_components/steps/StepBudget';
import { StepStrategie } from '@/app/campaigns/[id]/_components/steps/StepStrategie';
import { StepLancement } from '@/app/campaigns/[id]/_components/steps/StepLancement';
import { DEFAULT_PROG_DRAFT, inferIntensity, type ProgDraft } from '@/app/campaigns/[id]/_components/steps/types';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)', borderDefault: 'var(--border-default)',
  teal: 'var(--brand-teal)', tealDim: 'var(--brand-teal-10)',
  green: 'var(--success)', greenDim: 'rgba(61,255,160,0.1)',
  red: 'var(--danger)', redDim: 'rgba(255,87,87,0.08)',
  text: 'var(--text-primary)', textSec: 'var(--text-secondary)', textDim: 'var(--text-tertiary)',
};
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

// ── Fil d'Ariane cockpit — étapes "programmer" ───────────────────────────────────
const COCKPIT_STEPS: FilArianeStep[] = [
  { key: 'cible', label: 'Cible' },
  { key: 'budget', label: 'Budget' },
  { key: 'strategie', label: 'Stratégie' },
  { key: 'lancement', label: 'Lancement' },
];
const COCKPIT_STEP_KEYS = new Set(COCKPIT_STEPS.map((s) => s.key));

type CockpitView = 'overview' | 'prog';
type ProgStepKey = 'cible' | 'budget' | 'strategie' | 'lancement';
const PROG_STEP_ORDER: ProgStepKey[] = ['cible', 'budget', 'strategie', 'lancement'];

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

// ── Organization ref (multi-org sharing per campaign) ───────────────────────────
type OrgRef = { id: string; name: string; slug?: string };

function OrganizationsSection({ campaignId }: { campaignId: string }) {
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
function ActionButton({
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

// ═══════════════════════════════════════════════════════════════════════════════
export function CampaignCockpit({ campaignId, embedded, initialView }: { campaignId: string; embedded?: boolean; initialView?: CockpitView }) {
  const id = campaignId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast: toastApi } = useToast();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [overridePending, setOverridePending] = useState(false);
  const [activeTab, setActiveTab] = useState<'pays' | 'regions' | 'departements' | 'donnees'>('pays');
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [strategyLoaded, setStrategyLoaded] = useState(false);
  const [view, setView] = useState<CockpitView>(initialView ?? 'overview');

  // Brouillon Programmer (Cible/Budget/Stratégie/Lancement) — un seul
  // objet local, préservé tant que la page n'est pas rechargée.
  const [progStep, setProgStep] = useState<ProgStepKey>('cible');
  const [draft, setDraft] = useState<ProgDraft>(DEFAULT_PROG_DRAFT);

  // Stratégie de bidding rattachée à cette campagne (si elle existe).
  const fetchStrategy = useCallback(async () => {
    try {
      const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
      const d = r.ok ? await r.json() : { strategies: [] };
      const match = (d.strategies ?? []).find(
        (s: { campaign_id: string; status?: string }) => s.campaign_id === id,
      );
      setStrategyId(match?.id ?? null);
      setStrategyStatus(match?.status ?? null);
    } catch { /* ignore */ }
    setStrategyLoaded(true);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchStrategy();
  }, [id, fetchStrategy]);

  // Préremplit les dates du brouillon depuis la campagne (une fois, si non renseignées).
  useEffect(() => {
    const camp = detail?.campaign;
    if (!camp) return;
    setDraft((prev) => (prev.startDate || prev.endDate) ? prev : {
      ...prev,
      startDate: camp.date_start ? camp.date_start.slice(0, 10) : prev.startDate,
      endDate: camp.date_end ? camp.date_end.slice(0, 10) : prev.endDate,
    });
  }, [detail]);

  // Préremplissage best-effort depuis une stratégie déjà existante (édition/re-programmation).
  const strategyPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!strategyId || strategyPrefillRef.current === strategyId) return;
    strategyPrefillRef.current = strategyId;
    (async () => {
      try {
        const r = await adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        const s = d.strategy ?? {};
        setDraft((prev) => ({
          ...prev,
          intensity: inferIntensity(s.in_zone_weights) ?? prev.intensity,
          cibles: s.zone_id ? [{ id: s.zone_id, name: s.zone_name ?? 'Zone de la stratégie', sourceType: 'custom' }] : [],
          totalBudget: s.total_budget ?? prev.totalBudget,
          forecastCpm: s.forecast_cpm ?? prev.forecastCpm,
          startDate: s.start_date ? String(s.start_date).slice(0, 10) : prev.startDate,
          endDate: s.end_date ? String(s.end_date).slice(0, 10) : prev.endDate,
          executionMode: s.execution_mode ?? prev.executionMode,
        }));
      } catch { /* best-effort */ }
    })();
  }, [strategyId]);

  const currentStepIndex = strategyId ? 4 : 0;
  const filArianeActiveKey = view === 'prog' ? progStep : '';

  // Deep-link initial : ?view=prog (pilotage/bilan supprimés → repli silencieux
  // sur overview). Appliqué une seule fois, au montage.
  const viewParamAppliedRef = useRef(false);
  useEffect(() => {
    if (viewParamAppliedRef.current || !strategyLoaded) return;
    viewParamAppliedRef.current = true;
    if (searchParams.get('view') === 'prog') setView('prog');
  }, [strategyLoaded, searchParams]);

  const handleFilArianeSelect = useCallback((key: string) => {
    if (COCKPIT_STEP_KEYS.has(key)) { setProgStep(key as ProgStepKey); setView('prog'); }
  }, []);

  const progIndex = PROG_STEP_ORDER.indexOf(progStep);
  const goProgPrev = useCallback(() => setProgStep(PROG_STEP_ORDER[Math.max(0, progIndex - 1)]), [progIndex]);
  const goProgNext = useCallback(() => setProgStep(PROG_STEP_ORDER[Math.min(PROG_STEP_ORDER.length - 1, progIndex + 1)]), [progIndex]);

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
        router.push('/campaigns');
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
      {/* Fil d'Ariane cockpit — toujours visible */}
      <div style={{ marginBottom: 20 }}>
        {view !== 'overview' && (
          <button
            onClick={() => setView('overview')}
            style={{
              background: 'transparent', border: 'none', color: C.textDim,
              fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            ← Aperçu <span style={{ color: C.textSec }}>{camp.name}</span>
          </button>
        )}
        <FilAriane
          steps={COCKPIT_STEPS}
          activeKey={filArianeActiveKey}
          currentStepIndex={currentStepIndex}
          onSelect={handleFilArianeSelect}
        />
      </div>

      {view === 'overview' && (
      <>
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
      </>
      )}

      {view === 'prog' && (
        <>
          {progStep === 'cible' && (
            <StepCible draft={draft} setDraft={setDraft} campaignId={id} onNext={goProgNext} />
          )}
          {progStep === 'budget' && (
            <StepBudget draft={draft} setDraft={setDraft} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'strategie' && (
            <StepStrategie draft={draft} setDraft={setDraft} onPrev={goProgPrev} onNext={goProgNext} />
          )}
          {progStep === 'lancement' && (
            <StepLancement
              draft={draft}
              setDraft={setDraft}
              campaignId={id}
              campaignName={camp.name}
              existingStrategyId={strategyId}
              onPrev={goProgPrev}
              onCompleted={() => { fetchStrategy(); setView('overview'); }}
            />
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

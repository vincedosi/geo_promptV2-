'use client';

/**
 * @file app/admin/sources/page.tsx — back-office gestion des Data Sources
 *
 * Orchestrateur de la page. Chaque onglet est un panneau autonome extrait
 * dans `_components/` ; les types, jetons de style et briques
 * presentationnelles vivent dans `_lib/` et `_components/ui.tsx`.
 *
 * @sections internes
 *   1. State + effets de chargement
 *   2. Handlers CRUD source (resume IA, suppression, edition, partage, filtres)
 *   3. Rendu : header, tabs, puis un panneau par onglet
 *
 * @maintainers refactor en cours (31/08/2026) — voir docs/known_tech_debt.md.
 *   Les panneaux restants a extraire sont signales dans le rendu par un
 *   commentaire JSX de la forme « ── <Nom> Panel ── ».
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { DataSource, Organization } from '@/types/admin';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { CustomZonesTab } from './_components/CustomZonesTab';
import { CustomZonesStatsCard } from './_components/CustomZonesTab/CustomZonesStatsCard';

import type { SourcesStats, TransportStats } from './_lib/types';
import { C, fontMono, fontInter, SCHEMA_FILTER_COLS } from './_lib/theme';
import {
  cardStyle, cardHeaderStyle, sectionLabelStyle, btnGhostStyle,
  btnPrimaryStyle, btnDangerStyle, inputStyle, selectStyle,
} from './_lib/styles';
import { Spinner, typeBadge, formatDate } from './_components/ui';
import { CarreauxPanel } from './_components/CarreauxPanel';
import { OohPanel } from './_components/OohPanel';
import { TransportPanel } from './_components/TransportPanel';
import { IrisPanel } from './_components/IrisPanel';
import { useIrisAdmin } from './_hooks/useIrisAdmin';
import { PoiPanel } from './_components/PoiPanel';
import { usePoiAdmin } from './_hooks/usePoiAdmin';
import { DspPanel } from './_components/DspPanel';
import { useDspImport } from './_hooks/useDspImport';

// ============================================================
// Main Component
// ============================================================

export default function SourcesPage() {
  const { toast: toastApi } = useToast();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [shareOrgId, setShareOrgId] = useState('');
  const [editName, setEditName] = useState('');
  const [editOrg, setEditOrg] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showFilterEdit, setShowFilterEdit] = useState(false);
  const [editFilterFields, setEditFilterFields] = useState<string[]>([]);
  const [availableMetaKeys, setAvailableMetaKeys] = useState<string[]>([]);
  const [isSavingFilters, setIsSavingFilters] = useState(false);
  const [isLoadingMetaKeys, setIsLoadingMetaKeys] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris' | 'transport' | 'radio' | 'dsp' | 'custom_zones'>('all');
  const [radioStats, setRadioStats] = useState<{ total_emetteurs: number; emetteurs_fm: number; emetteurs_dab: number; total_radios: number } | null>(null);

  // Etat et actions DSP : hook dedie. Recharge a chaque visite de l'onglet
  // (comportement d'origine conserve — voir la note dans useDspImport).
  const dsp = useDspImport(activeTab === 'dsp');


  // Etat et actions IRIS : hook dedie (voir la note d'I/O dans useIrisAdmin —
  // l'etat doit vivre ICI, pas dans le panneau, sinon refetch a chaque onglet).
  const iris = useIrisAdmin(activeTab === 'iris');

  // Sources stats globales
  const [sourcesStats, setSourcesStats] = useState<SourcesStats | null>(null);
  const [sourcesStatsLoading, setSourcesStatsLoading] = useState(false);

  // Etat et actions POI : hook dedie (note d'I/O dans usePoiAdmin — l'etat
  // doit vivre ICI, sinon les echantillons pagines sont perdus par onglet).
  // refreshPoiStats est volontairement silencieux : pas de setSourcesStatsLoading,
  // sinon le tableau clignoterait a chaque suppression.
  const refreshPoiStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/sources-stats');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setSourcesStats(data as SourcesStats);
    } catch { /* ignore */ }
  }, []);
  const poi = usePoiAdmin(refreshPoiStats);

  // Transport stats
  const [transportStats, setTransportStats] = useState<TransportStats | null>(null);
  const [transportLoading, setTransportLoading] = useState(false);
  const [showTransportTable, setShowTransportTable] = useState(false);

  // ============================================================
  // Fetch data
  // ============================================================

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/sources');
      const data = await res.json();
      if (data.success) setSources(data.sources || []);
      else console.error('[sources]', data.error);
    } catch (e: unknown) { console.error('[sources] fetch error:', e); }
    setIsLoading(false);
  }, []);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/organizations');
      const data = await res.json();
      if (data.success) setOrganizations(data.organizations || []);
    } catch (e: unknown) { console.error('[orgs] fetch error:', e); }
  }, []);


  const fetchSourcesStats = useCallback(async () => {
    setSourcesStatsLoading(true);
    try {
      const res = await adminFetch('/api/admin/sources-stats');
      if (!res.ok) { console.error('[sources-stats] HTTP', res.status); setSourcesStatsLoading(false); return; }
      const data = await res.json();
      if (data.success) setSourcesStats(data as SourcesStats);
      else console.error('[sources-stats]', data.error);
    } catch (e: unknown) { console.error('[sources-stats] fetch error:', e); }
    setSourcesStatsLoading(false);
  }, []);

  const fetchRadioStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/radio/stats');
      if (res.ok) { const d = await res.json(); setRadioStats(d); }
    } catch { /* ignore */ }
  }, []);

  // DSP campaigns




  useEffect(() => {
    fetchSources();
    fetchOrgs();
    fetchSourcesStats();
    fetchRadioStats();
  }, [fetchSources, fetchOrgs, fetchSourcesStats, fetchRadioStats]);

  const fetchTransportStats = useCallback(async () => {
    setTransportLoading(true);
    try {
      const res = await adminFetch('/api/admin/transport-stats');
      const data = await res.json();
      if (data.success) setTransportStats(data);
      else console.error('[transport-stats]', data.error);
    } catch (e: unknown) { console.error('[transport-stats] fetch error:', e); }
    setTransportLoading(false);
  }, []);


  useEffect(() => {
    if (activeTab === 'transport' && !transportStats && !transportLoading) fetchTransportStats();
  }, [activeTab, transportStats, transportLoading, fetchTransportStats]);
  useEffect(() => {
    if (activeTab === 'poi') fetchSourcesStats();
  }, [activeTab, fetchSourcesStats]);

  // ============================================================
  // Actions
  // ============================================================

  const handleGenerateSummary = async (sourceId: string) => {
    setIsGeneratingSummary(true);
    try {
      const res = await adminFetch(`/api/admin/sources/${sourceId}/summary`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSources((prev) => prev.map((s) => s.id === sourceId ? { ...s, ai_summary: data.summary } : s));
        if (selectedSource?.id === sourceId) {
          setSelectedSource((prev) => prev ? { ...prev, ai_summary: data.summary } : prev);
        }
      }
    } catch { /* ignore */ }
    setIsGeneratingSummary(false);
  };

  const handleDelete = async (sourceId: string) => {
    setIsDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/sources/${sourceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
        setSelectedSource(null);
        toastApi.success('Source supprimée');
      } else {
        toastApi.error('Suppression échouée', data.error ?? 'Erreur inconnue');
      }
    } catch {
      toastApi.error('Erreur réseau', 'Connexion au serveur impossible');
    }
    setIsDeleting(false);
    setDeleteConfirm(null);
  };

  const handleExport = (sourceId: string) => {
    window.open(`/api/admin/sources/${sourceId}/export`, '_blank');
  };

  const handleShare = async (sourceId: string) => {
    if (!shareOrgId) return;
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;

    const currentShared = source.shared_with || [];
    if (currentShared.includes(shareOrgId)) return;

    const newShared = [...currentShared, shareOrgId];
    try {
      const res = await adminFetch(`/api/admin/sources/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared_with: newShared }),
      });
      const data = await res.json();
      if (data.success) {
        setSources((prev) => prev.map((s) => s.id === sourceId ? { ...s, shared_with: newShared } : s));
        setShareOrgId('');
      }
    } catch { /* ignore */ }
  };

  const handleUnshare = async (sourceId: string, orgIdToRemove: string) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    const newShared = (source.shared_with || []).filter((id) => id !== orgIdToRemove);
    try {
      await adminFetch(`/api/admin/sources/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared_with: newShared }),
      });
      setSources((prev) => prev.map((s) => s.id === sourceId ? { ...s, shared_with: newShared } : s));
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async () => {
    if (!selectedSource) return;
    const updates: Record<string, string> = {};
    if (editName.trim()) updates.name = editName.trim();
    if (editOrg) updates.organization_id = editOrg;
    if (Object.keys(updates).length === 0) return;

    try {
      const res = await adminFetch(`/api/admin/sources/${selectedSource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        fetchSources();
        setShowEdit(false);
      }
    } catch { /* ignore */ }
  };

  // Fetch metadata keys for a source (to show available columns for filter editing)
  const fetchMetaKeys = async (sourceId: string) => {
    setIsLoadingMetaKeys(true);
    setAvailableMetaKeys([]);
    try {
      const res = await adminFetch(`/api/admin/sources/${sourceId}/meta-keys`);
      const data = await res.json();
      if (data.success) setAvailableMetaKeys(data.keys || []);
    } catch { /* ignore */ }
    setIsLoadingMetaKeys(false);
  };

  const handleSaveFilterFields = async () => {
    if (!selectedSource) return;
    setIsSavingFilters(true);
    try {
      const res = await adminFetch(`/api/admin/sources/${selectedSource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_fields: editFilterFields }),
      });
      const data = await res.json();
      if (data.success) {
        setSources((prev) => prev.map((s) => s.id === selectedSource.id ? { ...s, filter_fields: editFilterFields } : s));
        setSelectedSource((prev) => prev ? { ...prev, filter_fields: editFilterFields } : prev);
        setShowFilterEdit(false);
      }
    } catch { /* ignore */ }
    setIsSavingFilters(false);
  };

  // ============================================================
  // Style helpers
  // ============================================================


  // ============================================================
  // Render
  // ============================================================

  return (
    <div style={{ maxWidth: 1100, fontFamily: fontInter }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes srcFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes srcSlideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes srcScaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes srcPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes srcBarGrow {
          from { width: 0%; }
        }
        @keyframes srcCountUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20, animation: 'srcFadeIn 0.4s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: C.text, margin: 0 }}>
            Sources
          </h1>
          <span style={{
            fontFamily: fontInter, fontSize: 11, fontWeight: 500,
            color: C.warn, background: C.warnDim, border: `0.5px solid ${C.warn}44`,
            padding: '2px 8px', borderRadius: 2,
          }}>Admin</span>
          <span style={{
            fontFamily: fontInter, fontSize: 11, fontWeight: 500,
            color: C.textDim, background: C.bgSurface, border: `0.5px solid ${C.border}`,
            padding: '2px 8px', borderRadius: 2,
          }}>{sources.length} sources</span>
        </div>
        <p style={{ color: C.textDim, fontSize: 13, margin: 0, fontFamily: fontInter }}>
          Gestion des sources de donnees importees — resumé IA, suppression, partage, export
        </p>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      {(() => {
        const ss = sourcesStats;
        const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);
        const allTotal = ss ? ss.ooh.total + ss.poi.total + ss.transport.total + ss.flux.total + ss.carreaux.total + ss.iris.total : sources.length;
        const tabs: { key: typeof activeTab; label: string; color: string }[] = [
          { key: 'all',       label: `Toutes (${sourcesStatsLoading ? '…' : fmtK(allTotal)})`,              color: C.accent },
          { key: 'poi',       label: `POI (${ss ? fmtK(ss.poi.total) : '…'})`,                             color: 'var(--brand-teal)' },
          { key: 'carreaux',  label: `Carreaux (${ss ? fmtK(ss.carreaux.total) : '…'})`,                  color: C.green },
          { key: 'panneaux',  label: `OOH (${ss ? fmtK(ss.ooh.total) : '…'})`,                            color: C.warn },
          { key: 'iris',      label: `IRIS (${ss ? fmtK(ss.iris.total) : '…'})`,                           color: '#06b6d4' },
          { key: 'transport', label: `Transport & Flux (${ss ? fmtK(ss.transport.total + ss.flux.total) : '…'})`, color: '#22c55e' },
          { key: 'radio',     label: `Radio (${radioStats ? fmtK(radioStats.total_emetteurs) : '…'})`,    color: C.accent },
          { key: 'dsp',       label: `DSP (${dsp.dspCampaigns.length || '…'})`,                                color: C.warn },
          { key: 'custom_zones', label: `Zones perso`,                                                         color: 'var(--brand-teal)' },
        ];
        return (
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelectedSource(null); }}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                  color: activeTab === tab.key ? tab.color : C.textDim,
                  fontFamily: fontInter,
                  fontSize: 9,
                  fontWeight: activeTab === tab.key ? 700 : 400,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  transition: 'color 0.2s ease, border-color 0.2s ease',
                  whiteSpace: 'nowrap',
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* ── All Tab — KPI Cards ──────────────────────────────────────────────── */}
      {activeTab === 'all' && sourcesStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 20 }}>
          {[
            { label: 'Panneaux OOH', value: sourcesStats.ooh.total.toLocaleString('fr-FR'), sub: `${sourcesStats.ooh.nb_villes} villes · ${(sourcesStats.ooh.regies ?? []).length} régies`, color: C.warn, tab: 'panneaux' as const },
            { label: 'POI', value: sourcesStats.poi.total.toLocaleString('fr-FR'), sub: `lycées, CIRFA, autres`, color: 'var(--brand-teal)', tab: 'poi' as const },
            { label: 'Carreaux', value: (sourcesStats.carreaux.total / 1_000_000).toFixed(2) + 'M', sub: 'Filosofi 200m', color: C.green, tab: 'carreaux' as const },
            { label: 'IRIS', value: sourcesStats.iris.total.toLocaleString('fr-FR'), sub: `${sourcesStats.iris.enrichis.toLocaleString('fr-FR')} enrichis`, color: '#06b6d4', tab: 'iris' as const },
            { label: 'Transport & Flux', value: (sourcesStats.transport.total + sourcesStats.flux.total).toLocaleString('fr-FR'), sub: 'arrêts + routes', color: '#22c55e', tab: 'transport' as const },
            { label: 'Radio', value: radioStats ? radioStats.total_emetteurs.toLocaleString('fr-FR') : '0', sub: radioStats ? `FM ${radioStats.emetteurs_fm} · DAB+ ${radioStats.emetteurs_dab}` : 'aucun import', color: C.accent, tab: 'radio' as const },
          ].map(({ label, value, sub, color, tab }, idx) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedSource(null); }}
              style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s ease', animation: `srcFadeIn 0.4s ease-out ${0.05 * idx}s both` }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = color)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
            >
              <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 8 }}>{label}</div>
              <div style={{ fontFamily: fontMono, fontSize: 22, fontWeight: 700, color, lineHeight: 1, marginBottom: 4, animation: 'srcCountUp 0.5s ease-out' }}>{value}</div>
              <div style={{ fontFamily: fontInter, fontSize: 10, color: C.muted }}>{sub}</div>
            </button>
          ))}
          <CustomZonesStatsCard onClick={() => { setActiveTab('custom_zones'); setSelectedSource(null); }} />
        </div>
      )}

      {/* ── OOH Panel ────────────────────────────────────────────────────────── */}
      {activeTab === 'panneaux' && (
        <OohPanel sourcesStats={sourcesStats} sourcesStatsLoading={sourcesStatsLoading}/>
      )}

      {/* ── POI Panel ────────────────────────────────────────────────────────── */}
      {activeTab === 'poi' && (
        <PoiPanel poi={poi} sourcesStats={sourcesStats} sourcesStatsLoading={sourcesStatsLoading}/>
      )}

      {activeTab === 'carreaux' && (
        <CarreauxPanel stats={sourcesStats} loading={sourcesStatsLoading} />
      )}

      {/* ── IRIS Panel ──────────────────────────────────────────────────────── */}
      {activeTab === 'iris' && (
        <IrisPanel iris={iris}/>
      )}

      {/* ── Transport Panel ─────────────────────────────────────────────────── */}
      {activeTab === 'transport' && (
        <TransportPanel transportStats={transportStats} transportLoading={transportLoading} showTransportTable={showTransportTable} setShowTransportTable={setShowTransportTable} fetchTransportStats={fetchTransportStats} />
      )}

      {/* ── Sources list (onglet Toutes uniquement) ──────────────────────────── */}
      {activeTab === 'all' && (
      <div style={{ display: 'flex', gap: 16 }}>
        {/* ============================================================ */}
        {/* LEFT: Sources List */}
        {/* ============================================================ */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Données système (IRIS + Transport) — pas dans data_sources */}
          {sourcesStats && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 8 }}>Données système</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* IRIS */}
                <div
                  onClick={() => setActiveTab('iris')}
                  style={{ ...cardStyle, cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#06b6d4')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                >
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.text, flex: 1, fontFamily: fontInter }}>
                        IRIS — Contours géographiques INSEE
                      </span>
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '0.5px solid rgba(6,182,212,0.3)', padding: '2px 7px', borderRadius: 2 }}>IRIS</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: fontMono, color: C.textDim }}>
                      <span style={{ color: '#06b6d4', fontWeight: 700 }}>{sourcesStats.iris.total.toLocaleString('fr-FR')} zones</span>
                      <span>{sourcesStats.iris.enrichis.toLocaleString('fr-FR')} enrichies (population)</span>
                      <span style={{ color: C.muted }}>table: iris</span>
                    </div>
                  </div>
                </div>
                {/* Transport */}
                <div
                  onClick={() => setActiveTab('transport')}
                  style={{ ...cardStyle, cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#22c55e')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                >
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.text, flex: 1, fontFamily: fontInter }}>
                        Transport & Flux routier
                      </span>
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.3)', padding: '2px 7px', borderRadius: 2 }}>Transport</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: fontMono, color: C.textDim, flexWrap: 'wrap' }}>
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>{(sourcesStats.transport.total + sourcesStats.flux.total).toLocaleString('fr-FR')} entrées</span>
                      <span>{sourcesStats.transport.total.toLocaleString('fr-FR')} arrêts</span>
                      <span style={{ color: '#22c55e' }}>bus {sourcesStats.transport.bus.toLocaleString('fr-FR')}</span>
                      <span style={{ color: '#22c55e' }}>train {sourcesStats.transport.train.toLocaleString('fr-FR')}</span>
                      <span style={{ color: '#22c55e' }}>tram {sourcesStats.transport.tram.toLocaleString('fr-FR')}</span>
                      <span>{sourcesStats.flux.total.toLocaleString('fr-FR')} flux routiers</span>
                      <span style={{ color: C.muted }}>tables: poi_france + comptages_routiers</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Radio system data block ── */}
          {(activeTab === 'all' || activeTab === 'radio') && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, padding: '2px 8px', background: C.accentDim, border: `0.5px solid ${C.borderLight}`, borderRadius: 4, color: C.accent }}>Radio</span>
                <span style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 12, color: C.text }}>Radio — Émetteurs FM & DAB+</span>
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <span>{radioStats?.emetteurs_fm ?? 0} émetteurs FM</span>
                <span>{radioStats?.emetteurs_dab ?? 0} émetteurs DAB+</span>
                <span>{radioStats?.total_radios ?? 0} radios identifiées</span>
                <span style={{ color: C.muted }}>table: emetteurs_radio</span>
              </div>
              <a href="/admin/radio" style={{ fontSize: 11, color: C.accent, textDecoration: 'none', fontFamily: fontInter }}>
                Gérer →
              </a>
            </div>
          )}

          <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 8 }}>Sources importées</div>
          {(() => {
            const filtered = activeTab === 'all' ? sources : sources.filter((s) => s.type === activeTab);
            if (isLoading) return (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: 40, color: C.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: fontMono, fontSize: 12 }}>
                  <Spinner size={20} /> Chargement...
                </div>
              </div>
            );
            if (filtered.length === 0) return (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: 40, color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
                  Aucune source de donnees dans cet onglet.<br />
                  <span style={{ fontSize: 12, color: C.muted }}>Importez des donnees via Import Universel</span>
                </div>
              </div>
            );
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((source) => (
                  <div
                    key={source.id}
                    onClick={() => { setSelectedSource(source); setShowEdit(false); }}
                    style={{
                      ...cardStyle,
                      cursor: 'pointer',
                      borderColor: selectedSource?.id === source.id ? C.accent : C.border,
                      transition: 'all 0.2s ease',
                      background: selectedSource?.id === source.id ? 'rgba(78,205,196,0.05)' : C.bgElevated,
                    }}
                  >
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: C.text, flex: 1, fontFamily: fontInter }}>
                          {source.name}
                        </span>
                        {typeBadge(source.type, source.category, source.regie)}
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: fontMono, color: C.textDim, flexWrap: 'wrap' }}>
                        <span>{source.valid_count.toLocaleString()} lignes</span>
                        <span>{formatDate(source.import_date)}</span>
                        <span>{source.organizations?.name || '—'}</span>
                        {source.original_filename && <span>{source.original_filename}</span>}
                      </div>
                      {source.ai_summary && (
                        <div style={{ marginTop: 6, fontSize: 12, color: C.textSec, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontInter }}>
                          {source.ai_summary}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* ============================================================ */}
        {/* RIGHT: Detail Panel */}
        {/* ============================================================ */}
        {selectedSource && (
          <div style={{ width: 380, flexShrink: 0, animation: 'srcSlideIn 0.2s ease-out' }}>
            <div style={{ ...cardStyle, position: 'sticky', top: 16 }}>
              <div style={cardHeaderStyle}>
                <span style={sectionLabelStyle}>source.detail</span>
                <button
                  onClick={() => setSelectedSource(null)}
                  style={{ ...btnGhostStyle, padding: '2px 8px', marginLeft: 'auto', fontSize: 11, fontFamily: fontMono }}
                >
                  ✕
                </button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Name + type */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6, fontFamily: fontInter }}>
                    {selectedSource.name}
                  </div>
                  {typeBadge(selectedSource.type, selectedSource.category, selectedSource.regie)}
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    { label: 'Valides', value: selectedSource.valid_count.toLocaleString(), color: C.green },
                    { label: 'Total',   value: selectedSource.row_count.toLocaleString(),   color: C.text },
                    { label: 'Erreurs', value: String(selectedSource.error_count),           color: C.red },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '8px 10px', background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2 }}>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fontMono, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Info */}
                <div style={{
                  fontFamily: fontMono,
                  fontSize: 11,
                  background: C.bgSurface,
                  border: `0.5px solid ${C.border}`,
                  borderRadius: 2,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  lineHeight: 1.7,
                }}>
                  <div><span style={{ color: C.textDim }}>org: </span><span style={{ color: C.accent }}>{selectedSource.organizations?.name || '—'}</span></div>
                  <div><span style={{ color: C.textDim }}>fichier: </span><span style={{ color: C.text }}>{selectedSource.original_filename || '—'}</span></div>
                  <div><span style={{ color: C.textDim }}>format: </span><span style={{ color: C.text }}>{selectedSource.file_format || '—'}</span></div>
                  <div><span style={{ color: C.textDim }}>date: </span><span style={{ color: C.text }}>{formatDate(selectedSource.import_date)}</span></div>
                </div>

                {/* AI Summary */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={sectionLabelStyle}>// resume IA</span>
                    <button
                      onClick={() => handleGenerateSummary(selectedSource.id)}
                      disabled={isGeneratingSummary}
                      style={{ ...btnGhostStyle, marginLeft: 'auto', opacity: isGeneratingSummary ? 0.5 : 1 }}
                    >
                      {isGeneratingSummary ? <Spinner /> : null}
                      {isGeneratingSummary ? 'En cours...' : selectedSource.ai_summary ? 'Regenerer' : 'Generer'}
                    </button>
                  </div>
                  {selectedSource.ai_summary ? (
                    <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, padding: '8px 10px', background: C.bgSurface, borderRadius: 2, border: `0.5px solid ${C.border}`, fontFamily: fontInter }}>
                      {selectedSource.ai_summary}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', fontFamily: fontInter }}>Pas de resume — cliquez Generer</div>
                  )}
                </div>

                {/* Filter Fields */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={sectionLabelStyle}>// champs filtres</span>
                    <button
                      onClick={() => {
                        setShowFilterEdit(!showFilterEdit);
                        if (!showFilterEdit) {
                          setEditFilterFields(selectedSource.filter_fields || []);
                          fetchMetaKeys(selectedSource.id);
                        }
                      }}
                      style={{ ...btnGhostStyle, marginLeft: 'auto' }}
                    >
                      {showFilterEdit ? 'Fermer' : 'Modifier'}
                    </button>
                  </div>
                  {(selectedSource.filter_fields || []).length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {selectedSource.filter_fields!.map((f) => (
                        <span key={f} style={{
                          fontFamily: fontInter, fontSize: 9, fontWeight: 500,
                          color: C.green, background: C.greenDim, border: `0.5px solid ${C.green}44`,
                          padding: '2px 7px', borderRadius: 2,
                        }}>{f}</span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginBottom: 6, fontFamily: fontInter }}>Aucun filtre configure</div>
                  )}
                  {showFilterEdit && (
                    <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 2, padding: 10, marginTop: 4, background: C.bgSurface }}>
                      {/* Header: counter + quick actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, color: C.textDim, fontFamily: fontMono, flex: 1 }}>
                          {editFilterFields.length} filtre{editFilterFields.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => setEditFilterFields([...SCHEMA_FILTER_COLS, ...availableMetaKeys])}
                          style={{ ...btnGhostStyle, padding: '2px 6px', fontSize: 9 }}
                        >
                          Tout cocher
                        </button>
                        <button
                          onClick={() => setEditFilterFields([])}
                          style={{ ...btnGhostStyle, padding: '2px 6px', fontSize: 9 }}
                        >
                          Effacer
                        </button>
                      </div>

                      {/* Schema columns */}
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>
                        colonnes schema
                      </div>
                      {SCHEMA_FILTER_COLS.map((field) => {
                        const isChecked = editFilterFields.includes(field);
                        return (
                          <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 11 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => setEditFilterFields((prev) => isChecked ? prev.filter((f) => f !== field) : [...prev, field])}
                              style={{ accentColor: C.accent }}
                            />
                            <span style={{ color: isChecked ? C.accent : C.textSec, flex: 1, fontFamily: fontMono, fontSize: 11 }}>{field}</span>
                            <span style={{ fontSize: 9, color: C.muted, fontFamily: fontInter, fontWeight: 500 }}>schema</span>
                          </label>
                        );
                      })}

                      {/* Metadata keys */}
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 10, marginBottom: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                        colonnes metadata {availableMetaKeys.length > 0 ? `(${availableMetaKeys.length})` : isLoadingMetaKeys ? '...' : '(aucune)'}
                      </div>
                      {isLoadingMetaKeys ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, padding: '4px 0', fontFamily: fontMono }}>
                          <Spinner size={10} /> Chargement...
                        </div>
                      ) : availableMetaKeys.length === 0 ? (
                        <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', fontFamily: fontInter }}>Pas de cles metadata trouvees</div>
                      ) : (
                        availableMetaKeys.map((field) => {
                          const isChecked = editFilterFields.includes(field);
                          return (
                            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 11 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => setEditFilterFields((prev) => isChecked ? prev.filter((f) => f !== field) : [...prev, field])}
                                style={{ accentColor: 'var(--brand-teal)' }}
                              />
                              <span style={{ color: isChecked ? 'var(--brand-teal)' : C.textSec, flex: 1, fontFamily: fontMono }}>{field}</span>
                              <span style={{ fontSize: 9, color: C.muted, fontFamily: fontInter, fontWeight: 500 }}>meta</span>
                            </label>
                          );
                        })
                      )}

                      <button
                        onClick={handleSaveFilterFields}
                        disabled={isSavingFilters}
                        style={{ ...btnPrimaryStyle, marginTop: 12, opacity: isSavingFilters ? 0.6 : 1 }}
                      >
                        {isSavingFilters ? <><Spinner /> Sauvegarde...</> : 'Sauvegarder les filtres'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Sharing */}
                <div>
                  <div style={{ ...sectionLabelStyle, display: 'block', marginBottom: 8 }}>// partage</div>
                  {(selectedSource.shared_with || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {selectedSource.shared_with!.map((orgId) => {
                        const org = organizations.find((o) => o.id === orgId);
                        return (
                          <span key={orgId} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontFamily: fontInter, fontSize: 9, fontWeight: 500,
                            color: C.textDim, background: C.bgSurface, border: `0.5px solid ${C.border}`,
                            padding: '2px 6px', borderRadius: 2,
                          }}>
                            {org?.name || orgId.slice(0, 8)}
                            <button
                              onClick={() => handleUnshare(selectedSource.id, orgId)}
                              style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}
                            >✕</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={shareOrgId}
                      onChange={(e) => setShareOrgId(e.target.value)}
                      style={{ ...selectStyle, flex: 1, fontSize: 11 }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                    >
                      <option value="">Partager avec...</option>
                      {organizations.filter((o) => o.id !== selectedSource.organization_id && !(selectedSource.shared_with || []).includes(o.id)).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleShare(selectedSource.id)}
                      disabled={!shareOrgId}
                      style={{ ...btnGhostStyle, opacity: shareOrgId ? 1 : 0.4 }}
                    >
                      Partager
                    </button>
                  </div>
                </div>

                {/* Edit */}
                {showEdit && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <div style={{ ...sectionLabelStyle, display: 'block', marginBottom: 8 }}>// modifier</div>
                    <label style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, display: 'block', marginBottom: 4 }}>Nom</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ ...inputStyle, marginBottom: 8 }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                    />
                    <label style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, display: 'block', marginBottom: 4 }}>Organisation</label>
                    <select
                      value={editOrg}
                      onChange={(e) => setEditOrg(e.target.value)}
                      style={{ ...selectStyle, marginBottom: 10 }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                    >
                      <option value="">— Ne pas changer —</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button onClick={handleSaveEdit} style={btnPrimaryStyle}>Sauvegarder</button>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <button
                    onClick={() => handleExport(selectedSource.id)}
                    style={{ ...btnGhostStyle, width: '100%', justifyContent: 'flex-start' }}
                  >
                    Exporter CSV
                  </button>
                  <button
                    onClick={() => { setShowEdit(!showEdit); setEditName(selectedSource.name); setEditOrg(''); }}
                    style={{ ...btnGhostStyle, width: '100%', justifyContent: 'flex-start' }}
                  >
                    {showEdit ? 'Annuler modification' : 'Modifier'}
                  </button>
                  <button
                    onClick={() => window.open('/admin/import', '_self')}
                    style={{ ...btnGhostStyle, width: '100%', justifyContent: 'flex-start' }}
                  >
                    Re-importer (meme config)
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(selectedSource.id)}
                    disabled={isDeleting}
                    style={{ ...btnDangerStyle, opacity: isDeleting ? 0.6 : 1 }}
                  >
                    {isDeleting ? <><Spinner /> Suppression...</> : 'Supprimer source + donnees'}
                  </button>
                </div>

              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── DSP campaigns tab ── */}
      {activeTab === 'dsp' && (
        <DspPanel dsp={dsp}/>
      )}

      {/* ── Custom zones tab (custom_geo_zones) ── */}
      {activeTab === 'custom_zones' && <CustomZonesTab />}

      {/* ── Delete confirmation modal ── */}
      <ConfirmModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (deleteConfirm) handleDelete(deleteConfirm); }}
        title="Supprimer cette source"
        message="Cette action supprimera la source et TOUTES ses données associées. Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}

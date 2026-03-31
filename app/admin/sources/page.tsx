'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { DataSource, Organization } from '@/types/admin';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';

// ── IRIS stats types ──────────────────────────────────────────────────────────
interface IrisStats {
  total: number; nb_depts: number; nb_communes: number;
  type_h: number; type_a: number; type_d: number; type_z: number;
  with_geom: number; table_size: string; index_size: string;
}
interface IrisDept { code: string; nom: string; nb: number; }
interface IrisSource {
  name: string; edition: string; provider: string; license: string;
  format: string; coverage: string; imported_at: string; schema: string[];
}

// ── Sources stats types ───────────────────────────────────────────────────────
interface SourcesStats {
  ooh: {
    total: number; nb_villes: number; regies: string[]; sources: string[];
    types: Array<{ type: string; nb: number }>;
    top_villes: Array<{ ville: string; nb: number }>;
  };
  poi: { total: number; by_category: Array<{ categorie: string; nb: number }> };
  transport: { total: number; bus: number; train: number; tram: number; metro: number };
  flux: { total: number; cerema: number; osm: number };
  carreaux: { total: number };
  iris: { total: number; enrichis: number };
}

// Schema columns meaningful as map filters (no id/lat/lng/geom)
const SCHEMA_FILTER_COLS = ['region', 'departement', 'ville', 'code_postal', 'categorie', 'sous_categorie'];

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
  muted:       '#666666',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.10)',
  red:         '#ff5757',
  redDim:      'rgba(255,87,87,0.1)',
  warn:        '#f7b731',
  warnDim:     'rgba(247,183,49,0.1)',
  blue:        '#5b9bd5',
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ============================================================
// Helpers
// ============================================================

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function typeBadge(type: string, category?: string, regie?: string) {
  type BadgeKey = 'poi' | 'panneaux' | 'carreaux';
  const colors: Record<BadgeKey, { color: string; bg: string; border: string }> = {
    poi:      { color: C.accent, bg: C.accentDim, border: C.borderLight },
    panneaux: { color: C.warn,   bg: C.warnDim,   border: `${C.warn}44` },
    carreaux: { color: C.green,  bg: C.greenDim,  border: `${C.green}44` },
  };
  const label = type === 'poi'
    ? `POI${category ? ` — ${category}` : ''}`
    : type === 'panneaux'
      ? `OOH${regie ? ` — ${regie}` : ''}`
      : 'Carreaux INSEE';
  const style = colors[type as BadgeKey] || { color: C.textDim, bg: 'transparent', border: C.border };
  return (
    <span style={{
      fontFamily: fontInter,
      fontSize: 11,
      fontWeight: 500,
      color: style.color,
      background: style.bg,
      border: `0.5px solid ${style.border}`,
      padding: '2px 7px',
      borderRadius: 2,
      whiteSpace: 'nowrap' as const,
      transition: 'all 0.2s ease',
    }}>
      {label}
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// Main Component
// ============================================================

export default function SourcesPage() {
  const { toast } = useToast();
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
  const [activeTab, setActiveTab] = useState<'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris' | 'transport'>('all');

  // IRIS stats
  const [irisStats,   setIrisStats]   = useState<IrisStats | null>(null);
  const [irisDepts,   setIrisDepts]   = useState<IrisDept[]>([]);
  const [irisSource,  setIrisSource]  = useState<IrisSource | null>(null);
  const [irisLoading, setIrisLoading] = useState(false);

  // IRIS metadata (année)
  const [irisAnnee,        setIrisAnnee]        = useState('2025');
  const [irisAnneeSaving,  setIrisAnneeSaving]  = useState(false);
  const [irisAnneeSaved,   setIrisAnneeSaved]   = useState(false);

  // IRIS PMTiles generation
  const [irisPmtilesLoading, setIrisPmtilesLoading] = useState(false);
  const [irisPmtilesMsg,     setIrisPmtilesMsg]     = useState<string | null>(null);

  // IRIS delete
  const [irisDeleteConfirm, setIrisDeleteConfirm] = useState(false);
  const [irisDeleteLoading,  setIrisDeleteLoading]  = useState(false);
  const [irisDeleteMsg,      setIrisDeleteMsg]      = useState<string | null>(null);

  // IRIS sync report
  interface IrisSyncReport {
    synced:                boolean;
    total_iris:            number;
    db_columns:            string[];
    code_columns:          string[];
    missing_in_code:       string[];
    missing_in_db:         string[];
    fill_status:           Record<string, number>;
    rpc_status:            Record<string, string>;
    manual_actions_needed: string[];
  }
  const [irisSyncReport,   setIrisSyncReport]   = useState<IrisSyncReport | null>(null);
  const [irisSyncLoading,  setIrisSyncLoading]  = useState(false);
  const [irisSyncError,    setIrisSyncError]    = useState<string | null>(null);

  // Sigma accessibility config
  interface SigmaConfig { categorie: string; sigma_km: number; description?: string | null; }
  const [sigmaConfig,        setSigmaConfig]        = useState<SigmaConfig[] | null>(null);
  const [sigmaConfigLoading, setSigmaConfigLoading] = useState(false);

  const runIrisSync = useCallback(async () => {
    setIrisSyncLoading(true);
    setIrisSyncError(null);
    try {
      const res = await fetch('/api/admin/sync-iris-system', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      setIrisSyncReport(data as IrisSyncReport);
    } catch (e) {
      setIrisSyncError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIrisSyncLoading(false);
    }
  }, []);

  const saveIrisAnnee = useCallback(async (annee: string) => {
    setIrisAnneeSaving(true);
    await fetch('/api/admin/iris/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annee }) });
    setIrisAnneeSaving(false);
    setIrisAnneeSaved(true);
    setTimeout(() => setIrisAnneeSaved(false), 2000);
  }, []);

  const triggerIrisPmtiles = useCallback(async () => {
    setIrisPmtilesLoading(true);
    setIrisPmtilesMsg(null);
    try {
      const res = await fetch('/api/admin/trigger-pmtiles', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIrisPmtilesMsg(`✓ Workflow lancé — durée estimée 5-8 min. Suivi : ${data.workflow_url}`);
      } else {
        setIrisPmtilesMsg(`! Erreur : ${data.error}`);
      }
    } catch (e) {
      setIrisPmtilesMsg(`! Erreur réseau : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIrisPmtilesLoading(false);
    }
  }, []);

  const deleteAllIris = useCallback(async () => {
    setIrisDeleteLoading(true);
    setIrisDeleteMsg(null);
    try {
      const res = await fetch('/api/admin/iris/delete', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setIrisDeleteMsg(`✓ ${data.deleted ?? 0} IRIS supprimés`);
        setIrisStats(null);
      } else {
        setIrisDeleteMsg(`! Erreur: ${data.error}`);
      }
    } catch (e) {
      setIrisDeleteMsg(`! ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setIrisDeleteLoading(false);
      setIrisDeleteConfirm(false);
    }
  }, []);

  // Sources stats globales
  const [sourcesStats, setSourcesStats] = useState<SourcesStats | null>(null);
  const [sourcesStatsLoading, setSourcesStatsLoading] = useState(false);

  // POI detail
  const [selectedPoiCat, setSelectedPoiCat] = useState<string | null>(null);
  type PoiRow = { id: string; nom: string | null; categorie: string; sous_categorie: string | null; lat: number; lng: number; adresse: string | null; ville: string | null; departement: string | null; code_postal: string | null; source: string | null };
  const [poiSamples, setPoiSamples] = useState<PoiRow[]>([]);
  const [poiSamplesTotal, setPoiSamplesTotal] = useState(0);
  const [poiSamplesOffset, setPoiSamplesOffset] = useState(0);
  const [poiSamplesLoading, setPoiSamplesLoading] = useState(false);

  // POI modal (add/edit)
  const emptyForm = { nom: '', categorie: '', sous_categorie: '', lat: '', lng: '', adresse: '', ville: '', departement: '', code_postal: '', source: '' };
  const [poiModal, setPoiModal] = useState<{ open: boolean; mode: 'create' | 'edit'; data: typeof emptyForm & { id?: string } }>({ open: false, mode: 'create', data: emptyForm });
  const [poiModalSaving, setPoiModalSaving] = useState(false);
  const [poiModalError, setPoiModalError] = useState('');

  // Bulk delete confirmation
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const refreshPoiStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sources-stats');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setSourcesStats(data as SourcesStats);
    } catch { /* ignore */ }
  }, []);

  const fetchPoiSamples = useCallback(async (cat: string, offset = 0) => {
    setPoiSamplesLoading(true);
    try {
      const res = await adminFetch(`/api/admin/poi-samples?cat=${cat}&limit=50&offset=${offset}`);
      const data = await res.json();
      if (data.success) {
        setPoiSamples(offset === 0 ? (data.samples ?? []) : (prev) => [...prev, ...(data.samples ?? [])]);
        setPoiSamplesTotal(data.total ?? 0);
        setPoiSamplesOffset(offset + (data.samples?.length ?? 0));
      }
    } catch { /* ignore */ }
    setPoiSamplesLoading(false);
  }, []);

  const openCreatePoi = useCallback((cat: string) => {
    setPoiModal({ open: true, mode: 'create', data: { ...emptyForm, categorie: cat === 'lycee' ? 'lycee' : cat === 'cirfa' ? 'cirfa' : '' } });
    setPoiModalError('');
  }, []);

  const openEditPoi = useCallback((row: PoiRow) => {
    setPoiModal({ open: true, mode: 'edit', data: { id: row.id, nom: row.nom ?? '', categorie: row.categorie, sous_categorie: row.sous_categorie ?? '', lat: String(row.lat), lng: String(row.lng), adresse: row.adresse ?? '', ville: row.ville ?? '', departement: row.departement ?? '', code_postal: row.code_postal ?? '', source: row.source ?? '' } });
    setPoiModalError('');
  }, []);

  const savePoi = useCallback(async () => {
    setPoiModalSaving(true);
    setPoiModalError('');
    try {
      const isEdit = poiModal.mode === 'edit';
      const res = await adminFetch('/api/admin/poi-manage', { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(poiModal.data) });
      const data = await res.json();
      if (!data.success) { setPoiModalError(data.error ?? 'Erreur'); setPoiModalSaving(false); return; }
      setPoiModal({ open: false, mode: 'create', data: emptyForm });
      if (selectedPoiCat) { fetchPoiSamples(selectedPoiCat, 0); }
      refreshPoiStats();
    } catch (e) { setPoiModalError(String(e)); }
    setPoiModalSaving(false);
  }, [poiModal, selectedPoiCat, fetchPoiSamples, refreshPoiStats]);

  const deletePoi = useCallback(async (id: string) => {
    try {
      await adminFetch(`/api/admin/poi-manage?id=${id}`, { method: 'DELETE' });
      setPoiSamples((prev) => prev.filter((p) => p.id !== id));
      setPoiSamplesTotal((t) => t - 1);
      refreshPoiStats();
    } catch { /* ignore */ }
  }, [refreshPoiStats]);

  const deletePoisBulk = useCallback(async (cat: string) => {
    setBulkDeleting(true);
    try {
      await adminFetch(`/api/admin/poi-manage?cat=${cat}`, { method: 'DELETE' });
      setConfirmDeleteCat(null);
      if (selectedPoiCat === cat) { setPoiSamples([]); setPoiSamplesTotal(0); setSelectedPoiCat(null); }
      refreshPoiStats();
    } catch { /* ignore */ }
    setBulkDeleting(false);
  }, [selectedPoiCat, refreshPoiStats]);

  // Transport stats
  const [transportStats, setTransportStats] = useState<{
    arrets:   { total: number; by_source: Record<string, number> };
    flux:     { total: number; by_source: Record<string, number> };
    panneaux: { total: number; avec_transport: number; avec_flux: number };
    villes:   Array<{ ville: string; nb_panneaux: number; avec_transport: number; transport_moyen: number; avec_flux: number; flux_moyen: number; score_moyen: number }>;
  } | null>(null);
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
    } catch (e) { console.error('[sources] fetch error:', e); }
    setIsLoading(false);
  }, []);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/organizations');
      const data = await res.json();
      if (data.success) setOrganizations(data.organizations || []);
    } catch (e) { console.error('[orgs] fetch error:', e); }
  }, []);

  const fetchIrisStats = useCallback(async () => {
    setIrisLoading(true);
    try {
      const [res, metaRes] = await Promise.all([
        fetch('/api/admin/iris/stats'),
        fetch('/api/admin/iris/metadata'),
      ]);
      const data = await res.json();
      const meta = await metaRes.json();
      if (meta.annee) setIrisAnnee(meta.annee);
      if (data.success) {
        setIrisStats(data.stats);
        setIrisDepts(data.top_depts || []);
        setIrisSource(data.source || null);
      } else console.error('[iris/stats]', data.error);
    } catch (e) { console.error('[iris/stats] fetch error:', e); }
    setIrisLoading(false);
  }, []);

  const fetchSourcesStats = useCallback(async () => {
    setSourcesStatsLoading(true);
    try {
      const res = await fetch('/api/admin/sources-stats');
      if (!res.ok) { console.error('[sources-stats] HTTP', res.status); setSourcesStatsLoading(false); return; }
      const data = await res.json();
      if (data.success) setSourcesStats(data as SourcesStats);
      else console.error('[sources-stats]', data.error);
    } catch (e) { console.error('[sources-stats] fetch error:', e); }
    setSourcesStatsLoading(false);
  }, []);

  useEffect(() => {
    fetchSources();
    fetchOrgs();
    fetchSourcesStats();
  }, [fetchSources, fetchOrgs, fetchSourcesStats]);

  const fetchTransportStats = useCallback(async () => {
    setTransportLoading(true);
    try {
      const res = await fetch('/api/admin/transport-stats');
      const data = await res.json();
      if (data.success) setTransportStats(data);
      else console.error('[transport-stats]', data.error);
    } catch (e) { console.error('[transport-stats] fetch error:', e); }
    setTransportLoading(false);
  }, []);

  const fetchSigmaConfig = useCallback(async () => {
    setSigmaConfigLoading(true);
    try {
      const res = await fetch('/api/correlation/categories');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSigmaConfig(
          data
            .filter((c: any) => c.sigma_km != null)
            .map((c: any) => ({ categorie: c.key, sigma_km: c.sigma_km, description: c.label ?? null }))
        );
      }
    } catch (e) { console.error('[sigma-config] fetch error:', e); }
    setSigmaConfigLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'iris' && !irisStats && !irisLoading) fetchIrisStats();
  }, [activeTab, irisStats, irisLoading, fetchIrisStats]);

  useEffect(() => {
    if (activeTab === 'iris' && !sigmaConfig && !sigmaConfigLoading) fetchSigmaConfig();
  }, [activeTab, sigmaConfig, sigmaConfigLoading, fetchSigmaConfig]);

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
        toast('Source supprimée avec succès', 'success');
      } else {
        toast(data.error ?? 'Erreur lors de la suppression', 'error');
      }
    } catch {
      toast('Erreur réseau lors de la suppression', 'error');
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

  const cardStyle: React.CSSProperties = {
    background: C.bgElevated,
    border: `0.5px solid ${C.border}`,
    borderRadius: 2,
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  };
  const cardHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    background: C.bgSurface,
    borderLeft: '2px solid rgba(78,205,196,0.25)',
  };
  const sectionLabelStyle: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    color: C.text,
  };

  const btnGhostStyle: React.CSSProperties = {
    background: 'transparent',
    border: `0.5px solid ${C.border}`,
    borderRadius: 2,
    color: C.textDim,
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    padding: '4px 10px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    transition: 'all 0.2s ease',
  };
  const btnPrimaryStyle: React.CSSProperties = {
    background: C.accentDim,
    border: `0.5px solid ${C.borderLight}`,
    borderRadius: 2,
    color: '#050505',
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  };
  const btnDangerStyle: React.CSSProperties = {
    background: C.redDim,
    border: `0.5px solid ${C.red}44`,
    borderRadius: 2,
    color: C.red,
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    justifyContent: 'flex-start',
    transition: 'all 0.2s ease',
  };
  const inputStyle: React.CSSProperties = {
    background: C.bgSurface,
    border: `0.5px solid ${C.border}`,
    borderRadius: 2,
    color: C.text,
    fontFamily: fontMono,
    fontSize: 11,
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.3s ease',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

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
        const tabs: { key: 'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris' | 'transport'; label: string; color: string }[] = [
          { key: 'all',       label: `Toutes (${sourcesStatsLoading ? '…' : fmtK(allTotal)})`,              color: C.accent },
          { key: 'poi',       label: `POI (${ss ? fmtK(ss.poi.total) : '…'})`,                             color: '#4ecdc4' },
          { key: 'carreaux',  label: `Carreaux (${ss ? fmtK(ss.carreaux.total) : '…'})`,                  color: C.green },
          { key: 'panneaux',  label: `OOH (${ss ? fmtK(ss.ooh.total) : '…'})`,                            color: C.warn },
          { key: 'iris',      label: `IRIS (${ss ? fmtK(ss.iris.total) : '…'})`,                           color: '#06b6d4' },
          { key: 'transport', label: `Transport & Flux (${ss ? fmtK(ss.transport.total + ss.flux.total) : '…'})`, color: '#22c55e' },
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
          {[
            { label: 'Panneaux OOH', value: sourcesStats.ooh.total.toLocaleString('fr-FR'), sub: `${sourcesStats.ooh.nb_villes} villes · ${(sourcesStats.ooh.regies ?? []).length} régies`, color: C.warn, tab: 'panneaux' as const },
            { label: 'POI', value: sourcesStats.poi.total.toLocaleString('fr-FR'), sub: `lycées, CIRFA, autres`, color: '#4ecdc4', tab: 'poi' as const },
            { label: 'Carreaux', value: (sourcesStats.carreaux.total / 1_000_000).toFixed(2) + 'M', sub: 'Filosofi 200m', color: C.green, tab: 'carreaux' as const },
            { label: 'IRIS', value: sourcesStats.iris.total.toLocaleString('fr-FR'), sub: `${sourcesStats.iris.enrichis.toLocaleString('fr-FR')} enrichis`, color: '#06b6d4', tab: 'iris' as const },
            { label: 'Transport & Flux', value: (sourcesStats.transport.total + sourcesStats.flux.total).toLocaleString('fr-FR'), sub: 'arrêts + routes', color: '#22c55e', tab: 'transport' as const },
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
        </div>
      )}

      {/* ── OOH Panel ────────────────────────────────────────────────────────── */}
      {activeTab === 'panneaux' && (() => {
        const warn = C.warn;
        const warnDim = C.warnDim;
        const warnBorder = `${C.warn}44`;
        const ss = sourcesStats;
        if (!ss) return (
          <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
            {sourcesStatsLoading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
          </div>
        );
        const maxType = (ss.ooh.types ?? [])[0]?.nb ?? 1;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
            {/* Header card */}
            <div style={{ background: warnDim, border: `0.5px solid ${warnBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: warn, letterSpacing: 1, marginBottom: 6 }}>
                  Data Lake OOH — global_ooh
                </div>
                <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                  <span style={{ color: C.textSec }}>Régies: </span><span style={{ color: C.text }}>{(ss.ooh.regies ?? []).slice(0, 5).join(', ')}{(ss.ooh.regies ?? []).length > 5 ? ` +${(ss.ooh.regies ?? []).length - 5}` : ''}</span><br />
                  <span style={{ color: C.textSec }}>Sources: </span><span style={{ color: C.text }}>{(ss.ooh.sources ?? []).join(', ')}</span><br />
                  <span style={{ color: C.textSec }}>Villes: </span>{ss.ooh.nb_villes} villes couvertes<br />
                  <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>global_ooh</span> (statut = actif)
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: warn, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                  {ss.ooh.total.toLocaleString('fr-FR')}
                </div>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                  panneaux actifs
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Villes',   value: ss.ooh.nb_villes,              color: warn },
                { label: 'Régies',   value: (ss.ooh.regies ?? []).length,   color: C.accent },
                { label: 'Types',    value: (ss.ooh.types ?? []).length,    color: '#60a5fa' },
              ].map(({ label, value, color }, idx) => (
                <div key={label} style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 14px', transition: 'all 0.2s ease', animation: `srcFadeIn 0.4s ease-out ${0.05 * idx}s both` }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 700, color, animation: 'srcCountUp 0.5s ease-out' }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Types de panneaux */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: warn, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                  Types de panneaux (top 10)
                </div>
                {(ss.ooh.types ?? []).map(({ type, nb }) => {
                  const pct = Math.round(nb / maxType * 100);
                  return (
                    <div key={type} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{type}</span>
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: warn, fontWeight: 700, flexShrink: 0 }}>{nb.toLocaleString('fr-FR')}</span>
                      </div>
                      <div style={{ height: 3, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: warn, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top 20 villes */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: warn, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                  Top 20 villes
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: C.bgSurface, position: 'sticky', top: 0 }}>
                        {['#', 'Ville', 'Panneaux'].map((h) => (
                          <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(ss.ooh.top_villes ?? []).map((v, i) => (
                        <tr
                          key={v.ville}
                          style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#111111')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                        >
                          <td style={{ padding: '5px 12px', color: C.muted, width: 30 }}>{i + 1}</td>
                          <td style={{ padding: '5px 12px', color: C.text, fontWeight: 600 }}>{v.ville}</td>
                          <td style={{ padding: '5px 12px', color: warn, fontWeight: 700 }}>{v.nb}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── POI Panel ────────────────────────────────────────────────────────── */}
      {activeTab === 'poi' && (() => {
        const teal = '#4ecdc4';
        const tealDim = 'rgba(78,205,196,0.10)';
        const tealBorder = 'rgba(78,205,196,0.25)';
        const ss = sourcesStats;
        if (!ss) return (
          <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
            {sourcesStatsLoading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
          </div>
        );
        // ── Mapping couleur/label pour catégories connues ──────────────────
        const POI_META: Record<string, { label: string; description: string; color: string; dim: string; border: string }> = {
          lycee:      { label: 'Lycées',          description: 'Établissements scolaires du second degré',                    color: C.warn,  dim: C.warnDim,                    border: `${C.warn}44` },
          cirfa:      { label: 'CIRFA',            description: 'Centres d\'information et de recrutement des forces armées',  color: C.red,   dim: C.redDim,                     border: `${C.red}44` },
          bmw:        { label: 'BMW Concessions',  description: 'Points de vente BMW',                                        color: '#3b82f6', dim: 'rgba(59,130,246,0.10)',     border: 'rgba(59,130,246,0.35)' },
          concession: { label: 'Concessions',      description: 'Points de vente automobiles',                                color: '#3b82f6', dim: 'rgba(59,130,246,0.10)',     border: 'rgba(59,130,246,0.35)' },
          pharmacie:  { label: 'Pharmacies',       description: 'Pharmacies et parapharmacies',                               color: C.green, dim: C.greenDim,                   border: `${C.green}44` },
          supermarche: { label: 'Supermarchés',    description: 'Grande distribution',                                        color: '#06b6d4', dim: 'rgba(6,182,212,0.10)',      border: 'rgba(6,182,212,0.35)' },
        };
        const PALETTE = [teal, '#06b6d4', C.green, '#f59e0b', '#ec4899', '#64748b', '#a0a0a0', '#34d399'];
        const getCatMeta = (cat: string, idx: number) => {
          if (POI_META[cat]) return POI_META[cat];
          const col = PALETTE[idx % PALETTE.length];
          return { label: cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), description: `Catégorie : ${cat}`, color: col, dim: `${col}18`, border: `${col}44` };
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
            <div style={{ background: tealDim, border: `0.5px solid ${tealBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: teal, letterSpacing: 1, marginBottom: 6 }}>Points d&apos;intérêt (hors transport)</div>
                <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                  <span style={{ color: C.textSec }}>Catégories: </span>{ss.poi.by_category.map((c) => c.categorie).join(', ') || '—'}<br />
                  <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>poi_france</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: teal, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                  {ss.poi.total.toLocaleString('fr-FR')}
                </div>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>points d&apos;intérêt</div>
              </div>
            </div>
            {/* ── Confirmation suppression bulk ─────────────────────────────── */}
            {confirmDeleteCat && (
              <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: fontInter, fontSize: 12, color: C.text, flex: 1 }}>
                  Supprimer <strong style={{ color: C.red }}>TOUS</strong> les POI de catégorie <span style={{ fontFamily: fontMono, color: C.red }}>{confirmDeleteCat}</span> ? Cette action est irréversible.
                </span>
                <button
                  onClick={() => deletePoisBulk(confirmDeleteCat)}
                  disabled={bulkDeleting}
                  style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.red, color: '#fff', border: 'none', borderRadius: 2, padding: '6px 14px', cursor: 'pointer', opacity: bulkDeleting ? 0.5 : 1 }}
                >
                  {bulkDeleting ? 'Suppression...' : 'Confirmer'}
                </button>
                <button
                  onClick={() => setConfirmDeleteCat(null)}
                  style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'none', color: C.textDim, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '6px 14px', cursor: 'pointer' }}
                >
                  Annuler
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {ss.poi.by_category.map(({ categorie: cat, nb }, idx) => {
                const meta = getCatMeta(cat, idx);
                const pct  = ss.poi.total > 0 ? Math.round(nb / ss.poi.total * 100) : 0;
                const isSelected = selectedPoiCat === cat;
                return (
                  <div
                    key={cat}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = meta.border; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = isSelected ? meta.border : C.border; }}
                    style={{
                      background: isSelected ? meta.dim : C.bgElevated,
                      border: `0.5px solid ${isSelected ? meta.border : C.border}`,
                      borderRadius: 2,
                      padding: '16px',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      animation: `srcScaleIn 0.4s ease-out ${0.06 * idx}s both`,
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: meta.color, marginBottom: 4 }}>POI</div>
                        <div style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 700, color: isSelected ? meta.color : C.text, letterSpacing: 0.5 }}>{meta.label}</div>
                      </div>
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: meta.color, background: meta.dim, border: `0.5px solid ${meta.border}`, padding: '2px 6px', borderRadius: 2 }}>
                        {pct}%
                      </span>
                    </div>

                    {/* Count */}
                    <div style={{ fontFamily: fontMono, fontSize: 32, fontWeight: 700, color: meta.color, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                      {nb.toLocaleString('fr-FR')}
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginLeft: 8 }}>POI</span>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 3, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 2, transition: 'width 0.3s ease', animation: 'srcBarGrow 0.6s ease-out' }} />
                    </div>

                    {/* Meta */}
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, lineHeight: 1.8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                      <div style={{ color: C.textSec, marginBottom: 2 }}>{meta.description}</div>
                      <div><span style={{ color: C.muted }}>cat: </span><span style={{ color: C.accent }}>{cat}</span></div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <button
                        onClick={() => { const next = isSelected ? null : cat; setSelectedPoiCat(next); if (next) { setPoiSamplesOffset(0); fetchPoiSamples(next, 0); } else setPoiSamples([]); }}
                        style={{ flex: 1, fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: isSelected ? meta.dim : 'transparent', color: isSelected ? meta.color : C.muted, border: `0.5px solid ${isSelected ? meta.border : C.border}`, borderRadius: 2, padding: '5px 8px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      >
                        {isSelected ? '✕ fermer' : '+ voir'}
                      </button>
                      <button
                        onClick={() => openCreatePoi(cat)}
                        style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.green, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      >
                        + nouveau
                      </button>
                      <button
                        onClick={() => setConfirmDeleteCat(cat)}
                        style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.red, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      >
                        ✕ purger
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Samples panel */}
            {selectedPoiCat && (
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface, display: 'flex', alignItems: 'center', gap: 8, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                  <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: teal }}>
                    {selectedPoiCat} — {poiSamples.length} / {poiSamplesTotal.toLocaleString('fr-FR')} POI
                  </span>
                  {poiSamplesLoading && <Spinner size={12} />}
                  <button
                    onClick={() => openCreatePoi(selectedPoiCat)}
                    style={{ marginLeft: 'auto', fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.greenDim, color: C.green, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  >
                    + nouveau POI
                  </button>
                  <button onClick={() => { setSelectedPoiCat(null); setPoiSamples([]); }} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 13, lineHeight: 1, marginLeft: 4 }}>✕</button>
                </div>

                {/* Table */}
                {poiSamples.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: C.bgSurface }}>
                          {['Nom', 'Ville', 'Adresse', 'Sous-cat', 'Lat', 'Lng', 'Source', ''].map((h) => (
                            <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {poiSamples.map((p, i) => (
                          <tr
                            key={p.id}
                            style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#111111')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                          >
                            <td style={{ padding: '5px 12px', color: C.text, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom ?? '—'}</td>
                            <td style={{ padding: '5px 12px', color: C.textDim, whiteSpace: 'nowrap' }}>{p.ville ?? '—'}</td>
                            <td style={{ padding: '5px 12px', color: C.textSec, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.adresse ?? '—'}</td>
                            <td style={{ padding: '5px 12px', color: C.textDim }}>{p.sous_categorie ?? '—'}</td>
                            <td style={{ padding: '5px 12px', color: C.muted }}>{p.lat?.toFixed(4)}</td>
                            <td style={{ padding: '5px 12px', color: C.muted }}>{p.lng?.toFixed(4)}</td>
                            <td style={{ padding: '5px 12px', color: C.muted, fontSize: 10 }}>{p.source ?? '—'}</td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => openEditPoi(p)}
                                style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.accent, border: `0.5px solid ${C.borderLight}`, borderRadius: 2, padding: '3px 7px', cursor: 'pointer', marginRight: 4 }}
                              >
                                éditer
                              </button>
                              <button
                                onClick={() => deletePoi(p.id)}
                                style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.red, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '3px 7px', cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Load more */}
                {poiSamples.length < poiSamplesTotal && (
                  <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => fetchPoiSamples(selectedPoiCat, poiSamplesOffset)}
                      disabled={poiSamplesLoading}
                      style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.accentDim, color: C.accent, border: `0.5px solid ${C.borderLight}`, borderRadius: 2, padding: '5px 14px', cursor: 'pointer', opacity: poiSamplesLoading ? 0.5 : 1 }}
                    >
                      {poiSamplesLoading ? 'Chargement...' : `Charger + (${poiSamplesTotal - poiSamples.length} restants)`}
                    </button>
                  </div>
                )}

                {!poiSamplesLoading && poiSamples.length === 0 && (
                  <div style={{ padding: '16px', color: C.textDim, fontFamily: fontInter, fontSize: 12 }}>Aucun résultat.</div>
                )}
              </div>
            )}

            {/* ── Modal ajouter / éditer POI ──────────────────────────────────── */}
            {poiModal.open && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: 24, width: 520, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 700, color: teal, letterSpacing: 1, marginBottom: 20 }}>
                    {poiModal.mode === 'create' ? '+ Nouveau POI' : 'Éditer POI'}
                  </div>

                  {poiModalError && (
                    <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 14 }}>
                      {poiModalError}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {([
                      { field: 'nom',           label: 'Nom',          span: 2 },
                      { field: 'categorie',      label: 'Catégorie *',  span: 1 },
                      { field: 'sous_categorie', label: 'Sous-catégorie', span: 1 },
                      { field: 'lat',            label: 'Latitude *',   span: 1 },
                      { field: 'lng',            label: 'Longitude *',  span: 1 },
                      { field: 'adresse',        label: 'Adresse',      span: 2 },
                      { field: 'ville',          label: 'Ville',        span: 1 },
                      { field: 'departement',    label: 'Département',  span: 1 },
                      { field: 'code_postal',    label: 'Code postal',  span: 1 },
                      { field: 'source',         label: 'Source',       span: 1 },
                    ] as { field: keyof typeof emptyForm; label: string; span: number }[]).map(({ field, label, span }) => (
                      <div key={field} style={{ gridColumn: span === 2 ? '1 / -1' : 'auto' }}>
                        <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 4 }}>{label}</div>
                        <input
                          value={poiModal.data[field]}
                          onChange={(e) => setPoiModal((m) => ({ ...m, data: { ...m.data, [field]: e.target.value } }))}
                          style={{ width: '100%', background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '7px 10px', fontFamily: fontMono, fontSize: 11, color: C.text, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.3s ease' }}
                          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                          onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                        />
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                    <button
                      onClick={() => setPoiModal({ open: false, mode: 'create', data: emptyForm })}
                      style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'none', color: C.textDim, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '7px 16px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    >
                      Annuler
                    </button>
                    <button
                      onClick={savePoi}
                      disabled={poiModalSaving}
                      style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: teal, color: '#fff', border: 'none', borderRadius: 2, padding: '7px 20px', cursor: 'pointer', opacity: poiModalSaving ? 0.6 : 1, transition: 'all 0.2s ease' }}
                    >
                      {poiModalSaving ? 'Enregistrement...' : poiModal.mode === 'create' ? 'Créer' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Carreaux Panel ───────────────────────────────────────────────────── */}
      {activeTab === 'carreaux' && (() => {
        const ss = sourcesStats;
        if (!ss) return (
          <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
            {sourcesStatsLoading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
          </div>
        );
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
            <div style={{ background: C.greenDim, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: C.green, letterSpacing: 1, marginBottom: 6 }}>Carreaux INSEE Filosofi 200m</div>
                <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                  <span style={{ color: C.textSec }}>Source: </span>INSEE Filosofi<br />
                  <span style={{ color: C.textSec }}>Résolution: </span>200m × 200m<br />
                  <span style={{ color: C.textSec }}>Couverture: </span>France métropolitaine<br />
                  <span style={{ color: C.textSec }}>Données: </span>population, revenus, âge, densité<br />
                  <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>carreaux_filosofi</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: C.green, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                  {(ss.carreaux.total / 1_000_000).toFixed(2)}M
                </div>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>carreaux</div>
              </div>
            </div>
            <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px', fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
              <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textSec, display: 'block', marginBottom: 6 }}>// utilisation</span>
              Jointure spatiale avec <span style={{ color: C.green }}>public.iris</span> via <span style={{ color: '#06b6d4' }}>ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
              Agrégation démographique par isochrone ou zone de chalandise.
            </div>
          </div>
        );
      })()}

      {/* ── IRIS Panel ──────────────────────────────────────────────────────── */}
      {activeTab === 'iris' && (() => {
        const cyan = '#06b6d4';
        const cyanDim = 'rgba(6,182,212,0.10)';
        const cyanBorder = 'rgba(6,182,212,0.25)';
        return (
          <div>
            {irisLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '40px 0', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>
                <Spinner size={18} /> Chargement des statistiques IRIS...
              </div>
            )}
            {!irisLoading && irisStats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>

                {/* Source info banner */}
                <div style={{ background: cyanDim, border: `0.5px solid ${cyanBorder}`, borderRadius: 2, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: cyan, letterSpacing: 1, marginBottom: 4 }}>
                      {irisSource?.name ?? 'CONTOURS-IRIS-PE — IGN 2025'}
                    </div>
                    <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
                      <span style={{ color: C.textSec }}>Fournisseur: </span>{irisSource?.provider}<br />
                      <span style={{ color: C.textSec }}>Licence: </span>{irisSource?.license}<br />
                      <span style={{ color: C.textSec }}>Format: </span>{irisSource?.format}<br />
                      <span style={{ color: C.textSec }}>Couverture: </span>{irisSource?.coverage}<br />
                      <span style={{ color: C.textSec }}>Importé le: </span>
                      <span style={{ color: C.green }}>{irisSource?.imported_at}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: cyan, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                      {irisStats.total.toLocaleString('fr-FR')}
                    </div>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                      zones IRIS
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[
                    { label: 'Départements',  value: irisStats.nb_depts.toLocaleString('fr-FR'),    color: cyan },
                    { label: 'Communes',      value: irisStats.nb_communes.toLocaleString('fr-FR'), color: C.accent },
                    { label: 'Avec géométrie',value: irisStats.with_geom.toLocaleString('fr-FR'),   color: C.green },
                    { label: 'Taille table',  value: irisStats.table_size,                          color: C.warn },
                  ].map(({ label, value, color }, idx) => (
                    <div key={label} style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 14px', transition: 'all 0.2s ease', animation: `srcFadeIn 0.4s ease-out ${0.05 * idx}s both` }}>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 700, color, animation: 'srcCountUp 0.5s ease-out' }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                  {/* Types IRIS */}
                  <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                      Répartition par type
                    </div>
                    {[
                      { code: 'Z', label: 'Zone d\'activité économique', value: irisStats.type_z, color: C.warn },
                      { code: 'H', label: 'Habitation',                  value: irisStats.type_h, color: C.accent },
                      { code: 'A', label: 'Activité',                    value: irisStats.type_a, color: C.green },
                      { code: 'D', label: 'Divers',                      value: irisStats.type_d, color: C.textDim },
                    ].map(({ code, label, value, color }) => {
                      const pct = Math.round((value / irisStats.total) * 100);
                      return (
                        <div key={code} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, background: C.bgSurface, border: `0.5px solid ${C.border}`, padding: '1px 5px', borderRadius: 1 }}>{code}</span>
                              <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec }}>{label}</span>
                            </div>
                            <span style={{ fontFamily: fontMono, fontSize: 11, color, fontWeight: 700 }}>{value.toLocaleString('fr-FR')} <span style={{ color: C.muted, fontSize: 9 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 4, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s ease', animation: 'srcBarGrow 0.6s ease-out' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Top départements */}
                  <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                      Top 15 départements
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {irisDepts.map(({ code, nom, nb }, i) => {
                        const max = irisDepts[0]?.nb ?? 1;
                        const pct = Math.round((nb / max) * 100);
                        return (
                          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < irisDepts.length - 1 ? `1px solid ${C.bgSurface}` : 'none' }}>
                            <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, width: 20, textAlign: 'right', flexShrink: 0 }}>{code}</span>
                            <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{nom}</span>
                            <div style={{ flex: 1, height: 3, background: C.bgSurface, borderRadius: 1 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: i === 0 ? cyan : `${cyan}66`, borderRadius: 1 }} />
                            </div>
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: i === 0 ? cyan : C.textDim, fontWeight: i === 0 ? 700 : 400, width: 40, textAlign: 'right', flexShrink: 0 }}>{nb}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>

                {/* Schema */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 10 }}>
                    Schéma de la table <span style={{ color: C.accent }}>public.iris</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      { col: 'code_iris',     type: 'TEXT',        note: 'code unique à 9 chiffres' },
                      { col: 'nom_iris',      type: 'TEXT',        note: 'libellé IRIS' },
                      { col: 'code_commune',  type: 'TEXT',        note: 'code INSEE commune' },
                      { col: 'nom_commune',   type: 'TEXT',        note: 'nom commune' },
                      { col: 'code_dept',     type: 'TEXT',        note: 'code département (2 ou 3 car.)' },
                      { col: 'type_iris',     type: 'TEXT',        note: 'H / A / D / Z' },
                      { col: 'geom',          type: 'GEOMETRY',    note: 'MultiPolygon — EPSG:4326' },
                    ].map(({ col, type, note }) => (
                      <div key={col} style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: fontMono, fontSize: 11, color: C.text, fontWeight: 600 }}>{col}</span>
                        <span style={{ fontFamily: fontInter, fontSize: 9, color: type === 'GEOMETRY' ? C.green : C.accent, background: type === 'GEOMETRY' ? C.greenDim : C.accentDim, border: `0.5px solid ${type === 'GEOMETRY' ? `${C.green}44` : C.borderLight}`, padding: '1px 5px', borderRadius: 1, fontWeight: 500 }}>{type}</span>
                        <span style={{ fontFamily: fontInter, fontSize: 10, color: C.muted }}>{note}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                    Index: <span style={{ color: C.textDim }}>PRIMARY KEY (code_iris)</span> · <span style={{ color: C.green }}>GIST (geom)</span> · Taille index: {irisStats.index_size}
                  </div>
                </div>

                {/* Usage note */}
                <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 16px', fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
                  <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textSec, display: 'block', marginBottom: 6 }}>// utilisation</span>
                  Utilisé pour les analyses de <span style={{ color: C.accent }}>bassins de population</span> Filosofi.<br />
                  Jointure spatiale avec <span style={{ color: C.green }}>public.carreaux_filosofi</span> via <span style={{ color: cyan }}>ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
                  Requête type: <span style={{ color: C.text }}>SELECT code_iris, SUM(ind) FROM iris JOIN carreaux_filosofi ON ST_Intersects(...)</span>
                </div>

                {/* ── Année du millésime ── */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '16px 18px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: '#06b6d4', marginBottom: 10 }}>
                    Millésime / Année
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number"
                      min={2000}
                      max={2099}
                      value={irisAnnee}
                      onChange={e => setIrisAnnee(e.target.value)}
                      style={{
                        width: 90, padding: '6px 10px', borderRadius: 2,
                        background: C.bgSurface, border: `0.5px solid ${C.border}`,
                        color: C.text, fontFamily: fontMono, fontSize: 14,
                        outline: 'none', transition: 'border-color 0.3s ease',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                    />
                    <button
                      onClick={() => saveIrisAnnee(irisAnnee)}
                      disabled={irisAnneeSaving}
                      style={{
                        padding: '6px 14px', borderRadius: 2,
                        background: C.accentDim, border: `0.5px solid ${C.borderLight}`,
                        color: C.accent, fontFamily: fontInter, fontSize: 9,
                        cursor: 'pointer',
                      }}
                    >
                      {irisAnneeSaving ? 'Enregistrement…' : irisAnneeSaved ? '✓ Sauvegardé' : 'Sauvegarder'}
                    </button>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                      Millésime CONTOURS-IRIS (ex: 2025 = édition IGN 2025)
                    </span>
                  </div>
                </div>

                {/* ── Régénérer PMTiles ── */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${cyanBorder}`, borderRadius: 2, padding: '16px 18px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 8 }}>
                    Carte choroplèthe — PMTiles
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 12, lineHeight: 1.7 }}>
                    Déclenche le workflow GitHub Actions <span style={{ color: C.text }}>generate-iris-pmtiles</span> : export NDJSON → tippecanoe → upload GitHub Releases.<br />
                    À faire après chaque import de nouvelles données démographiques (diplômes, revenus, CSP…).
                  </div>
                  {irisPmtilesMsg && (
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: irisPmtilesMsg.startsWith('✓') ? C.green : C.red, marginBottom: 10, lineHeight: 1.6, wordBreak: 'break-all' }}>
                      {irisPmtilesMsg}
                    </div>
                  )}
                  <button
                    onClick={triggerIrisPmtiles}
                    disabled={irisPmtilesLoading}
                    style={{
                      padding: '7px 18px', borderRadius: 2,
                      background: cyanDim, border: `0.5px solid ${cyanBorder}`,
                      color: cyan, fontFamily: fontInter, fontSize: 9,
                      cursor: irisPmtilesLoading ? 'not-allowed' : 'pointer',
                      opacity: irisPmtilesLoading ? 0.6 : 1,
                    }}
                  >
                    {irisPmtilesLoading ? 'Déclenchement…' : 'Régénérer PMTiles IRIS'}
                  </button>
                </div>

                {/* ── Zone danger : supprimer les IRIS ── */}
                <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '16px 18px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.red, marginBottom: 8 }}>
                    Zone Danger — Suppression
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 12 }}>
                    Supprime toutes les zones IRIS de la base (TRUNCATE). À utiliser avant un ré-import avec un nouveau millésime.
                  </div>
                  {irisDeleteMsg && (
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: irisDeleteMsg.startsWith('✓') ? C.green : C.red, marginBottom: 10 }}>
                      {irisDeleteMsg}
                    </div>
                  )}
                  {!irisDeleteConfirm ? (
                    <button
                      onClick={() => setIrisDeleteConfirm(true)}
                      style={{
                        padding: '7px 16px', borderRadius: 2,
                        background: 'transparent', border: `0.5px solid ${C.red}66`,
                        color: C.red, fontFamily: fontInter, fontSize: 9,
                        cursor: 'pointer',
                      }}
                    >
                      Supprimer tous les IRIS
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: fontMono, fontSize: 10, color: C.warn }}>
                        ! Confirmer la suppression de {irisStats?.total.toLocaleString('fr-FR')} IRIS ?
                      </span>
                      <button
                        onClick={deleteAllIris}
                        disabled={irisDeleteLoading}
                        style={{
                          padding: '6px 14px', borderRadius: 2,
                          background: `${C.red}22`, border: `0.5px solid ${C.red}`,
                          color: C.red, fontFamily: fontInter, fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        {irisDeleteLoading ? 'Suppression…' : 'Oui, supprimer'}
                      </button>
                      <button
                        onClick={() => setIrisDeleteConfirm(false)}
                        style={{
                          padding: '6px 14px', borderRadius: 2,
                          background: 'transparent', border: `0.5px solid ${C.border}`,
                          color: C.textDim, fontFamily: fontInter, fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Synchronisation IRIS ── */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 3 }}>
                        Synchronisation IRIS
                      </div>
                      <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                        Vérifie que les colonnes en base sont alignées avec{' '}
                        <span style={{ color: C.accent }}>IRIS_DB_COLUMNS</span> (db-columns.ts)
                      </div>
                    </div>
                    <button
                      onClick={runIrisSync}
                      disabled={irisSyncLoading}
                      style={{
                        flexShrink: 0, padding: '6px 16px', borderRadius: 2,
                        background: irisSyncLoading ? C.accentDim : C.accentDim,
                        border: `0.5px solid ${C.borderLight}`,
                        color: C.accent, fontFamily: fontInter, fontSize: 9,
                        cursor: irisSyncLoading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {irisSyncLoading ? <><Spinner size={10} /> Vérification…</> : 'Vérifier'}
                    </button>
                  </div>

                  {irisSyncError && (
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.red, padding: '6px 8px', background: C.redDim, borderRadius: 2, marginBottom: 10 }}>
                      ! {irisSyncError}
                    </div>
                  )}

                  {irisSyncReport && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                      {/* Status banner */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 2,
                        background: irisSyncReport.synced ? 'rgba(61,255,160,0.06)' : C.warnDim,
                        border: `0.5px solid ${irisSyncReport.synced ? `${C.green}44` : `${C.warn}44`}`,
                      }}>
                        <span style={{ fontFamily: fontMono, fontSize: 16, color: irisSyncReport.synced ? C.green : C.warn }}>
                          {irisSyncReport.synced ? '✓' : '!'}
                        </span>
                        <div>
                          <div style={{ fontFamily: fontInter, fontSize: 9, color: irisSyncReport.synced ? C.green : C.warn }}>
                            {irisSyncReport.synced ? 'Synchronisé' : 'Désynchronisation détectée'}
                          </div>
                          <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim, marginTop: 2 }}>
                            {irisSyncReport.db_columns.length} colonnes en base ·{' '}
                            {irisSyncReport.code_columns.length} dans IRIS_DB_COLUMNS
                          </div>
                        </div>
                      </div>

                      {/* Actions manuelles */}
                      {irisSyncReport.manual_actions_needed.length > 0 && (
                        <div style={{ background: C.warnDim, border: `0.5px solid ${C.warn}44`, borderRadius: 2, padding: '10px 12px' }}>
                          <div style={{ fontFamily: fontInter, fontSize: 9, color: C.warn, marginBottom: 6 }}>
                            Actions requises
                          </div>
                          {irisSyncReport.manual_actions_needed.map((action, i) => (
                            <div key={i} style={{ fontFamily: fontMono, fontSize: 10, color: C.text, marginBottom: 3 }}>
                              › {action}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* RPC status */}
                      <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '8px 12px' }}>
                        <div style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, marginBottom: 6 }}>
                          Statut RPCs
                        </div>
                        {Object.entries(irisSyncReport.rpc_status).map(([rpc, status]) => (
                          <div key={rpc} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 9, marginBottom: 3 }}>
                            <span style={{ color: C.accent }}>{rpc}</span>
                            <span style={{ color: C.green }}>{status}</span>
                          </div>
                        ))}
                      </div>

                      {/* Fill status table */}
                      <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '8px 12px' }}>
                        <div style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, marginBottom: 8 }}>
                          Remplissage par colonne
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                          {Object.entries(irisSyncReport.fill_status)
                            .sort((a, b) => b[1] - a[1])
                            .map(([col, count]) => {
                              const total = irisSyncReport.fill_status['population'] || 1;
                              const pct   = Math.round((count / total) * 100);
                              const color = pct >= 80 ? C.green : pct >= 30 ? C.warn : C.red;
                              const inCode = irisSyncReport.code_columns.includes(col);
                              return (
                                <div key={col} style={{
                                  display: 'flex', alignItems: 'center', gap: 6,
                                  padding: '4px 6px',
                                  background: C.bgElevated,
                                  border: `0.5px solid ${inCode ? C.border : `${C.warn}44`}`,
                                  borderRadius: 2,
                                }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontFamily: fontMono, fontSize: 9, color: inCode ? C.text : C.warn, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {col}
                                    </div>
                                    <div style={{ height: 2, background: C.border, borderRadius: 1, marginTop: 3 }}>
                                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 1 }} />
                                    </div>
                                  </div>
                                  <span style={{ fontFamily: fontMono, fontSize: 9, color, flexShrink: 0 }}>
                                    {count.toLocaleString('fr')}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>

                    </div>
                  )}
                </div>

                {/* ── Accessibilité Gaussienne σ ── */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500 as const, color: C.accent, marginBottom: 3 }}>
                        Accessibilité Gaussienne — Config σ
                      </div>
                      <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                        Portée d'influence par catégorie POI · Score = Σ exp(−d²/2σ²) · Rayon 3σ
                      </div>
                    </div>
                    <button
                      onClick={fetchSigmaConfig}
                      disabled={sigmaConfigLoading}
                      style={{
                        flexShrink: 0, padding: '6px 16px', borderRadius: 2,
                        background: C.accentDim, border: `0.5px solid ${C.borderLight}`,
                        color: C.accent, fontFamily: fontInter, fontSize: 9,
                        cursor: sigmaConfigLoading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {sigmaConfigLoading ? <><Spinner size={10} /> Chargement…</> : 'Actualiser'}
                    </button>
                  </div>

                  {sigmaConfig && sigmaConfig.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                      {sigmaConfig.map(cfg => {
                        const rayon3s = (cfg.sigma_km * 3).toFixed(1);
                        const barPct  = Math.min((cfg.sigma_km / 20) * 100, 100);
                        return (
                          <div key={cfg.categorie} style={{
                            background: C.bgSurface, border: `0.5px solid ${C.border}`,
                            borderRadius: 2, padding: '10px 12px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontFamily: fontMono, fontSize: 10, color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                {cfg.categorie}
                              </span>
                              <span style={{ fontFamily: fontMono, fontSize: 11, fontWeight: 700, color: C.text, flexShrink: 0, marginLeft: 8 }}>
                                σ {cfg.sigma_km < 1 ? `${(cfg.sigma_km * 1000).toFixed(0)}m` : `${cfg.sigma_km}km`}
                              </span>
                            </div>
                            <div style={{ height: 3, background: C.border, borderRadius: 2, marginBottom: 5 }}>
                              <div style={{ width: `${barPct}%`, height: '100%', background: C.accent, borderRadius: 2, opacity: 0.7 }} />
                            </div>
                            <div style={{ fontFamily: fontInter, fontSize: 9, color: C.textSec }}>
                              Rayon 3σ · {rayon3s} km
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {sigmaConfig && sigmaConfig.length === 0 && (
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, padding: '8px 0' }}>
                      Aucune configuration trouvée dans <span style={{ color: C.accent }}>poi_accessibility_config</span>.
                    </div>
                  )}

                  {!sigmaConfig && !sigmaConfigLoading && (
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, padding: '8px 0' }}>
                      Cliquez sur ACTUALISER pour charger la configuration.
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ── Transport Panel ─────────────────────────────────────────────────── */}
      {activeTab === 'transport' && (() => {
        const green2 = '#22c55e';
        const green2Dim = 'rgba(34,197,94,0.10)';
        const green2Border = 'rgba(34,197,94,0.25)';
        const orange = '#f97316';
        const orangeDim = 'rgba(249,115,22,0.10)';
        const orangeBorder = 'rgba(249,115,22,0.25)';

        const pctTransport = transportStats
          ? Math.round(transportStats.panneaux.avec_transport / transportStats.panneaux.total * 100)
          : 0;
        const pctFlux = transportStats
          ? Math.round(transportStats.panneaux.avec_flux / transportStats.panneaux.total * 100)
          : 0;
        const badgeColor = (pct: number) =>
          pct >= 90 ? C.green : pct >= 70 ? C.warn : C.red;

        return (
          <div>
            {transportLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '40px 0', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>
                <Spinner size={18} /> Chargement des statistiques transport...
              </div>
            )}
            {!transportLoading && !transportStats && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
                Aucune donnée. <button onClick={fetchTransportStats} style={{ ...btnGhostStyle, display: 'inline-flex' }}>Charger</button>
              </div>
            )}
            {!transportLoading && transportStats && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>

                {/* Arrêts transport */}
                <div style={{ background: green2Dim, border: `0.5px solid ${green2Border}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: green2, letterSpacing: 1, marginBottom: 6 }}>
                      Arrêts de transport en commun
                    </div>
                    <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                      <span style={{ color: C.textSec }}>Source: </span>GTFS consolidé France — transport.data.gouv.fr<br />
                      {Object.entries(transportStats.arrets.by_source).map(([src, nb]) => (
                        <span key={src}>
                          <span style={{ color: C.textSec }}>Dataset: </span>
                          <span style={{ color: C.text }}>{src}</span>
                          <span style={{ color: C.muted }}> — {nb.toLocaleString('fr-FR')} arrêts</span>
                          <br />
                        </span>
                      ))}
                    </div>
                    {pctTransport > 0 ? (
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: badgeColor(pctTransport), background: `${badgeColor(pctTransport)}1a`, border: `0.5px solid ${badgeColor(pctTransport)}44`, padding: '2px 8px', borderRadius: 2 }}>
                          {pctTransport}% panneaux couverts
                        </span>
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                          ({transportStats.panneaux.avec_transport.toLocaleString('fr-FR')} / {transportStats.panneaux.total.toLocaleString('fr-FR')})
                        </span>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.muted, border: `0.5px solid ${C.border}`, padding: '2px 8px', borderRadius: 2, display: 'inline-block' }}>
                        Scoring OOH non calculé
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: green2, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                      {transportStats.arrets.total.toLocaleString('fr-FR')}
                    </div>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                      arrêts physiques
                    </div>
                    <button
                      onClick={fetchTransportStats}
                      style={{ ...btnGhostStyle, marginTop: 10, fontSize: 9 }}
                    >
                      Actualiser
                    </button>
                  </div>
                </div>

                {/* Flux routier */}
                <div style={{ background: orangeDim, border: `0.5px solid ${orangeBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: orange, letterSpacing: 1, marginBottom: 6 }}>
                      Flux routier (TMJA)
                    </div>
                    <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                      {Object.entries(transportStats.flux.by_source).map(([src, nb]) => (
                        <span key={src}>
                          <span style={{ color: C.textSec }}>{src === 'tmja_rrn_national' ? 'CEREMA (réel): ' : 'OSM proxy: '}</span>
                          <span style={{ color: C.text }}>{nb.toLocaleString('fr-FR')} sections</span>
                          <br />
                        </span>
                      ))}
                    </div>
                    {pctFlux > 0 ? (
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: badgeColor(pctFlux), background: `${badgeColor(pctFlux)}1a`, border: `0.5px solid ${badgeColor(pctFlux)}44`, padding: '2px 8px', borderRadius: 2 }}>
                          {pctFlux}% panneaux couverts
                        </span>
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                          ({transportStats.panneaux.avec_flux.toLocaleString('fr-FR')} / {transportStats.panneaux.total.toLocaleString('fr-FR')})
                        </span>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.muted, border: `0.5px solid ${C.border}`, padding: '2px 8px', borderRadius: 2, display: 'inline-block' }}>
                        Scoring OOH non calculé
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: orange, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                      {transportStats.flux.total.toLocaleString('fr-FR')}
                    </div>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                      sections routières
                    </div>
                  </div>
                </div>

                {/* Toggle tableau — masqué si scoring non calculé */}
                <div>
                  {transportStats.panneaux.total > 0 && (pctTransport > 0 || pctFlux > 0) && (
                  <button
                    onClick={() => setShowTransportTable((v) => !v)}
                    style={{ ...btnGhostStyle, marginBottom: showTransportTable ? 10 : 0 }}
                  >
                    {showTransportTable ? '▲ Masquer' : '▼ Détails par ville (top 30)'}
                  </button>
                  )}
                  {showTransportTable && (
                    <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: C.bgSurface }}>
                            {['Ville', 'Panneaux', 'Transport %', 'Moy. transport', 'Flux %', 'Moy. flux', 'Score total'].map((h) => (
                              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {transportStats.villes.map((v, i) => {
                            const pT = Math.round(v.avec_transport / v.nb_panneaux * 100);
                            const pF = Math.round(v.avec_flux / v.nb_panneaux * 100);
                            return (
                              <tr
                                key={v.ville}
                                style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#111111')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                              >
                                <td style={{ padding: '6px 12px', color: C.text, fontWeight: 600 }}>{v.ville}</td>
                                <td style={{ padding: '6px 12px', color: C.textDim }}>{v.nb_panneaux}</td>
                                <td style={{ padding: '6px 12px', color: badgeColor(pT) }}>{pT}%</td>
                                <td style={{ padding: '6px 12px', color: C.textDim }}>{v.transport_moyen}</td>
                                <td style={{ padding: '6px 12px', color: badgeColor(pF) }}>{pF}%</td>
                                <td style={{ padding: '6px 12px', color: C.textDim }}>{v.flux_moyen}</td>
                                <td style={{ padding: '6px 12px', color: C.accent, fontWeight: 700 }}>{v.score_moyen}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        );
      })()}

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
                                style={{ accentColor: '#4ecdc4' }}
                              />
                              <span style={{ color: isChecked ? '#4ecdc4' : C.textSec, flex: 1, fontFamily: fontMono }}>{field}</span>
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

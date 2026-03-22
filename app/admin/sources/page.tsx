'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { DataSource, Organization } from '@/types/admin';

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

// Schema columns meaningful as map filters (no id/lat/lng/geom)
const SCHEMA_FILTER_COLS = ['region', 'departement', 'ville', 'code_postal', 'categorie', 'sous_categorie'];

const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  bgSurface:   '#111118',
  border:      '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent:      '#a855f7',
  accentDim:   'rgba(168,85,247,0.12)',
  text:        '#e2e8f0',
  textDim:     '#94a3b8',
  textSec:     '#6b7280',
  muted:       '#4b5563',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.12)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.1)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.1)',
  blue:        '#3b82f6',
};
const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', 'Orbitron', sans-serif";
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
      fontFamily: fontMichroma,
      fontSize: 8,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: style.color,
      background: style.bg,
      border: `1px solid ${style.border}`,
      padding: '2px 7px',
      borderRadius: 2,
      whiteSpace: 'nowrap' as const,
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
  const [sources, setSources] = useState<DataSource[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [shareOrgId, setShareOrgId] = useState('');
  const [editName, setEditName] = useState('');
  const [editOrg, setEditOrg] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showFilterEdit, setShowFilterEdit] = useState(false);
  const [editFilterFields, setEditFilterFields] = useState<string[]>([]);
  const [availableMetaKeys, setAvailableMetaKeys] = useState<string[]>([]);
  const [isSavingFilters, setIsSavingFilters] = useState(false);
  const [isLoadingMetaKeys, setIsLoadingMetaKeys] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris'>('all');

  // IRIS stats
  const [irisStats,   setIrisStats]   = useState<IrisStats | null>(null);
  const [irisDepts,   setIrisDepts]   = useState<IrisDept[]>([]);
  const [irisSource,  setIrisSource]  = useState<IrisSource | null>(null);
  const [irisLoading, setIrisLoading] = useState(false);

  // ============================================================
  // Fetch data
  // ============================================================

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/sources');
      const data = await res.json();
      if (data.success) setSources(data.sources || []);
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/organizations');
      const data = await res.json();
      if (data.success) setOrganizations(data.organizations || []);
    } catch { /* ignore */ }
  }, []);

  const fetchIrisStats = useCallback(async () => {
    setIrisLoading(true);
    try {
      const res = await adminFetch('/api/admin/iris/stats');
      const data = await res.json();
      if (data.success) {
        setIrisStats(data.stats);
        setIrisDepts(data.top_depts || []);
        setIrisSource(data.source || null);
      }
    } catch { /* ignore */ }
    setIrisLoading(false);
  }, []);

  useEffect(() => {
    fetchSources();
    fetchOrgs();
  }, [fetchSources, fetchOrgs]);

  useEffect(() => {
    if (activeTab === 'iris' && !irisStats && !irisLoading) fetchIrisStats();
  }, [activeTab, irisStats, irisLoading, fetchIrisStats]);

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
    if (!confirm('Supprimer cette source et TOUTES ses donnees ? Cette action est irreversible.')) return;
    setIsDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/sources/${sourceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
        setSelectedSource(null);
      }
    } catch { /* ignore */ }
    setIsDeleting(false);
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
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    overflow: 'hidden',
  };
  const cardHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
    background: C.bgSurface,
  };
  const sectionLabelStyle: React.CSSProperties = {
    fontFamily: fontMichroma,
    fontSize: 9,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: C.accent,
  };

  const btnGhostStyle: React.CSSProperties = {
    background: 'transparent',
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    color: C.textDim,
    fontFamily: fontMichroma,
    fontSize: 9,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '4px 10px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  };
  const btnPrimaryStyle: React.CSSProperties = {
    background: C.accentDim,
    border: `1px solid ${C.borderLight}`,
    borderRadius: 2,
    color: C.accent,
    fontFamily: fontMichroma,
    fontSize: 9,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    justifyContent: 'center',
  };
  const btnDangerStyle: React.CSSProperties = {
    background: C.redDim,
    border: `1px solid ${C.red}44`,
    borderRadius: 2,
    color: C.red,
    fontFamily: fontMichroma,
    fontSize: 9,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    justifyContent: 'flex-start',
  };
  const inputStyle: React.CSSProperties = {
    background: C.bgSurface,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    color: C.text,
    fontFamily: fontMono,
    fontSize: 11,
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
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
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontOrbitron, fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            admin / sources
          </h1>
          <span style={{
            fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: C.warn, background: C.warnDim, border: `1px solid ${C.warn}44`,
            padding: '2px 8px', borderRadius: 2,
          }}>ADMIN</span>
          <span style={{
            fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: C.textDim, background: C.bgSurface, border: `1px solid ${C.border}`,
            padding: '2px 8px', borderRadius: 2,
          }}>{sources.length} sources</span>
        </div>
        <p style={{ color: C.textDim, fontSize: 13, margin: 0, fontFamily: fontInter }}>
          Gestion des sources de donnees importees — resumé IA, suppression, partage, export
        </p>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      {(() => {
        const tabs: { key: 'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris'; label: string; color: string }[] = [
          { key: 'all',      label: `Toutes (${sources.length})`,                                          color: C.accent },
          { key: 'poi',      label: `POI (${sources.filter((s) => s.type === 'poi').length})`,             color: '#8b5cf6' },
          { key: 'carreaux', label: `Carreaux (${sources.filter((s) => s.type === 'carreaux').length})`,  color: C.green },
          { key: 'panneaux', label: `OOH (${sources.filter((s) => s.type === 'panneaux').length})`,       color: C.warn },
          { key: 'iris',     label: 'IRIS IGN 2025',                                                       color: '#06b6d4' },
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
                  fontFamily: fontMichroma,
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: activeTab === tab.key ? 700 : 400,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Source info banner */}
                <div style={{ background: cyanDim, border: `1px solid ${cyanBorder}`, borderRadius: 2, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: fontOrbitron, fontSize: 13, fontWeight: 700, color: cyan, letterSpacing: 1, marginBottom: 4 }}>
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
                    <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: cyan, lineHeight: 1 }}>
                      {irisStats.total.toLocaleString('fr-FR')}
                    </div>
                    <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', color: C.textDim, textTransform: 'uppercase', marginTop: 4 }}>
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
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 14px' }}>
                      <div style={{ fontFamily: fontMichroma, fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                  {/* Types IRIS */}
                  <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                    <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: cyan, marginBottom: 12 }}>
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
                              <span style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.1em', color: C.textDim, background: C.bgSurface, border: `1px solid ${C.border}`, padding: '1px 5px', borderRadius: 1 }}>{code}</span>
                              <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec }}>{label}</span>
                            </div>
                            <span style={{ fontFamily: fontMono, fontSize: 11, color, fontWeight: 700 }}>{value.toLocaleString('fr-FR')} <span style={{ color: C.muted, fontSize: 9 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 4, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Top départements */}
                  <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                    <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: cyan, marginBottom: 12 }}>
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
                <div style={{ background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                  <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: cyan, marginBottom: 10 }}>
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
                      <div key={col} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: fontMono, fontSize: 11, color: C.text, fontWeight: 600 }}>{col}</span>
                        <span style={{ fontFamily: fontMichroma, fontSize: 7, color: type === 'GEOMETRY' ? C.green : C.accent, background: type === 'GEOMETRY' ? C.greenDim : C.accentDim, border: `1px solid ${type === 'GEOMETRY' ? `${C.green}44` : C.borderLight}`, padding: '1px 5px', borderRadius: 1, letterSpacing: '0.06em' }}>{type}</span>
                        <span style={{ fontFamily: fontInter, fontSize: 10, color: C.muted }}>{note}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                    Index: <span style={{ color: C.textDim }}>PRIMARY KEY (code_iris)</span> · <span style={{ color: C.green }}>GIST (geom)</span> · Taille index: {irisStats.index_size}
                  </div>
                </div>

                {/* Usage note */}
                <div style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 16px', fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
                  <span style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textSec, display: 'block', marginBottom: 6 }}>// utilisation</span>
                  Utilisé pour les analyses de <span style={{ color: C.accent }}>bassins de population</span> Filosofi.<br />
                  Jointure spatiale avec <span style={{ color: C.green }}>public.carreaux_filosofi</span> via <span style={{ color: cyan }}>ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
                  Requête type: <span style={{ color: C.text }}>SELECT code_iris, SUM(ind) FROM iris JOIN carreaux_filosofi ON ST_Intersects(...)</span>
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ── Sources list (non-IRIS tabs) ──────────────────────────────────── */}
      {activeTab !== 'iris' && (
      <div style={{ display: 'flex', gap: 16 }}>
        {/* ============================================================ */}
        {/* LEFT: Sources List */}
        {/* ============================================================ */}
        <div style={{ flex: 1, minWidth: 0 }}>
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
                      transition: 'border-color 0.15s',
                      background: selectedSource?.id === source.id ? 'rgba(168,85,247,0.05)' : C.bgElevated,
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
          <div style={{ width: 380, flexShrink: 0 }}>
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
                    <div key={label} style={{ padding: '8px 10px', background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2 }}>
                      <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: fontMono, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Info */}
                <div style={{
                  fontFamily: fontMono,
                  fontSize: 11,
                  background: C.bgSurface,
                  border: `1px solid ${C.border}`,
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
                    <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, padding: '8px 10px', background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}`, fontFamily: fontInter }}>
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
                          fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: C.green, background: C.greenDim, border: `1px solid ${C.green}44`,
                          padding: '2px 7px', borderRadius: 2,
                        }}>{f}</span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginBottom: 6, fontFamily: fontInter }}>Aucun filtre configure</div>
                  )}
                  {showFilterEdit && (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, marginTop: 4, background: C.bgSurface }}>
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
                      <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>
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
                            <span style={{ fontSize: 9, color: C.muted, fontFamily: fontMichroma, letterSpacing: '0.08em' }}>schema</span>
                          </label>
                        );
                      })}

                      {/* Metadata keys */}
                      <div style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginTop: 10, marginBottom: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
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
                                style={{ accentColor: '#8b5cf6' }}
                              />
                              <span style={{ color: isChecked ? '#8b5cf6' : C.textSec, flex: 1, fontFamily: fontMono }}>{field}</span>
                              <span style={{ fontSize: 9, color: C.muted, fontFamily: fontMichroma, letterSpacing: '0.08em' }}>meta</span>
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
                            fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: C.textDim, background: C.bgSurface, border: `1px solid ${C.border}`,
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
                    <label style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, display: 'block', marginBottom: 4 }}>Nom</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ ...inputStyle, marginBottom: 8 }}
                    />
                    <label style={{ fontFamily: fontMichroma, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, display: 'block', marginBottom: 4 }}>Organisation</label>
                    <select
                      value={editOrg}
                      onChange={(e) => setEditOrg(e.target.value)}
                      style={{ ...selectStyle, marginBottom: 10 }}
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
                    onClick={() => handleDelete(selectedSource.id)}
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
    </div>
  );
}

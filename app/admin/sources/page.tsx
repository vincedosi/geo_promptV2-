'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// Types
// ============================================================

interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: 'panneaux' | 'poi' | 'carreaux';
  category?: string;
  regie?: string;
  original_filename?: string;
  file_format?: string;
  row_count: number;
  valid_count: number;
  error_count: number;
  mapping?: Record<string, string>;
  geo_config?: Record<string, string>;
  ai_summary?: string;
  import_date: string;
  status: string;
  shared_with?: string[];
  organization_id?: string;
  organizations?: { name: string; slug: string };
}

interface Organization {
  id: string;
  name: string;
  slug: string;
}

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
  const colors: Record<string, string> = { poi: 'g-badge-purple', panneaux: 'g-badge-orange', carreaux: 'g-badge-green' };
  const label = type === 'poi'
    ? `POI${category ? ` — ${category}` : ''}`
    : type === 'panneaux'
      ? `Panneaux${regie ? ` — ${regie}` : ''}`
      : 'Carreaux INSEE';
  return <span className={`g-badge ${colors[type] || ''}`}>{label}</span>;
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

  // ============================================================
  // Fetch data
  // ============================================================

  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/sources');
      const data = await res.json();
      if (data.success) setSources(data.sources || []);
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/organizations');
      const data = await res.json();
      if (data.success) setOrganizations(data.organizations || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchSources();
    fetchOrgs();
  }, [fetchSources, fetchOrgs]);

  // ============================================================
  // Actions
  // ============================================================

  const handleGenerateSummary = async (sourceId: string) => {
    setIsGeneratingSummary(true);
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/summary`, { method: 'POST' });
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
      const res = await fetch(`/api/admin/sources/${sourceId}`, { method: 'DELETE' });
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
      const res = await fetch(`/api/admin/sources/${sourceId}`, {
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
      await fetch(`/api/admin/sources/${sourceId}`, {
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
      const res = await fetch(`/api/admin/sources/${selectedSource.id}`, {
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

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="genesis-content" style={{ maxWidth: 1100 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / sources</h1>
          <span className="g-badge g-badge-orange">ADMIN</span>
          <span className="g-badge">{sources.length} sources</span>
        </div>
        <p className="page-subtitle">Gestion des sources de donnees importees — resumé IA, suppression, partage, export</p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* ============================================================ */}
        {/* LEFT: Sources List */}
        {/* ============================================================ */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLoading ? (
            <div className="g-card"><div className="g-card-body" style={{ textAlign: 'center', padding: 40 }}><Spinner size={20} /> Chargement...</div></div>
          ) : sources.length === 0 ? (
            <div className="g-card"><div className="g-card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
              Aucune source de donnees.<br /><span style={{ fontSize: 12 }}>Importez des donnees via Import Universel</span>
            </div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="g-card"
                  onClick={() => { setSelectedSource(source); setShowEdit(false); }}
                  style={{
                    cursor: 'pointer',
                    borderColor: selectedSource?.id === source.id ? 'var(--accent)' : undefined,
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div className="g-card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', flex: 1 }}>{source.name}</span>
                      {typeBadge(source.type, source.category, source.regie)}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                      <span>{source.valid_count.toLocaleString()} lignes</span>
                      <span>{formatDate(source.import_date)}</span>
                      <span>{source.organizations?.name || '—'}</span>
                      {source.original_filename && <span>{source.original_filename}</span>}
                    </div>
                    {source.ai_summary && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {source.ai_summary}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* RIGHT: Detail Panel */}
        {/* ============================================================ */}
        {selectedSource && (
          <div style={{ width: 380, flexShrink: 0 }}>
            <div className="g-card" style={{ position: 'sticky', top: 16 }}>
              <div className="g-card-header">
                <span className="g-card-title" style={{ fontSize: 13 }}>source.detail</span>
                <button className="g-btn g-btn-ghost" onClick={() => setSelectedSource(null)} style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}>x</button>
              </div>
              <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Name + type */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>{selectedSource.name}</div>
                  {typeBadge(selectedSource.type, selectedSource.category, selectedSource.regie)}
                </div>

                {/* Stats */}
                <div className="g-grid-3">
                  <div className="stat-card" style={{ padding: 8 }}>
                    <div className="stat-label" style={{ fontSize: 10 }}>Valides</div>
                    <div className="stat-value" style={{ fontSize: 16, color: 'var(--green)' }}>{selectedSource.valid_count.toLocaleString()}</div>
                  </div>
                  <div className="stat-card" style={{ padding: 8 }}>
                    <div className="stat-label" style={{ fontSize: 10 }}>Total</div>
                    <div className="stat-value" style={{ fontSize: 16 }}>{selectedSource.row_count.toLocaleString()}</div>
                  </div>
                  <div className="stat-card" style={{ padding: 8 }}>
                    <div className="stat-label" style={{ fontSize: 10 }}>Erreurs</div>
                    <div className="stat-value" style={{ fontSize: 16, color: 'var(--red)' }}>{selectedSource.error_count}</div>
                  </div>
                </div>

                {/* Info */}
                <div className="g-code" style={{ fontSize: 11 }}>
                  <div><span style={{ color: 'var(--text-dim)' }}>org: </span><span style={{ color: 'var(--accent)' }}>{selectedSource.organizations?.name || '—'}</span></div>
                  <div><span style={{ color: 'var(--text-dim)' }}>fichier: </span>{selectedSource.original_filename || '—'}</div>
                  <div><span style={{ color: 'var(--text-dim)' }}>format: </span>{selectedSource.file_format || '—'}</div>
                  <div><span style={{ color: 'var(--text-dim)' }}>date: </span>{formatDate(selectedSource.import_date)}</div>
                </div>

                {/* AI Summary */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>// resume IA</span>
                    <button
                      className="g-btn g-btn-ghost"
                      onClick={() => handleGenerateSummary(selectedSource.id)}
                      disabled={isGeneratingSummary}
                      style={{ padding: '2px 8px', fontSize: 11 }}
                    >
                      {isGeneratingSummary ? <Spinner /> : selectedSource.ai_summary ? 'Regenerer' : 'Generer'}
                    </button>
                  </div>
                  {selectedSource.ai_summary ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '8px 10px', backgroundColor: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
                      {selectedSource.ai_summary}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>Pas de resume — cliquez Generer</div>
                  )}
                </div>

                {/* Sharing */}
                <div>
                  <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', marginBottom: 6 }}>// partage</div>
                  {(selectedSource.shared_with || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {selectedSource.shared_with!.map((orgId) => {
                        const org = organizations.find((o) => o.id === orgId);
                        return (
                          <span key={orgId} className="g-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {org?.name || orgId.slice(0, 8)}
                            <button onClick={() => handleUnshare(selectedSource.id, orgId)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0, fontSize: 12 }}>x</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="g-input" value={shareOrgId} onChange={(e) => setShareOrgId(e.target.value)} style={{ flex: 1, fontSize: 11 }}>
                      <option value="">Partager avec...</option>
                      {organizations.filter((o) => o.id !== selectedSource.organization_id && !(selectedSource.shared_with || []).includes(o.id)).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button className="g-btn g-btn-ghost" onClick={() => handleShare(selectedSource.id)} disabled={!shareOrgId} style={{ fontSize: 11 }}>Partager</button>
                  </div>
                </div>

                {/* Edit */}
                {showEdit && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', marginBottom: 6 }}>// modifier</div>
                    <label className="g-label" style={{ fontSize: 11 }}>Nom</label>
                    <input className="g-input" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ marginBottom: 6, fontSize: 12 }} />
                    <label className="g-label" style={{ fontSize: 11 }}>Organisation</label>
                    <select className="g-input" value={editOrg} onChange={(e) => setEditOrg(e.target.value)} style={{ marginBottom: 8, fontSize: 12 }}>
                      <option value="">— Ne pas changer —</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button className="g-btn g-btn-primary" onClick={handleSaveEdit} style={{ fontSize: 12, width: '100%' }}>Sauvegarder</button>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button className="g-btn g-btn-ghost" onClick={() => handleExport(selectedSource.id)} style={{ fontSize: 12, justifyContent: 'flex-start' }}>
                    Exporter CSV
                  </button>
                  <button className="g-btn g-btn-ghost" onClick={() => { setShowEdit(!showEdit); setEditName(selectedSource.name); setEditOrg(''); }} style={{ fontSize: 12, justifyContent: 'flex-start' }}>
                    {showEdit ? 'Annuler modification' : 'Modifier'}
                  </button>
                  <button className="g-btn g-btn-ghost" onClick={() => window.open('/admin/import', '_self')} style={{ fontSize: 12, justifyContent: 'flex-start' }}>
                    Re-importer (meme config)
                  </button>
                  <button
                    className="g-btn g-btn-danger"
                    onClick={() => handleDelete(selectedSource.id)}
                    disabled={isDeleting}
                    style={{ fontSize: 12, justifyContent: 'flex-start' }}
                  >
                    {isDeleting ? <><Spinner /> Suppression...</> : 'Supprimer source + donnees'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

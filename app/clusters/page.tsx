'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FEATURE_THEMES } from '@/lib/clustering/feature-themes';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:      '#050505',
  bgPanel: '#08080f',
  bgCard:  '#0c0c18',
  border:  '#261a35',
  accent:  '#a855f7',
  green:   '#3dffa0',
  amber:   '#f59e0b',
  red:     '#f87171',
  text:    '#e2e8f0',
  muted:   '#8888aa',
  dim:     '#6b7280',
};
const fMono     = "'JetBrains Mono','Fira Mono',monospace";
const fMichroma = "'Michroma','Orbitron',sans-serif";
const fOrbitron = "'Orbitron',sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ModelSummary {
  version:           number;
  k:                 number;
  silhouette_score:  number;
  n_pca_components:  number;
  variance_explained: number;
  n_poi_trained:     number;
  duration_minutes:  number;
  mode:              string;
  created_at:        string;
  cluster_labels:    Record<string, string>;
  cluster_avg_profiles: Record<string, Record<string, number>>;
  feature_names:     string[];
  feature_themes:    string[] | null;
}

// ─── Silhouette badge ────────────────────────────────────────────────────────
function SilhouetteBadge({ score }: { score: number }) {
  const color = score >= 0.5 ? C.green : score >= 0.3 ? C.amber : C.red;
  const label = score >= 0.5 ? 'EXCELLENT' : score >= 0.3 ? 'BON' : 'FAIBLE';
  return (
    <span style={{
      fontSize: 9, fontFamily: fMichroma, letterSpacing: '0.08em',
      color, border: `1px solid ${color}40`, borderRadius: 2,
      padding: '2px 5px', marginLeft: 6,
    }}>
      {label}
    </span>
  );
}

// ─── Mini bar showing cluster distribution ────────────────────────────────────
function ClusterMiniBar({
  labels, avg_profiles, feature_names,
}: {
  labels:        Record<string, string>;
  avg_profiles:  Record<string, Record<string, number>>;
  feature_names: string[];
}) {
  const cids = Object.keys(labels).sort((a, b) => Number(a) - Number(b));
  if (!cids.length) return null;

  const COLORS = ['#4e79a7','#f28e2b','#59a14f','#e15759','#76b7b2','#edc948','#b07aa1','#ff9da7'];

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {cids.map((cid, i) => (
        <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 8, height: 8, borderRadius: 1,
            background: COLORS[i % COLORS.length],
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 10, fontFamily: fMono, color: C.muted }}>
            {labels[cid] ?? `C${cid}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Model card ───────────────────────────────────────────────────────────────
function ModelCard({
  model, isLatest, onDelete,
}: {
  model:    ModelSummary;
  isLatest: boolean;
  onDelete: (m: ModelSummary) => void;
}) {
  const date = new Date(model.created_at);
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ position: 'relative' }}>
      <Link href={`/clusters/${model.version}`} style={{ textDecoration: 'none', display: 'block' }}>
        <div style={{
          background: C.bgCard,
          border: `1px solid ${isLatest ? C.accent + '60' : C.border}`,
          borderRadius: 2,
          padding: '16px 20px',
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent + '80')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = isLatest ? C.accent + '60' : C.border)}
        >
          {isLatest && (
            <div style={{
              position: 'absolute', top: 12, right: 44,
              fontSize: 9, fontFamily: fMichroma, letterSpacing: '0.1em',
              color: C.accent, background: C.accent + '15',
              border: `1px solid ${C.accent}40`, borderRadius: 2,
              padding: '2px 6px',
            }}>
              LATEST
            </div>
          )}

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, paddingRight: 28 }}>
            <span style={{ fontFamily: fMono, fontSize: 11, color: C.dim }}>v</span>
            <span style={{ fontFamily: fOrbitron, fontSize: 22, color: C.text, letterSpacing: '-0.02em' }}>
              {model.version}
            </span>
            <SilhouetteBadge score={model.silhouette_score} />
            {model.feature_themes && model.feature_themes.length > 0 && model.feature_themes.length < 4 && (
              <span style={{
                fontSize: 9, fontFamily: fMichroma, letterSpacing: '0.07em',
                color: '#10b981', border: '1px solid #10b98130', borderRadius: 2,
                padding: '2px 5px', marginLeft: 2,
              }}>
                {model.feature_themes.map(t => FEATURE_THEMES[t as keyof typeof FEATURE_THEMES]?.label ?? t).join(' + ')}
              </span>
            )}
          </div>

          {/* Metrics row */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
            {[
              { lbl: 'CLUSTERS',  val: String(model.k) },
              { lbl: 'SILHOUETTE', val: model.silhouette_score.toFixed(3) },
              { lbl: 'POI',       val: String(model.n_poi_trained) },
              { lbl: 'PCA',       val: `${model.n_pca_components}c / ${(model.variance_explained * 100).toFixed(0)}%` },
              { lbl: 'ISOCHRONE', val: `${model.duration_minutes}min ${model.mode}` },
            ].map(({ lbl, val }) => (
              <div key={lbl} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 8, fontFamily: fMichroma, letterSpacing: '0.08em', color: C.dim }}>
                  {lbl}
                </span>
                <span style={{ fontSize: 12, fontFamily: fMono, color: C.text }}>
                  {val}
                </span>
              </div>
            ))}
          </div>

          {/* Cluster labels */}
          <ClusterMiniBar
            labels={model.cluster_labels ?? {}}
            avg_profiles={model.cluster_avg_profiles ?? {}}
            feature_names={model.feature_names ?? []}
          />

          {/* Footer */}
          <div style={{ marginTop: 10, fontSize: 10, fontFamily: fMono, color: C.dim }}>
            {dateStr} à {timeStr}
            <span style={{ marginLeft: 8, color: C.accent + '80' }}>→ Voir l'analyse</span>
          </div>
        </div>
      </Link>

      {/* Delete button — outside Link to avoid navigating */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(model); }}
        title="Supprimer ce modèle"
        style={{
          position: 'absolute', top: 10, right: 10,
          width: 26, height: 26,
          background: 'transparent',
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.dim,
          transition: 'border-color 0.15s, color 0.15s',
          padding: 0,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = C.red + '80';
          (e.currentTarget as HTMLButtonElement).style.color = C.red;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
          (e.currentTarget as HTMLButtonElement).style.color = C.dim;
        }}
      >
        {/* Trash icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
    </div>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────
function DeleteModal({
  model, onCancel, onConfirm, deleting, error,
}: {
  model:     ModelSummary;
  onCancel:  () => void;
  onConfirm: () => void;
  deleting:  boolean;
  error:     string | null;
}) {
  const date = new Date(model.created_at);
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(5,5,5,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(2px)',
    }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: C.bgCard,
        border: `1px solid ${C.red}50`,
        borderRadius: 2,
        padding: '28px 32px',
        width: 420,
        maxWidth: 'calc(100vw - 40px)',
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ fontFamily: fMichroma, fontSize: 13, letterSpacing: '0.08em', color: C.red }}>
            SUPPRIMER LE MODÈLE
          </span>
        </div>

        {/* Model info */}
        <div style={{
          background: C.bgPanel,
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '12px 16px',
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            <span style={{ fontFamily: fMono, fontSize: 10, color: C.dim }}>version</span>
            <span style={{ fontFamily: fOrbitron, fontSize: 20, color: C.text }}>{model.version}</span>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { lbl: 'CLUSTERS', val: String(model.k) },
              { lbl: 'POI',      val: String(model.n_poi_trained) },
              { lbl: 'DATE',     val: dateStr },
            ].map(({ lbl, val }) => (
              <div key={lbl} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 8, fontFamily: fMichroma, letterSpacing: '0.08em', color: C.dim }}>{lbl}</span>
                <span style={{ fontSize: 11, fontFamily: fMono, color: C.muted }}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Warning text */}
        <div style={{ fontFamily: fMono, fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>
          Cette action supprimera définitivement le modèle, tous ses clusters POI et l'historique associé.
        </div>
        <div style={{ fontFamily: fMichroma, fontSize: 10, letterSpacing: '0.06em', color: C.red + 'cc', marginBottom: 24 }}>
          ! CETTE ACTION EST IRRÉVERSIBLE
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontFamily: fMono, fontSize: 11, color: C.red,
            background: C.red + '10', border: `1px solid ${C.red}30`,
            borderRadius: 2, padding: '8px 12px', marginBottom: 16,
          }}>
            ! {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              fontFamily: fMichroma, fontSize: 10, letterSpacing: '0.08em',
              color: C.muted, background: 'transparent',
              border: `1px solid ${C.border}`, borderRadius: 2,
              padding: '8px 16px', cursor: 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            ANNULER
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              fontFamily: fMichroma, fontSize: 10, letterSpacing: '0.08em',
              color: '#050505', background: deleting ? C.red + '60' : C.red,
              border: `1px solid ${C.red}`, borderRadius: 2,
              padding: '8px 16px', cursor: deleting ? 'default' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {deleting ? 'SUPPRESSION...' : 'SUPPRIMER ✕'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ClustersIndexPage() {
  const [models, setModels]   = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Delete state
  const [confirmModel, setConfirmModel] = useState<ModelSummary | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [deleteError, setDeleteError]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/poi-clusters/models')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setModels(d.models ?? []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleDeleteRequest = useCallback((m: ModelSummary) => {
    setConfirmModel(m);
    setDeleteError(null);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    if (deleting) return;
    setConfirmModel(null);
    setDeleteError(null);
  }, [deleting]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmModel || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/poi-clusters/models/${confirmModel.version}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? `Erreur ${res.status}`);
      } else {
        setModels(prev => prev.filter(m => m.version !== confirmModel.version));
        setConfirmModel(null);
      }
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }, [confirmModel, deleting]);

  return (
    <div style={{ padding: '32px 32px 48px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.5">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <h1 style={{
            fontFamily: fOrbitron, fontSize: 20, fontWeight: 700,
            color: C.text, letterSpacing: '0.04em', margin: 0,
          }}>
            CLUSTERING RÉSULTATS
          </h1>
        </div>
        <p style={{ fontFamily: fMono, fontSize: 11, color: C.muted, margin: 0 }}>
          Modèles socio-démographiques Filosofi — {models.length} version{models.length > 1 ? 's' : ''} disponible{models.length > 1 ? 's' : ''}
        </p>
      </div>

      {/* Content */}
      {loading && (
        <div style={{ fontFamily: fMono, fontSize: 12, color: C.muted, textAlign: 'center', padding: 40 }}>
          Chargement...
        </div>
      )}

      {error && (
        <div style={{
          fontFamily: fMono, fontSize: 12, color: C.red,
          background: C.red + '10', border: `1px solid ${C.red}30`,
          borderRadius: 2, padding: '12px 16px',
        }}>
          ! {error}
        </div>
      )}

      {!loading && !error && models.length === 0 && (
        <div style={{
          fontFamily: fMono, fontSize: 12, color: C.muted,
          background: C.bgPanel, border: `1px solid ${C.border}`,
          borderRadius: 2, padding: '24px 20px', textAlign: 'center',
        }}>
          <div style={{ marginBottom: 8 }}>Aucun modèle de clustering disponible.</div>
          <div style={{ color: C.dim, fontSize: 11 }}>
            Lancez un clustering depuis la <Link href="/map" style={{ color: C.accent, textDecoration: 'none' }}>Carte</Link>.
          </div>
        </div>
      )}

      {!loading && models.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {models.map((m, i) => (
            <ModelCard
              key={m.version}
              model={m}
              isLatest={i === 0}
              onDelete={handleDeleteRequest}
            />
          ))}
        </div>
      )}

      {/* Confirmation modal */}
      {confirmModel && (
        <DeleteModal
          model={confirmModel}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          deleting={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}

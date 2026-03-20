'use client';

import React, { useState, useEffect } from 'react';
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
function ModelCard({ model, isLatest }: { model: ModelSummary; isLatest: boolean }) {
  const date = new Date(model.created_at);
  const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <Link href={`/clusters/${model.version}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: C.bgCard,
        border: `1px solid ${isLatest ? C.accent + '60' : C.border}`,
        borderRadius: 2,
        padding: '16px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        position: 'relative',
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent + '80')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = isLatest ? C.accent + '60' : C.border)}
      >
        {isLatest && (
          <div style={{
            position: 'absolute', top: 12, right: 12,
            fontSize: 9, fontFamily: fMichroma, letterSpacing: '0.1em',
            color: C.accent, background: C.accent + '15',
            border: `1px solid ${C.accent}40`, borderRadius: 2,
            padding: '2px 6px',
          }}>
            LATEST
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
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
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ClustersIndexPage() {
  const [models, setModels]   = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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
            <ModelCard key={m.version} model={m} isLatest={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

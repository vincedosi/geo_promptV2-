'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft } from 'lucide-react';
import type { ClusterGeoJSON } from '@/app/map/_components/ClusterPanel';

const ClusterPanel = dynamic(
  () => import('@/app/map/_components/ClusterPanel').then(m => ({ default: m.ClusterPanel })),
  { ssr: false },
);

const ClusterDetails = dynamic(
  () => import('@/components/ClusterDetails').then(m => ({ default: m.ClusterDetails })),
  { ssr: false },
);

interface ClusterModelSummary {
  version: number;
  k: number;
  silhouette_score: number;
  n_poi_trained: number;
  duration_minutes: number;
  mode: string;
  created_at: string;
  cluster_labels: Record<string, string>;
}

interface Props {
  geojson: ClusterGeoJSON | null;
  visible: boolean;
  loading: boolean;
  duration: number;
  onToggle: () => void;
  onLoad: () => void;
  onDurationChange: (d: number) => void;
  onFlyTo: (lat: number, lng: number, zoom?: number) => void;
  onFitBounds: (bounds: [[number, number], [number, number]]) => void;
  onWizardHighlight?: (poiTypes: string[], metropolitaine: boolean) => void;
  onWizardClose?: () => void;
}

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

export function ClusteringResultsContent(props: Props) {
  const [models, setModels] = useState<ClusterModelSummary[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    setLoadingModels(true);
    fetch('/api/poi-clusters/models')
      .then(r => r.json())
      .then(d => { if (d.models) setModels(d.models); })
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, [refreshKey]);

  // ── Vue : détails d'un modèle existant (clic sur card) ──────────────────
  if (selectedVersion !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <button
          type="button"
          onClick={() => setSelectedVersion(null)}
          style={{
            background: 'none', border: 'none',
            padding: '10px 16px',
            borderBottom: '0.5px solid var(--border-subtle)',
            cursor: 'pointer',
            fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 6,
            flexShrink: 0,
            transition: 'color 150ms var(--ease-hover, ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
          Liste des modèles
        </button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <ClusterDetails version={selectedVersion} onClose={() => setSelectedVersion(null)} />
        </div>
      </div>
    );
  }

  // ── Vue : wizard (création nouveau clustering) ──────────────────────────
  if (showWizard) {
    return (
      <div style={{ padding: 12 }}>
        <button
          type="button"
          onClick={() => { setShowWizard(false); setRefreshKey(k => k + 1); }}
          style={{
            background: 'none', border: 'none',
            padding: '6px 8px', cursor: 'pointer',
            fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 4,
            marginBottom: 8,
            transition: 'color 150ms var(--ease-hover, ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <ChevronLeft size={14} strokeWidth={1.5} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
          {' '}Liste des modèles
        </button>
        <ClusterPanel {...props} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'none' }}>
        Modèles calculés
      </div>

      {loadingModels && (
        <div style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 0', textAlign: 'center' }}>
          Chargement...
        </div>
      )}

      {!loadingModels && models.length === 0 && (
        <div style={{
          fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
          padding: '14px', textAlign: 'center',
          background: 'var(--bg-level-2)',
          border: '0.5px dashed var(--border-default)',
          borderRadius: 6, lineHeight: 1.5,
        }}>
          Aucun modèle calculé pour le moment.
          <br />
          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
            Lance ton premier clustering ci-dessous.
          </span>
        </div>
      )}

      {!loadingModels && models.length > 0 && (
        <div className="stagger-children" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {models.map(m => {
            const silColor = m.silhouette_score >= 0.5 ? 'var(--success)' : m.silhouette_score >= 0.3 ? 'var(--warning)' : 'var(--danger)';
            const dateStr  = new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            return (
              <button
                key={m.version}
                type="button"
                onClick={() => setSelectedVersion(m.version)}
                style={{
                  background: 'var(--bg-level-2)',
                  border: '0.5px solid var(--border-subtle)',
                  borderRadius: 6,
                  padding: '12px 14px',
                  textAlign: 'left', cursor: 'pointer',
                  transition: 'border-color 200ms var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-teal-30, rgba(78,205,196,0.3))'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontFamily: fMono, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    v{m.version}
                  </span>
                  <span style={{ fontFamily: fMono, fontSize: 10, color: silColor, border: `1px solid ${silColor}40`, borderRadius: 3, padding: '1px 5px' }}>
                    SIL {m.silhouette_score.toFixed(3)}
                  </span>
                  <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {dateStr}
                  </span>
                </div>
                <div style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-secondary)' }}>
                  {m.k} clusters · {m.n_poi_trained} POI · {m.duration_minutes}min {m.mode}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowWizard(true)}
        style={{
          background: 'transparent',
          border: '0.5px solid var(--brand-teal)',
          color: 'var(--brand-teal)',
          borderRadius: 6,
          padding: '10px 14px',
          fontFamily: fInter,
          fontSize: 13, fontWeight: 500,
          cursor: 'pointer',
          transition: 'background-color 180ms var(--ease-out)',
          marginTop: models.length > 0 ? 4 : 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        + Nouveau clustering
      </button>

    </div>
  );
}

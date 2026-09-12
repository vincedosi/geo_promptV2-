'use client';

/**
 * Accordéon « Clustering » de la catégorie Analyses : liste des modèles
 * k-means calculés, lancement d'un nouveau calcul, et ouverture du rapport
 * détaillé en tiroir.
 *
 * ── Pourquoi ce fichier existe, alors que le code venait de FilterPanel ─────
 *
 * La feature a été supprimée le 2026-07-05, et restaurée le 2026-09-12. Entre
 * les deux, `FilterPanel.tsx` a été découpé : chaque bloc vit désormais dans
 * son propre `*Section.tsx` (IrisSection, CarreauxSection, TmjaSection…).
 * Réinjecter les 125 lignes d'accordéon dans le monolithe aurait restauré le
 * code ET la dette qu'on venait d'en retirer.
 *
 * Ce qui N'A PAS été restauré, et c'est délibéré :
 *   · la page autonome `/clusters` — la règle du projet est « tout passe par
 *     /map et ses overlays, pas de page métier standalone » ;
 *   · l'agent smart-prompt `poi_clustering` — `detectSmartMode()` rend `false`
 *     sans condition depuis la V2 : c'était du code mort avant même la
 *     suppression.
 */

import React, { useEffect, useState } from 'react';
import { ClusterPanel, type ClusterGeoJSON } from '../ClusterPanel';
import { ClusterResultsOverlay } from '@/components/ClusterResultsOverlay';
import { C, fInter, fMono } from './tokens';

/** Une ligne de `/api/poi-clusters/models`. */
interface ClusterModelSummary {
  version:          number;
  k:                number;
  silhouette_score: number;
  n_poi_trained:    number;
  duration_minutes: number;
  mode:             string;
  created_at:       string;
}

export interface ClusteringSectionProps {
  analyseOpen: Record<string, boolean>;
  toggleAnalyse: (key: string) => void;

  clusterGeoJSON?:          ClusterGeoJSON | null;
  clustersVisible?:         boolean;
  clusterLoading?:          boolean;
  clusterDuration?:         number;
  onToggleClusters?:        () => void;
  onLoadClusters?:          () => void;
  onClusterDurationChange?: (d: number) => void;
  onFlyTo?:                 (lat: number, lng: number, zoom?: number) => void;
  onFitBounds?:             (bounds: [[number, number], [number, number]]) => void;
  onWizardHighlight?:       (poiTypes: string[], metropolitaine: boolean) => void;
  onWizardClose?:           () => void;
  /** Garde de périmètre (spec §5) — relayée jusqu'à ClusteringWizard sans
   *  aucune logique ici (round 2 de correction, Tâche 7, 2026-09-12). */
  verifierPerimetre?:       () => boolean;
}

export function ClusteringSection({
  analyseOpen,
  toggleAnalyse,
  clusterGeoJSON,
  clustersVisible,
  clusterLoading,
  clusterDuration,
  onToggleClusters,
  onLoadClusters,
  onClusterDurationChange,
  onFlyTo,
  onFitBounds,
  onWizardHighlight,
  onWizardClose,
  verifierPerimetre,
}: ClusteringSectionProps) {
  const [modeles, setModeles] = useState<ClusterModelSummary[]>([]);
  const [versionOuverte, setVersionOuverte] = useState<number | null>(null);
  const [nouveauCalcul, setNouveauCalcul] = useState(false);
  const [chargement, setChargement] = useState(false);

  // Chargé à l'ouverture de l'accordéon, jamais au montage du panneau : la
  // liste des modèles n'intéresse personne tant que la section est repliée.
  useEffect(() => {
    if (!analyseOpen.clustering) return;
    setChargement(true);
    fetch('/api/poi-clusters/models')
      .then(r => r.ok ? r.json() as Promise<{ models?: ClusterModelSummary[] }> : null)
      .then(d => { if (d?.models) setModeles(d.models); })
      .catch(() => { /* la liste reste vide, l'écran le dit */ })
      .finally(() => setChargement(false));
  }, [analyseOpen.clustering]);

  return (
    <>
      <button
        onClick={() => toggleAnalyse('clustering')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--bg-level-2)',
          border: 'none', borderTop: '1px solid var(--border-subtle)',
          borderLeft: '2px solid rgba(78,205,196,0.25)',
          borderBottom: `0.5px solid ${C.border}`, cursor: 'pointer',
          transition: 'background-color 180ms var(--ease-out)',
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Clustering
          {clustersVisible && <span style={{ color: C.green, marginLeft: 6 }}>●</span>}
        </span>
        <span style={{ color: C.textDim, fontSize: 10 }}>{analyseOpen.clustering ? '▲' : '▼'}</span>
      </button>

      {analyseOpen.clustering && (
        <div style={{ borderBottom: `0.5px solid ${C.border}` }}>
          {!nouveauCalcul ? (
            <div style={{ padding: '10px 12px' }}>
              {modeles.map(m => {
                const couleurSil = m.silhouette_score >= 0.5 ? 'var(--success)'
                  : m.silhouette_score >= 0.3 ? 'var(--warning)' : 'var(--danger)';
                const date = new Date(m.created_at).toLocaleDateString('fr-FR', {
                  day: '2-digit', month: '2-digit', year: '2-digit',
                });
                return (
                  <div
                    key={m.version}
                    onClick={() => setVersionOuverte(m.version)}
                    style={{
                      background: 'var(--bg-level-2)',
                      border: '0.5px solid var(--border-subtle)',
                      borderRadius: 6, padding: '10px 12px', marginBottom: 6,
                      cursor: 'pointer', transition: 'border-color 200ms var(--ease-out)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--brand-teal-30)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontFamily: fMono, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                        v{m.version}
                      </span>
                      {/* La silhouette dit si les clusters se tiennent. En dessous
                          de 0,3 le découpage ne veut pas dire grand-chose — autant
                          que ça se voie au premier coup d'œil. */}
                      <span style={{ fontFamily: fMono, fontSize: 9, color: couleurSil, border: `1px solid ${couleurSil}40`, borderRadius: 2, padding: '1px 4px' }}>
                        SIL {m.silhouette_score.toFixed(3)}
                      </span>
                      <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                        {date}
                      </span>
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-secondary)' }}>
                      {m.k} clusters · {m.n_poi_trained} POI · {m.duration_minutes}min {m.mode}
                    </div>
                  </div>
                );
              })}

              {modeles.length === 0 && (
                <div style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 0', textAlign: 'center' }}>
                  {chargement ? 'Chargement…' : 'Aucun modèle calculé'}
                </div>
              )}

              <button
                onClick={() => setNouveauCalcul(true)}
                style={{
                  width: '100%', background: 'transparent',
                  border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
                  borderRadius: 6, padding: '8px 16px',
                  fontFamily: fInter, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  transition: 'background-color 180ms var(--ease-out)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(78,205,196,0.1)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                + Nouveau clustering
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setNouveauCalcul(false)}
                style={{
                  display: 'block', width: '100%', background: 'none', border: 'none',
                  borderBottom: '0.5px solid var(--border-subtle)',
                  padding: '8px 12px', cursor: 'pointer',
                  fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'left',
                }}
              >
                ← Liste des modèles
              </button>
              <div style={{ minHeight: 400 }}>
                <ClusterPanel
                  geojson={clusterGeoJSON ?? null}
                  visible={clustersVisible ?? false}
                  loading={clusterLoading ?? false}
                  duration={clusterDuration ?? 60}
                  onToggle={onToggleClusters ?? (() => {})}
                  onLoad={onLoadClusters ?? (() => {})}
                  onDurationChange={onClusterDurationChange ?? (() => {})}
                  onFlyTo={onFlyTo ?? (() => {})}
                  onFitBounds={onFitBounds ?? (() => {})}
                  onWizardHighlight={onWizardHighlight}
                  onWizardClose={onWizardClose}
                  verifierPerimetre={verifierPerimetre}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {versionOuverte !== null && (
        <ClusterResultsOverlay
          version={versionOuverte}
          onClose={() => setVersionOuverte(null)}
        />
      )}
    </>
  );
}

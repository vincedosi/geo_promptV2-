'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FEATURE_THEMES, featureSelectionLabel } from '@/lib/clustering/feature-themes';
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { ClusterRadar, FEAT_SHORT, FEAT_LABEL } from '@/components/ClusterRadar';
import type { GeminiAnalysis } from '@/components/ClusteringPDFReport';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:      '#050505',
  bgPanel: '#0a0a0a',
  bgCard:  '#0a0a0a',
  bgRow:   '#0a0a0a',
  border:  '#1a1a1a',
  accent:  '#4ecdc4',
  green:   '#3dffa0',
  amber:   '#f59e0b',
  red:     '#f87171',
  text:    '#f0f0f0',
  muted:   '#a0a0a0',
  dim:     '#666666',
};
const fMono  = "'JetBrains Mono','Fira Mono',monospace";
const fInter = "'Inter', system-ui, sans-serif";

const CLUSTER_COLORS = [
  '#4ecdc4','#a0a0a0','#5b9bd5','#f7b731',
  '#3dffa0','#ff9da7','#b07aa1','#edc948',
  '#9c755f','#bab0ac',
];

// ─── Recharts shared axis props ───────────────────────────────────────────────
const axisStyle = { fontSize: 11, fontFamily: fInter, fill: C.muted };
const gridStyle = { stroke: C.border, strokeDasharray: '3 3' };

// ─── Types ────────────────────────────────────────────────────────────────────
interface ModelDetail {
  version:             number;
  k:                   number;
  silhouette_score:    number;
  n_pca_components:    number;
  variance_explained:  number;
  feature_names:       string[];
  feature_themes:      string[] | null;
  cluster_labels:      Record<string, string>;
  cluster_avg_profiles: Record<string, Record<string, number>>;
  n_poi_trained:       number;
  duration_minutes:    number;
  mode:                string;
  created_at:          string;
  cluster_mapping_from_previous: Record<string, number> | null;
}

interface ClusterSummary {
  label:       string;
  count:       number;
  color:       string;
  avg_profile: Record<string, number>;
}


interface PoiRecord {
  poi_id:                     string;
  poi_name:                   string;
  categorie:                  string;
  ville:                      string;
  lat?:                       number;
  lng?:                       number;
  cluster_id:                 number;
  cluster_label:              string;
  cluster_color:              string;
  profile_features:           Record<string, number>;
  pca_components:             number[];
  n_carreaux_intersected?:    number;
  population_totale_couverte?: number;
  imputed_features:           string[];
  duration_minutes:           number;
  mode:                       string;
}

interface FranceAverages {
  [feature: string]: { avg: number; std: number; min: number; max: number; n_carreaux: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function revenusIndex(val: number, avg: number) {
  if (!avg) return null;
  return Math.round((val / avg) * 100);
}

function fmtVal(feat: string, v: number) {
  if (feat === 'surface_moyenne') return `${v.toFixed(1)} m²`;
  return pct(v);
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'resume',       label: 'Résumé' },
  { id: 'carte',        label: 'Carte' },
  { id: 'profils',      label: 'Profils' },
  { id: 'comparaison',  label: 'Comparaison' },
  { id: 'qualite',      label: 'Qualité' },
  { id: 'methodologie', label: 'Méthodologie' },
  { id: 'historique',   label: 'Historique' },
] as const;
type TabId = typeof TABS[number]['id'];

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, overflow: 'auto' }}>
      {TABS.map(t => {
        const isActive = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 18px',
            fontFamily: fInter, fontSize: 12,
            color:        isActive ? C.accent : C.dim,
            borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
            transition: 'color 0.15s', whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────
function Panel({ title, children, fullWidth }: {
  title?: string; children: React.ReactNode; fullWidth?: boolean;
}) {
  return (
    <div style={{
      background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20,
      gridColumn: fullWidth ? '1 / -1' : undefined,
    }}>
      {title && (
        <div style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text, marginBottom: 14 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Recharts custom tooltip (dark) ──────────────────────────────────────────
function DarkTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2,
      padding: '8px 12px', fontFamily: fMono, fontSize: 10,
    }}>
      {label && <div style={{ color: C.muted, marginBottom: 4, fontSize: 9 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color ?? C.text, display: 'flex', gap: 8 }}>
          <span style={{ color: C.muted }}>{p.name}:</span>
          <span>{formatter ? formatter(p.value, p.name, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── FeatureRow (kept for Profils table) ─────────────────────────────────────
function FeatureRow({ feat, values, franceAvg, refRevenusAvg }: {
  feat: string;
  values: { cid: string; val: number; color: string }[];
  franceAvg?: number;
  refRevenusAvg?: number;
}) {
  const all = values.map(v => v.val);
  if (franceAvg !== undefined) all.push(franceAvg);
  const max   = Math.max(...all, 0.001);
  const label = FEAT_SHORT[feat] ?? feat;

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}20` }}>
      <td style={{ padding: '6px 8px', fontFamily: fInter, fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
        {label}
      </td>
      {values.map((v) => {
        const isRevenu = feat === 'revenu_moyen';
        const idx = (isRevenu && refRevenusAvg) ? revenusIndex(v.val, refRevenusAvg) : null;
        return (
          <td key={v.cid} style={{ padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 1, position: 'relative', minWidth: 60 }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${Math.min(100, (v.val / max) * 100)}%`,
                  background: v.color + 'aa', borderRadius: 1,
                }} />
                {franceAvg !== undefined && (
                  <div style={{
                    position: 'absolute', top: -1, bottom: -1,
                    left: `${Math.min(100, (franceAvg / max) * 100)}%`,
                    width: 1, background: '#6b7280',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 9, fontFamily: fMono, color: C.text, whiteSpace: 'nowrap' }}>
                {feat === 'surface_moyenne' ? `${v.val.toFixed(1)}m²` : pct(v.val)}
              </span>
              {idx !== null && (
                <span style={{
                  fontSize: 8, fontFamily: fMono,
                  color: idx >= 110 ? C.green : idx <= 90 ? C.red : C.amber,
                  background: (idx >= 110 ? C.green : idx <= 90 ? C.red : C.amber) + '15',
                  border: `1px solid ${(idx >= 110 ? C.green : idx <= 90 ? C.red : C.amber)}30`,
                  borderRadius: 2, padding: '1px 4px',
                }}>
                  {idx}
                </span>
              )}
            </div>
          </td>
        );
      })}
      {franceAvg !== undefined && (
        <td style={{ padding: '6px 8px', fontSize: 9, fontFamily: fMono, color: C.dim }}>
          {feat === 'surface_moyenne' ? `${franceAvg.toFixed(1)}m²` : pct(franceAvg)}
        </td>
      )}
    </tr>
  );
}

// ─── Tab: Résumé ─────────────────────────────────────────────────────────────
function TabResume({ model, summary, franceAvg }: {
  model:     ModelDetail;
  summary:   Record<string, ClusterSummary>;
  franceAvg: FranceAverages | null;
}) {
  const cids  = Object.keys(summary).sort((a, b) => Number(a) - Number(b));
  const total = cids.reduce((acc, c) => acc + (summary[c]?.count ?? 0), 0);

  // Donut data
  const donutData = cids.map((c, i) => ({
    name:  summary[c]?.label ?? `C${c}`,
    value: summary[c]?.count ?? 0,
    color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
  }));

  // Bar data (horizontal)
  const barData = cids.map((c, i) => ({
    name:  summary[c]?.label ?? `C${c}`,
    count: summary[c]?.count ?? 0,
    color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
  }));

  const createdAt = new Date(model.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Model stats */}
      <Panel title={`Modèle v${model.version}`}>
        {[
          ['Clusters (K)',       model.k],
          ['Silhouette',         model.silhouette_score.toFixed(4)],
          ['Variables',          featureSelectionLabel(model.feature_names)],
          ['PCA composantes',    model.n_pca_components],
          ['Variance expliquée', pct(model.variance_explained)],
          ['POI entraînés',      model.n_poi_trained],
          ['Isochrone',          `${model.duration_minutes} min ${model.mode}`],
          ['Créé le',            createdAt],
        ].map(([k, v]) => (
          <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}20` }}>
            <span style={{ fontFamily: fInter, fontSize: 11, color: C.muted }}>{k}</span>
            <span style={{ fontFamily: fMono, fontSize: 11, color: C.text }}>{v}</span>
          </div>
        ))}
      </Panel>

      {/* Donut chart */}
      <Panel title="Répartition des clusters">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={donutData} dataKey="value"
              innerRadius={55} outerRadius={85}
              paddingAngle={2}
              label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {donutData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <RTooltip
              content={<DarkTooltip formatter={(v: number, name: string) =>
                `${v} POI (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`
              } />}
            />
            <Legend
              formatter={(value) => (
                <span style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.dim, textAlign: 'center', marginTop: 4 }}>
          {total} POI classifiés
        </div>
      </Panel>

      {/* Bar chart horizontal */}
      <Panel title="Distribution — nb POI par cluster">
        <ResponsiveContainer width="100%" height={Math.max(120, cids.length * 36 + 20)}>
          <BarChart layout="vertical" data={barData} margin={{ top: 0, right: 40, bottom: 0, left: 4 }}>
            <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={140} tick={axisStyle} axisLine={false} tickLine={false} />
            <RTooltip content={<DarkTooltip formatter={(v: number) => `${v} POI`} />} />
            <Bar dataKey="count" radius={[0, 2, 2, 0]} isAnimationActive={barData.length > 100}>
              {barData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* Radar overview */}
      <Panel title="Profils moyens — vue d'ensemble" fullWidth>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ClusterRadar
            profiles={cids.map(c => summary[c]?.avg_profile ?? {})}
            colors={cids.map((_, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length])}
            labels={cids.map(c => summary[c]?.label ?? `C${c}`)}
            featureKeys={model.feature_names.length > 0 ? model.feature_names : Object.keys(FEAT_SHORT)}
            reference={franceAvg ? Object.fromEntries(Object.entries(franceAvg).map(([k, v]) => [k, v.avg])) : undefined}
            size={300}
          />
        </div>
      </Panel>
    </div>
  );
}

// ─── Tab: Carte ───────────────────────────────────────────────────────────────
function TabCarte({ model, poiList }: { model: ModelDetail; poiList: PoiRecord[] }) {
  const cids = Array.from(new Set(poiList.map(p => p.cluster_id))).sort();
  return (
    <div>
      <div style={{
        background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2,
        padding: '14px 16px', marginBottom: 16,
        fontFamily: fMono, fontSize: 11, color: C.muted,
      }}>
        La visualisation cartographique est disponible via la{' '}
        <Link href="/map" style={{ color: C.accent, textDecoration: 'none' }}>Carte principale</Link>
        {' '}(onglet Clustering). {poiList.length} POI classifiés.
      </div>
      {cids.map(cid => {
        const pois  = poiList.filter(p => p.cluster_id === cid);
        const color = CLUSTER_COLORS[cid % CLUSTER_COLORS.length];
        const label = model.cluster_labels[String(cid)] ?? `Cluster ${cid}`;
        return (
          <div key={cid} style={{
            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2,
            marginBottom: 12, overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
              background: color + '10',
            }}>
              <div style={{ width: 10, height: 10, borderRadius: 1, background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>{label}</span>
              <span style={{ fontFamily: fMono, fontSize: 10, color: C.dim, marginLeft: 4 }}>— {pois.length} POI</span>
            </div>
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {pois.map(p => (
                <div key={p.poi_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 16px', borderBottom: `1px solid ${C.border}10`,
                }}>
                  <div>
                    <span style={{ fontFamily: fMono, fontSize: 11, color: C.text }}>{p.poi_name}</span>
                    <span style={{ fontFamily: fMono, fontSize: 10, color: C.dim, marginLeft: 8 }}>{p.ville}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {p.imputed_features.length > 0 && (
                      <span style={{
                        fontSize: 10, fontFamily: fInter, color: C.amber,
                        background: C.amber + '15', border: `1px solid ${C.amber}30`,
                        borderRadius: 2, padding: '1px 4px',
                      }}>
                        {p.imputed_features.length} imputés
                      </span>
                    )}
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.dim }}>
                      {p.n_carreaux_intersected ?? '—'} carreaux
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Profils ─────────────────────────────────────────────────────────────
function TabProfils({ model, summary, franceAvg }: {
  model:     ModelDetail;
  summary:   Record<string, ClusterSummary>;
  franceAvg: FranceAverages | null;
}) {
  const cids          = Object.keys(summary).sort((a, b) => Number(a) - Number(b));
  const feats         = model.feature_names.length > 0 ? model.feature_names : Object.keys(FEAT_SHORT);
  const refProfile    = franceAvg ? Object.fromEntries(Object.entries(franceAvg).map(([k, v]) => [k, v.avg])) : undefined;
  const refRevenusAvg = franceAvg?.revenu_moyen?.avg;

  return (
    <div>
      {/* Cluster cards: radar + revenu index + delta bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
        {cids.map(cid => {
          const s     = summary[cid];
          const color = CLUSTER_COLORS[Number(cid) % CLUSTER_COLORS.length];
          if (!s) return null;

          // Delta vs France data for this cluster
          const deltaData = franceAvg
            ? feats.map(f => ({
                feature: FEAT_SHORT[f] ?? f,
                delta:   parseFloat(((s.avg_profile[f] ?? 0) - (franceAvg[f]?.avg ?? 0)).toFixed(4)),
              }))
            : [];

          return (
            <div key={cid} style={{
              background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: 1, background: color }} />
                <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>{s.label}</span>
                <span style={{ fontFamily: fMono, fontSize: 9, color: C.dim, marginLeft: 'auto' }}>{s.count} POI</span>
              </div>

              {/* Radar */}
              <ClusterRadar
                profiles={[s.avg_profile]}
                colors={[color]}
                labels={[s.label]}
                featureKeys={feats}
                reference={refProfile}
                size={200}
                showRefLegend={false}
              />

              {/* Revenu index 100 */}
              {franceAvg?.revenu_moyen && s.avg_profile.revenu_moyen !== undefined && (() => {
                const idx = revenusIndex(s.avg_profile.revenu_moyen, refRevenusAvg!);
                const clr = idx! >= 110 ? C.green : idx! <= 90 ? C.red : C.amber;
                return (
                  <div style={{ textAlign: 'center', margin: '10px 0 8px' }}>
                    <span style={{ fontSize: 11, fontFamily: fInter, color: C.dim }}>Revenu index </span>
                    <span style={{ fontFamily: fMono, fontSize: 16, color: clr, fontWeight: 700 }}>{idx}</span>
                    <span style={{ fontSize: 11, fontFamily: fInter, color: C.dim }}> / 100 = moy. France</span>
                  </div>
                );
              })()}

              {/* Delta bar chart vs France */}
              {deltaData.length > 0 && (
                <>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: C.dim, marginTop: 10, marginBottom: 6 }}>
                    Écart vs France
                  </div>
                  <ResponsiveContainer width="100%" height={feats.length * 18 + 20}>
                    <BarChart
                      layout="vertical"
                      data={deltaData}
                      margin={{ top: 0, right: 8, bottom: 0, left: 4 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fontSize: 8, fontFamily: fMono, fill: C.dim }}
                        axisLine={{ stroke: C.border }} tickLine={false}
                        tickFormatter={v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
                      />
                      <YAxis
                        type="category" dataKey="feature"
                        width={72}
                        tick={{ fontSize: 10, fontFamily: fInter, fill: C.muted }}
                        axisLine={false} tickLine={false}
                      />
                      <ReferenceLine x={0} stroke={C.border} strokeWidth={1.5} />
                      <RTooltip content={<DarkTooltip
                        formatter={(v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)} pp`}
                      />} />
                      <Bar dataKey="delta" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                        {deltaData.map((entry, i) => (
                          <Cell key={i} fill={entry.delta >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Feature table (all clusters side by side) */}
      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px', textAlign: 'left', fontFamily: fInter, fontSize: 11, color: C.dim }}>Feature</th>
              {cids.map(cid => (
                <th key={cid} style={{ padding: '8px', textAlign: 'left', fontFamily: fInter, fontSize: 11, color: CLUSTER_COLORS[Number(cid) % CLUSTER_COLORS.length] }}>
                  {summary[cid]?.label ?? `C${cid}`}
                </th>
              ))}
              {franceAvg && (
                <th style={{ padding: '8px', textAlign: 'left', fontFamily: fInter, fontSize: 11, color: C.dim }}>Moy. France</th>
              )}
            </tr>
          </thead>
          <tbody>
            {feats.map(feat => (
              <FeatureRow
                key={feat} feat={feat}
                values={cids.map(cid => ({
                  cid,
                  val:   summary[cid]?.avg_profile[feat] ?? 0,
                  color: CLUSTER_COLORS[Number(cid) % CLUSTER_COLORS.length],
                }))}
                franceAvg={franceAvg?.[feat]?.avg}
                refRevenusAvg={refRevenusAvg}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Comparaison ─────────────────────────────────────────────────────────
function TabComparaison({ model, summary, franceAvg }: {
  model:     ModelDetail;
  summary:   Record<string, ClusterSummary>;
  franceAvg: FranceAverages | null;
}) {
  const cids     = Object.keys(summary).sort((a, b) => Number(a) - Number(b));
  const feats    = model.feature_names.length > 0 ? model.feature_names : Object.keys(FEAT_SHORT);
  const refProfile = franceAvg
    ? Object.fromEntries(Object.entries(franceAvg).map(([k, v]) => [k, v.avg]))
    : undefined;

  // Grouped bar data: each feature row has one value per cluster + France
  const groupedData = useMemo(() => feats.map(feat => {
    const row: Record<string, number | string> = { feature: FEAT_SHORT[feat] ?? feat };
    cids.forEach((cid, i) => {
      row[summary[cid]?.label ?? `C${cid}`] = parseFloat(((summary[cid]?.avg_profile[feat] ?? 0) * 100).toFixed(2));
    });
    if (franceAvg) {
      row['Moy. France'] = parseFloat(((franceAvg[feat]?.avg ?? 0) * 100).toFixed(2));
    }
    return row;
  }), [feats, cids, summary, franceAvg]);

  return (
    <div>
      {/* Radar superposé */}
      <Panel title={`Radar superposé — ${cids.length} clusters vs France`} fullWidth>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ClusterRadar
            profiles={cids.map(c => summary[c]?.avg_profile ?? {})}
            colors={cids.map((_, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length])}
            labels={cids.map(c => summary[c]?.label ?? `C${c}`)}
            featureKeys={feats}
            reference={refProfile}
            size={340}
          />
        </div>
      </Panel>

      {/* Grouped bar chart */}
      {franceAvg && (
        <Panel title="Comparaison par feature — clusters vs France" fullWidth>
          <ResponsiveContainer width="100%" height={Math.max(400, feats.length * 28 + 60)}>
            <BarChart
              layout="vertical"
              data={groupedData}
              margin={{ top: 0, right: 16, bottom: 20, left: 8 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 9, fontFamily: fMono, fill: C.muted }}
                axisLine={{ stroke: C.border }} tickLine={false}
                tickFormatter={v => `${v}%`}
                label={{ value: '% (0–100)', position: 'insideBottom', offset: -10, fill: C.dim, fontSize: 9 }}
              />
              <YAxis
                type="category" dataKey="feature"
                width={88}
                tick={{ fontSize: 10, fontFamily: fInter, fill: C.muted }}
                axisLine={false} tickLine={false}
              />
              <CartesianGrid {...gridStyle} horizontal={false} />
              <RTooltip content={<DarkTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
              <Legend
                formatter={v => <span style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>{v}</span>}
              />
              {cids.map((cid, i) => (
                <Bar
                  key={cid}
                  dataKey={summary[cid]?.label ?? `C${cid}`}
                  fill={CLUSTER_COLORS[i % CLUSTER_COLORS.length]}
                  fillOpacity={0.85}
                  radius={[0, 2, 2, 0]}
                  isAnimationActive={groupedData.length > 150}
                />
              ))}
              <Bar dataKey="Moy. France" fill="#6b7280" fillOpacity={0.5} radius={[0, 2, 2, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* Delta table */}
      {franceAvg && (
        <Panel title="Delta vs moyenne France (en points de %)" fullWidth>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: '7px 10px', textAlign: 'left', fontFamily: fInter, fontSize: 11, color: C.dim }}>Feature</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right', fontFamily: fInter, fontSize: 11, color: C.dim }}>Moy. Fr</th>
                  {cids.map(cid => (
                    <th key={cid} style={{ padding: '7px 10px', textAlign: 'right', fontFamily: fInter, fontSize: 11, color: CLUSTER_COLORS[Number(cid) % CLUSTER_COLORS.length] }}>
                      {summary[cid]?.label ?? `C${cid}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feats.map(feat => {
                  const ref = franceAvg[feat]?.avg ?? 0;
                  return (
                    <tr key={feat} style={{ borderBottom: `1px solid ${C.border}15` }}>
                      <td style={{ padding: '5px 10px', fontFamily: fInter, fontSize: 11, color: C.muted }}>{FEAT_SHORT[feat] ?? feat}</td>
                      <td style={{ padding: '5px 10px', fontFamily: fMono, fontSize: 9, color: C.dim, textAlign: 'right' }}>
                        {fmtVal(feat, ref)}
                      </td>
                      {cids.map(cid => {
                        const val   = summary[cid]?.avg_profile[feat] ?? 0;
                        const delta = val - ref;
                        const color = delta > 0.02 ? C.green : delta < -0.02 ? C.red : C.text;
                        return (
                          <td key={cid} style={{ padding: '5px 10px', fontFamily: fMono, fontSize: 9, textAlign: 'right', color }}>
                            {delta >= 0 ? '+' : ''}{fmtVal(feat, delta)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─── Tab: Qualité ─────────────────────────────────────────────────────────────
function TabQualite({ model, poiList, summary }: {
  model:   ModelDetail;
  poiList: PoiRecord[];
  summary: Record<string, ClusterSummary>;
}) {
  const cids  = Object.keys(summary).sort((a, b) => Number(a) - Number(b));
  const total = poiList.length;
  const silScore = model.silhouette_score;
  const silColor = silScore >= 0.5 ? C.green : silScore >= 0.3 ? C.amber : C.red;
  const silLabel = silScore >= 0.5 ? 'Excellent' : silScore >= 0.3 ? 'Bon' : 'Faible';

  const imputedByCluster: Record<string, number> = {};
  for (const p of poiList) {
    const cid = String(p.cluster_id);
    if (p.imputed_features.length > 0)
      imputedByCluster[cid] = (imputedByCluster[cid] ?? 0) + 1;
  }

  // Scatter PCA data
  const scatterGroups = useMemo(() => cids.map((cid, i) => ({
    cid,
    label: summary[cid]?.label ?? `C${cid}`,
    color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
    points: poiList
      .filter(p => String(p.cluster_id) === cid && p.pca_components?.length >= 2)
      .map(p => ({
        x:    parseFloat((p.pca_components[0] ?? 0).toFixed(4)),
        y:    parseFloat((p.pca_components[1] ?? 0).toFixed(4)),
        name: p.poi_name,
        ville: p.ville,
      })),
  })), [cids, poiList, summary]);

  const hasPCA = scatterGroups.some(g => g.points.length > 0);

  // Silhouette plot data (sorted per cluster, per score desc)
  // We don't have per-POI silhouette scores in the API — show cluster avg as reference
  const clusterSizeData = cids.map((c, i) => ({
    name:  summary[c]?.label ?? `C${c}`,
    count: summary[c]?.count ?? 0,
    color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
    ideal: Math.round(total / cids.length),
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Silhouette KPI */}
      <Panel title="Score de silhouette">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: fMono, fontSize: 36, color: silColor }}>{silScore.toFixed(3)}</span>
          <span style={{ fontFamily: fInter, fontSize: 10, color: silColor }}>{silLabel}</span>
        </div>
        <div style={{ background: C.border, borderRadius: 1, height: 6, marginBottom: 10 }}>
          <div style={{ width: `${Math.min(100, silScore * 100)}%`, height: '100%', background: silColor, borderRadius: 1 }} />
        </div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>
          Échelle : -1 (mauvais) → 0 → 1 (parfait).<br />
          Score ≥ 0.50 : clusters bien séparés.<br />
          Score ≥ 0.30 : structure raisonnable.
        </div>
      </Panel>

      {/* PCA KPI */}
      <Panel title="Réduction dimensionnelle (PCA)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: fMono, fontSize: 28, color: C.accent }}>{model.n_pca_components}</span>
          <span style={{ fontFamily: fInter, fontSize: 10, color: C.muted }}>composantes</span>
        </div>
        <div style={{ background: C.border, borderRadius: 1, height: 6, marginBottom: 10 }}>
          <div style={{ width: `${(model.variance_explained * 100).toFixed(0)}%`, height: '100%', background: C.accent, borderRadius: 1 }} />
        </div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>
          {pct(model.variance_explained)} de variance expliquée<br />
          sur {model.feature_names.length} features initiales.
        </div>
      </Panel>

      {/* Cluster sizes bar chart */}
      <Panel title="Taille des clusters">
        <ResponsiveContainer width="100%" height={Math.max(120, cids.length * 36 + 30)}>
          <BarChart layout="vertical" data={clusterSizeData} margin={{ top: 0, right: 48, bottom: 0, left: 4 }}>
            <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={130} tick={axisStyle} axisLine={false} tickLine={false} />
            <ReferenceLine x={clusterSizeData[0]?.ideal} stroke={C.border} strokeDasharray="4 2"
              label={{ value: 'idéal', position: 'insideTopRight', fill: C.dim, fontSize: 8 }} />
            <RTooltip content={<DarkTooltip formatter={(v: number) => `${v} POI`} />} />
            <Bar dataKey="count" radius={[0, 2, 2, 0]}>
              {clusterSizeData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 8, fontFamily: fMono, fontSize: 10, color: C.dim }}>
          Équilibre idéal : {(total / cids.length).toFixed(0)} POI / cluster
        </div>
      </Panel>

      {/* Imputation */}
      <Panel title="Secret statistique INSEE">
        <div style={{ fontFamily: fMono, fontSize: 11, color: C.text, marginBottom: 10 }}>
          {poiList.filter(p => p.imputed_features.length > 0).length} / {total} POI avec features imputées
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cids.map((cid, i) => (
            <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 1, background: CLUSTER_COLORS[i % CLUSTER_COLORS.length], flexShrink: 0 }} />
              <span style={{ fontFamily: fMono, fontSize: 10, color: C.muted, flex: 1 }}>{summary[cid]?.label ?? `C${cid}`}</span>
              <span style={{ fontFamily: fMono, fontSize: 10, color: imputedByCluster[cid] ? C.amber : C.green }}>
                {imputedByCluster[cid] ?? 0} imputés
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* PCA Scatter */}
      {hasPCA && (
        <Panel title={`Scatter PCA — PC1 vs PC2 (${poiList.length} POI)`} fullWidth>
          <ResponsiveContainer width="100%" height={480}>
            <ScatterChart margin={{ top: 16, right: 20, bottom: 32, left: 12 }}>
              <XAxis
                type="number" dataKey="x" name="PCA 1"
                tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false}
                label={{ value: 'Composante PCA 1', position: 'insideBottom', offset: -16, fill: C.dim, fontSize: 9, fontFamily: fInter }}
              />
              <YAxis
                type="number" dataKey="y" name="PCA 2"
                tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false}
                label={{ value: 'PCA 2', angle: -90, position: 'insideLeft', fill: C.dim, fontSize: 9, fontFamily: fInter }}
              />
              <ZAxis range={[28, 28]} />
              <ReferenceLine x={0} stroke={C.border} strokeDasharray="4 3" />
              <ReferenceLine y={0} stroke={C.border} strokeDasharray="4 3" />
              <RTooltip
                cursor={{ strokeDasharray: '3 3', stroke: C.border }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  return (
                    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2, padding: '8px 12px', fontFamily: fMono, fontSize: 10 }}>
                      <div style={{ color: C.text, fontWeight: 600 }}>{d?.name}</div>
                      <div style={{ color: C.muted }}>{d?.ville}</div>
                      <div style={{ color: C.dim, marginTop: 4 }}>PC1 {d?.x?.toFixed(3)} · PC2 {d?.y?.toFixed(3)}</div>
                    </div>
                  );
                }}
              />
              <Legend
                formatter={v => <span style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>{v}</span>}
              />
              {scatterGroups.map((g, i) => (
                <Scatter
                  key={g.cid}
                  name={g.label}
                  data={g.points}
                  fill={g.color}
                  fillOpacity={0.75}
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

// ─── Tab: Méthodologie ────────────────────────────────────────────────────────
function TabMethodologie({ model }: { model: ModelDetail }) {
  const steps = [
    { title: '1. Données source', detail: `Table carreaux_filosofi (INSEE Filosofi 200m). Seuil secret statistique : ind > 11. Carreaux exploitables : ~822 727 sur 2 298 582.` },
    { title: '2. Calcul du profil POI', detail: `Isochrone OpenRouteService ${model.duration_minutes} min ${model.mode}. Intersection avec carreaux. Agrégation pondérée de ${model.feature_names.length} features socio-démographiques. Imputation médiane si secret stat.` },
    { title: '3. Normalisation', detail: "StandardScaler (μ=0, σ=1) sur les 16 features. Élimine les effets d'unité (%, m², ratio revenu normalisé)." },
    { title: '4. Réduction dimensionnelle (PCA)', detail: `PCA avec seuil de variance 85%. Résultat : ${model.n_pca_components} composantes → ${(model.variance_explained * 100).toFixed(1)}% de variance expliquée.` },
    { title: '5. Clustering K-Means', detail: `Recherche du K optimal par maximisation du score de silhouette (K ∈ [3, 10]). K retenu : ${model.k}. Score final : ${model.silhouette_score.toFixed(4)}.` },
    { title: '6. Features utilisées', detail: (model.feature_names ?? []).join(', ') || 'Standard 16 features Filosofi' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {steps.map(s => (
        <div key={s.title} style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16 }}>
          <div style={{ fontFamily: fInter, fontSize: 12, color: C.accent, marginBottom: 6 }}>{s.title}</div>
          <div style={{ fontFamily: fMono, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>{s.detail}</div>
        </div>
      ))}
      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16 }}>
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.accent, marginBottom: 10 }}>Glossaire des features</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {Object.entries(FEAT_LABEL).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: `1px solid ${C.border}15` }}>
              <span style={{ fontFamily: fMono, fontSize: 9, color: C.accent, minWidth: 100, flexShrink: 0 }}>{k}</span>
              <span style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Historique ──────────────────────────────────────────────────────────
function TabHistorique({ model, poiList }: { model: ModelDetail; poiList: PoiRecord[] }) {
  const mapping = model.cluster_mapping_from_previous;
  return (
    <div>
      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.dim, marginBottom: 12 }}>Version {model.version}</div>
        {mapping ? (
          <div>
            <div style={{ fontFamily: fMono, fontSize: 11, color: C.muted, marginBottom: 10 }}>Mapping des clusters depuis la version précédente :</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(mapping).map(([oldCid, newCid]) => (
                <div key={oldCid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: fMono, fontSize: 10, color: C.dim }}>C{oldCid} (v{model.version - 1})</span>
                  <span style={{ fontFamily: fMono, fontSize: 10, color: C.muted }}>→</span>
                  <div style={{ width: 8, height: 8, borderRadius: 1, background: CLUSTER_COLORS[Number(newCid) % CLUSTER_COLORS.length] }} />
                  <span style={{ fontFamily: fMono, fontSize: 10, color: C.text }}>C{newCid} (v{model.version})</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: fMono, fontSize: 11, color: C.muted }}>Première version — pas de mapping de continuité disponible.</div>
        )}
      </div>
      <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20 }}>
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.dim, marginBottom: 12 }}>Couverture de données par POI</div>
        <div style={{ fontFamily: fMono, fontSize: 11, color: C.muted, marginBottom: 12 }}>
          Entraîné sur {model.n_poi_trained} POI. Durée isochrone : {model.duration_minutes} min {model.mode}.
        </div>
        {poiList.filter(p => p.imputed_features.length > 0).length > 0 && (
          <div>
            <div style={{ fontFamily: fInter, fontSize: 11, color: C.amber, marginBottom: 8 }}>POI avec imputation</div>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {poiList.filter(p => p.imputed_features.length > 0).map(p => (
                <div key={p.poi_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.border}15` }}>
                  <span style={{ fontFamily: fMono, fontSize: 10, color: C.text }}>{p.poi_name}</span>
                  <span style={{ fontFamily: fMono, fontSize: 9, color: C.amber }}>{p.imputed_features.join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export XLSX ──────────────────────────────────────────────────────────────
async function exportXlsx(model: ModelDetail, poiList: PoiRecord[]) {
  const { utils, writeFile } = await import('xlsx');
  const feats = model.feature_names;
  const rows  = poiList.map(p => ({
    'POI ID':              p.poi_id,
    'Nom':                 p.poi_name,
    'Ville':               p.ville,
    'Catégorie':           p.categorie,
    'Cluster ID':          p.cluster_id,
    'Cluster Label':       p.cluster_label,
    'N carreaux':          p.n_carreaux_intersected ?? '',
    'Population':          p.population_totale_couverte ?? '',
    'Features imputées':   p.imputed_features.join(', '),
    ...Object.fromEntries(feats.map(f => [f, p.profile_features?.[f] ?? ''])),
  }));
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, `v${model.version}`);
  writeFile(wb, `clustering_v${model.version}.xlsx`);
}

// ─── Export PDF ───────────────────────────────────────────────────────────────
async function exportPDF(
  model:        ModelDetail,
  summary:      Record<string, ClusterSummary>,
  poiList:      PoiRecord[],
  franceAvg:    FranceAverages | null,
  setExporting: (v: boolean) => void,
  analysis?:    GeminiAnalysis,
) {
  setExporting(true);
  try {
    const { pdf } = await import('@react-pdf/renderer');
    const { ClusteringPDFReport } = await import('@/components/ClusteringPDFReport');
    const React = (await import('react')).default;

    const cids = Object.keys(summary).sort((a, b) => Number(a) - Number(b));

    const clusters = cids.map((cid, i) => ({
      label:       summary[cid]?.label ?? `C${cid}`,
      count:       summary[cid]?.count ?? 0,
      color:       CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      avg_profile: summary[cid]?.avg_profile ?? {},
      poi_list:    poiList
        .filter(p => String(p.cluster_id) === cid)
        .map(p => ({ name: p.poi_name, ville: p.ville, imputed: p.imputed_features.length > 0 })),
    }));

    const franceAvgForPDF = franceAvg
      ? Object.fromEntries(Object.entries(franceAvg).map(([k, v]) => [k, { avg: v.avg }]))
      : {};

    const data = {
      version:            model.version,
      k:                  model.k,
      silhouette_score:   model.silhouette_score,
      n_pca_components:   model.n_pca_components,
      variance_explained: model.variance_explained,
      n_poi_trained:      model.n_poi_trained,
      duration_minutes:   model.duration_minutes,
      mode:               model.mode,
      created_at:         model.created_at,
      feature_names:      model.feature_names,
      clusters,
    };

    const blob = await pdf(
      // Cast needed: pdf() expects ReactElement<DocumentProps> but our component wraps Document internally
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(ClusteringPDFReport, { data, franceAverages: franceAvgForPDF, analysis }) as React.ReactElement<any>
    ).toBlob();

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `clustering-v${model.version}-${model.duration_minutes}min-${model.mode}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    console.error('PDF generation failed:', err);
    // Fallback
    window.print();
  } finally {
    setExporting(false);
  }
}

// ─── ClusterDetails ───────────────────────────────────────────────────────────
export function ClusterDetails({ version: versionProp, onClose }: { version: string | number; onClose?: () => void }) {
  const version = String(versionProp);

  const [tab,        setTab]        = useState<TabId>('resume');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [model,      setModel]      = useState<ModelDetail | null>(null);
  const [summary,    setSummary]    = useState<Record<string, ClusterSummary>>({});
  const [poiList,    setPoiList]    = useState<PoiRecord[]>([]);
  const [franceAvg,  setFranceAvg]  = useState<FranceAverages | null>(null);
  const [exporting,         setExporting]         = useState(false);
  const [analysis,          setAnalysis]          = useState<GeminiAnalysis | null>(null);
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  const [analysisJobId,     setAnalysisJobId]     = useState<string | null>(null);
  const [analysisError,     setAnalysisError]     = useState<string | null>(null);

  useEffect(() => {
    if (!version) return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/poi-clusters/models/${version}`).then(r => r.json()),
      fetch('/api/poi-clusters/france-averages').then(r => r.json()),
      fetch(`/api/poi-clusters/models/${version}/analysis`).then(r => r.ok ? r.json() : null),
    ]).then(([modelData, avgData, analysisData]) => {
      if (modelData.error) { setError(modelData.error); return; }
      setModel(modelData.model);
      setSummary(modelData.cluster_summary);
      setPoiList(modelData.poi_list);
      if (!avgData.error) setFranceAvg(avgData.averages);
      if (analysisData && !analysisData.error) setAnalysis(analysisData);
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [version]);

  // Poll job de génération d'analyse
  useEffect(() => {
    if (!analysisJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/poi-clusters/run?job_id=${analysisJobId}`);
        const data = await res.json();
        if (data.status === 'done') {
          clearInterval(interval);
          setAnalysisJobId(null);
          setGeneratingAnalysis(false);
          // Recharger l'analyse depuis la base
          const ar = await fetch(`/api/poi-clusters/models/${version}/analysis`);
          if (ar.ok) setAnalysis(await ar.json());
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setAnalysisJobId(null);
          setGeneratingAnalysis(false);
          setAnalysisError(data.error ?? 'Erreur lors de la génération');
        }
      } catch { /* réseau temporairement indispo */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [analysisJobId, version]);

  const handleGenerateAnalysis = async () => {
    setGeneratingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/poi-clusters/models/${version}/generate-analysis`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setAnalysisJobId(data.job_id);
    } catch (e: unknown) {
      setGeneratingAnalysis(false);
      setAnalysisError(String(e));
    }
  };

  if (loading) return (
    <div style={{ padding: 40, fontFamily: fMono, fontSize: 12, color: C.muted, textAlign: 'center' }}>
      Chargement...
    </div>
  );

  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ fontFamily: fMono, fontSize: 12, color: C.red, background: C.red + '10', border: `1px solid ${C.red}30`, borderRadius: 2, padding: '12px 16px' }}>
        ! {error}
      </div>
      <div style={{ marginTop: 12 }}>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fMono, fontSize: 11, color: C.accent, padding: 0 }}>
            ← Retour
          </button>
        )}
      </div>
    </div>
  );

  if (!model) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: '20px 28px 0',
        background: C.bgPanel, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {onClose ? (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: fMono, fontSize: 10, color: C.dim, padding: 0 }}>
              ← Fermer
            </button>
          ) : (
            <Link href="/clusters" style={{ fontFamily: fMono, fontSize: 10, color: C.dim, textDecoration: 'none' }}>
              ← Modèles
            </Link>
          )}
          <span style={{ color: C.border }}>|</span>
          <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 18, color: C.text }}>
            Clustering v{model.version}
          </span>
          <span style={{
            fontFamily: fMono, fontSize: 10,
            color:   model.silhouette_score >= 0.5 ? C.green : model.silhouette_score >= 0.3 ? C.amber : C.red,
            border:  '1px solid currentColor', borderRadius: 2, padding: '2px 6px', opacity: 0.8,
          }}>
            SIL {model.silhouette_score.toFixed(3)}
          </span>
          {/* Feature themes badge */}
          {model.feature_themes && model.feature_themes.length > 0 && model.feature_themes.length < 4 && (
            <span style={{
              fontFamily: fInter, fontSize: 10,
              color: '#10b981', border: '1px solid #10b98140', borderRadius: 2, padding: '2px 6px', opacity: 0.9,
            }}>
              {model.feature_themes.map(t => FEATURE_THEMES[t as keyof typeof FEATURE_THEMES]?.label ?? t).join(' + ')}
            </span>
          )}
          <span style={{ fontFamily: fMono, fontSize: 10, color: C.dim, marginLeft: 4 }}>
            {model.k} clusters · {model.n_poi_trained} POI · {model.duration_minutes}min {model.mode}
          </span>

          {/* Export buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Analyse Gemini */}
            {analysisError && (
              <span style={{ fontFamily: fMono, fontSize: 9, color: C.red }}>! {analysisError}</span>
            )}
            {!analysis && !generatingAnalysis && (
              <button
                onClick={handleGenerateAnalysis}
                style={{
                  background: 'none', border: `1px solid ${C.accent}50`, borderRadius: 2,
                  padding: '4px 10px', cursor: 'pointer',
                  fontFamily: fInter, fontSize: 11, color: C.accent,
                }}
                title="Générer l'analyse Gemini (rapport PDF enrichi)"
              >
                + Analyser
              </button>
            )}
            {generatingAnalysis && (
              <span style={{
                fontFamily: fInter, fontSize: 11,
                color: C.accent, border: `1px solid ${C.accent}40`, borderRadius: 2,
                padding: '4px 10px', opacity: 0.7,
              }}>
                … Gemini
              </span>
            )}
            {analysis && !generatingAnalysis && (
              <button
                onClick={handleGenerateAnalysis}
                title="Regénérer l'analyse Gemini"
                style={{
                  background: 'none', border: `1px solid ${C.border}`, borderRadius: 2,
                  padding: '4px 8px', cursor: 'pointer',
                  fontFamily: fInter, fontSize: 11, color: C.dim,
                }}
              >
                ↺ IA
              </button>
            )}

            <button
              onClick={() => exportXlsx(model, poiList)}
              style={{
                background: 'none', border: `1px solid ${C.border}`, borderRadius: 2,
                padding: '4px 10px', cursor: 'pointer',
                fontFamily: fInter, fontSize: 11, color: C.muted,
              }}
            >
              ↓ XLSX
            </button>
            <button
              onClick={() => exportPDF(model, summary, poiList, franceAvg, setExporting, analysis ?? undefined)}
              disabled={exporting}
              style={{
                background: exporting ? C.accent + '20' : analysis ? C.accent + '15' : 'none',
                border: `1px solid ${exporting || analysis ? C.accent : C.border}`,
                borderRadius: 2, padding: '4px 10px',
                cursor: exporting ? 'wait' : 'pointer',
                fontFamily: fInter, fontSize: 11,
                color: exporting || analysis ? C.accent : C.muted,
              }}
              title={analysis ? 'Exporter le rapport PDF enrichi (analyse Gemini incluse)' : 'Exporter le rapport PDF'}
            >
              {exporting ? '… PDF' : analysis ? '↓ PDF rapport' : '↓ PDF'}
            </button>
          </div>
        </div>
        <TabBar active={tab} onChange={setTab} />
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 48px' }}>
        {tab === 'resume'       && <TabResume       model={model} summary={summary} franceAvg={franceAvg} />}
        {tab === 'carte'        && <TabCarte        model={model} poiList={poiList} />}
        {tab === 'profils'      && <TabProfils      model={model} summary={summary} franceAvg={franceAvg} />}
        {tab === 'comparaison'  && <TabComparaison  model={model} summary={summary} franceAvg={franceAvg} />}
        {tab === 'qualite'      && <TabQualite      model={model} poiList={poiList} summary={summary} />}
        {tab === 'methodologie' && <TabMethodologie model={model} />}
        {tab === 'historique'   && <TabHistorique   model={model} poiList={poiList} />}
      </div>
    </div>
  );
}

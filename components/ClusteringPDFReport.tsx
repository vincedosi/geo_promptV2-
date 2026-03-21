/**
 * ClusteringPDFReport — @react-pdf/renderer v4 document
 * Généré côté client via pdf(<ClusteringPDFReport />).toBlob()
 * Structure : Couverture / (Synthèse Gemini) / Répartition / Profils par cluster / (Comparaison France) / Méthodologie
 */

import React from 'react';
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer';
// ─── Types ────────────────────────────────────────────────────────────────────
export interface GeminiAnalysis {
  titre:               string;
  synthese_executive:  string;
  clusters: {
    id:             number;
    titre:          string;
    analyse:        string;
    recommandation: string;
    atypiques:      string | null;
  }[];
  comparaison_france:  string;
  points_attention:    string[];
  methodologie_resume: string;
}

export interface PDFClusterSummary {
  label:       string;
  count:       number;
  color:       string;
  avg_profile: Record<string, number>;
  poi_list:    { name: string; ville: string; imputed: boolean }[];
}

export interface PDFReportData {
  version:            number;
  k:                  number;
  silhouette_score:   number;
  n_pca_components:   number;
  variance_explained: number;
  n_poi_trained:      number;
  duration_minutes:   number;
  mode:               string;
  created_at:         string;
  feature_names:      string[];
  clusters:           PDFClusterSummary[];
}

export interface PDFFranceAverages {
  [feature: string]: { avg: number };
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    padding: 44,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
  // Cover
  coverTitle: {
    fontSize: 26,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
    color: '#0f172a',
  },
  coverSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  coverDate: {
    fontSize: 10,
    color: '#9ca3af',
    marginBottom: 36,
  },
  coverRule: {
    borderBottomWidth: 2,
    borderBottomColor: '#7c3aed',
    marginBottom: 32,
    marginTop: 8,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  kpiBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    padding: 12,
    backgroundColor: '#f9fafb',
  },
  kpiLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  kpiSub: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 2,
  },
  // Section
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 4,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#7c3aed',
  },
  sectionMeta: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 16,
  },
  subTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#1f2937',
    marginTop: 14,
    marginBottom: 6,
  },
  body: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#374151',
    marginBottom: 10,
  },
  bodySmall: {
    fontSize: 9,
    lineHeight: 1.6,
    color: '#374151',
    marginBottom: 8,
  },
  // Cluster header
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    borderLeftWidth: 4,
  },
  clusterTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
  },
  clusterMeta: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  // Analysis blocks
  analyseBox: {
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#0369a1',
    padding: 10,
    borderRadius: 2,
    marginBottom: 8,
  },
  analyseLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#0369a1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  recoBox: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    padding: 10,
    borderRadius: 2,
    marginBottom: 8,
  },
  recoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#15803d',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  atypiquesBox: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#d97706',
    padding: 10,
    borderRadius: 2,
    marginBottom: 8,
  },
  atypiquesLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#b45309',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  // Table
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: '#d1d5db',
    paddingBottom: 5,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 3,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 0.5,
    borderBottomColor: '#f3f4f6',
  },
  th: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  td: {
    fontSize: 9,
    color: '#374151',
  },
  tdPositive: {
    fontSize: 9,
    color: '#16a34a',
    fontFamily: 'Helvetica-Bold',
  },
  tdNegative: {
    fontSize: 9,
    color: '#dc2626',
    fontFamily: 'Helvetica-Bold',
  },
  tdMuted: {
    fontSize: 9,
    color: '#9ca3af',
  },
  // Bar (inline)
  barBg: {
    height: 5,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    marginTop: 2,
    flex: 1,
  },
  // POI list
  poiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f3f4f6',
  },
  poiName: { fontSize: 9, color: '#1f2937' },
  poiVille: { fontSize: 8, color: '#9ca3af' },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: '#9ca3af',
  },
  // Interpretation
  interpretation: {
    fontSize: 9,
    fontFamily: 'Helvetica-Oblique',
    color: '#4b5563',
    backgroundColor: '#f0fdf4',
    padding: 10,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    marginTop: 10,
    marginBottom: 10,
    lineHeight: 1.5,
  },
  // Silhouette badge
  silBadgeGood: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#15803d',
    backgroundColor: '#dcfce7',
    padding: '3 7',
    borderRadius: 3,
    marginLeft: 8,
  },
  silBadgeMid: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#b45309',
    backgroundColor: '#fef3c7',
    padding: '3 7',
    borderRadius: 3,
    marginLeft: 8,
  },
  silBadgeBad: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
    padding: '3 7',
    borderRadius: 3,
    marginLeft: 8,
  },
  // Points d'attention
  bulletRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  bulletDot: {
    fontSize: 14,
    color: '#7c3aed',
    lineHeight: 1.2,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.6,
    color: '#374151',
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const FEAT_SHORT: Record<string, string> = {
  pct_0_17:           '0-17 ans',
  pct_18_39:          '18-39 ans',
  pct_40_54:          '40-54 ans',
  pct_55_79:          '55-79 ans',
  pct_80p:            '80 ans +',
  revenu_moyen:       'Revenu moyen',
  taux_pauvrete:      'Taux pauvreté',
  taux_proprietaires: 'Propriétaires',
  taux_collectif:     'Logement collectif',
  taux_hlm:           'HLM / social',
  taux_isoles:        'Ménages isolés',
  taux_grandes_fam:   'Grandes familles',
  taux_mono_parental: 'Mono-parentales',
  taux_ancien:        'Logts avant 1945',
  taux_recent:        'Logts après 1990',
  surface_moyenne:    'Surface moyenne',
};

function fmtVal(feat: string, val: number): string {
  if (feat === 'surface_moyenne') return `${val.toFixed(1)} m²`;
  if (feat === 'revenu_moyen') return `×${val.toFixed(3)}`;
  return `${(val * 100).toFixed(1)}%`;
}

function fmtDelta(feat: string, delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  if (feat === 'surface_moyenne') return `${sign}${delta.toFixed(1)} m²`;
  if (feat === 'revenu_moyen') return `${sign}${(delta * 100).toFixed(1)}%`;
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

function revenusIndex(val: number, avg: number): number {
  if (!avg) return 100;
  return Math.round((val / avg) * 100);
}

// ─── Inline bar ───────────────────────────────────────────────────────────────
function PDFBar({ val, max, color }: { val: number; max: number; color: string }) {
  const pct = Math.min(1, Math.max(0, val / (max || 1)));
  return (
    <View style={S.barBg}>
      <View style={{
        height: 5, width: `${(pct * 100).toFixed(1)}%`,
        backgroundColor: color, borderRadius: 2,
      }} />
    </View>
  );
}

// ─── KPI box ──────────────────────────────────────────────────────────────────
function KPIBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={S.kpiBox}>
      <Text style={S.kpiLabel}>{label}</Text>
      <Text style={S.kpiValue}>{value}</Text>
      {sub && <Text style={S.kpiSub}>{sub}</Text>}
    </View>
  );
}

// ─── Cluster distribution table ───────────────────────────────────────────────
function ClusterTable({ clusters }: { clusters: PDFClusterSummary[] }) {
  const total = clusters.reduce((acc, c) => acc + c.count, 0);
  return (
    <View>
      <View style={S.tableHeader}>
        <Text style={[S.th, { width: '8%' }]}>#</Text>
        <Text style={[S.th, { flex: 1 }]}>CLUSTER</Text>
        <Text style={[S.th, { width: '12%', textAlign: 'right' }]}>POI</Text>
        <Text style={[S.th, { width: '12%', textAlign: 'right' }]}>%</Text>
        <Text style={[S.th, { width: '30%' }]}>DISTRIBUTION</Text>
      </View>
      {clusters.map((c, i) => (
        <View key={i} style={i % 2 === 1 ? S.tableRowAlt : S.tableRow}>
          <Text style={[S.td, { width: '8%', color: '#7c3aed', fontFamily: 'Helvetica-Bold' }]}>
            C{i}
          </Text>
          <Text style={[S.td, { flex: 1 }]}>{c.label}</Text>
          <Text style={[S.td, { width: '12%', textAlign: 'right' }]}>{c.count}</Text>
          <Text style={[S.td, { width: '12%', textAlign: 'right' }]}>
            {total > 0 ? `${((c.count / total) * 100).toFixed(1)}%` : '—'}
          </Text>
          <View style={{ width: '30%', justifyContent: 'center' }}>
            <PDFBar val={c.count} max={total} color={c.color} />
          </View>
        </View>
      ))}
      <View style={{ marginTop: 6 }}>
        <Text style={[S.tdMuted, { textAlign: 'right' }]}>
          Total : {total} POI analysés
        </Text>
      </View>
    </View>
  );
}

// ─── Feature table per cluster ────────────────────────────────────────────────
function FeatureTable({
  profile, featureNames, france, color,
}: {
  profile:      Record<string, number>;
  featureNames: string[];
  france:       PDFFranceAverages;
  color:        string;
}) {
  const hasFrance = Object.keys(france).length > 0;
  const refRevenu = france['revenu_moyen']?.avg ?? 0;

  return (
    <View>
      <View style={S.tableHeader}>
        <Text style={[S.th, { flex: 1 }]}>FEATURE</Text>
        <Text style={[S.th, { width: '16%', textAlign: 'right' }]}>CLUSTER</Text>
        {hasFrance && <>
          <Text style={[S.th, { width: '16%', textAlign: 'right' }]}>MOY. FR</Text>
          <Text style={[S.th, { width: '16%', textAlign: 'right' }]}>ÉCART</Text>
        </>}
        <Text style={[S.th, { width: '22%' }]}>VIS.</Text>
      </View>
      {featureNames.map((feat, i) => {
        const val      = profile[feat] ?? 0;
        const ref      = france[feat]?.avg ?? 0;
        const delta    = hasFrance ? (val - ref) : 0;
        const isRevenu = feat === 'revenu_moyen';
        const idx      = (isRevenu && refRevenu) ? revenusIndex(val, refRevenu) : null;

        const deltaStyle = !hasFrance ? S.td
          : delta > 0.02 ? S.tdPositive
          : delta < -0.02 ? S.tdNegative
          : S.td;

        const maxVal = hasFrance ? Math.max(val, ref, 0.001) : Math.max(val, 0.001);

        return (
          <View key={feat} style={i % 2 === 1 ? S.tableRowAlt : S.tableRow}>
            <Text style={[S.td, { flex: 1 }]}>
              {FEAT_SHORT[feat] ?? feat}
              {idx !== null ? `  [${idx}]` : ''}
            </Text>
            <Text style={[S.td, { width: '16%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
              {fmtVal(feat, val)}
            </Text>
            {hasFrance && <>
              <Text style={[S.tdMuted, { width: '16%', textAlign: 'right' }]}>
                {fmtVal(feat, ref)}
              </Text>
              <Text style={[deltaStyle, { width: '16%', textAlign: 'right' }]}>
                {fmtDelta(feat, delta)}
              </Text>
            </>}
            <View style={{ width: '22%', justifyContent: 'center', paddingLeft: 4 }}>
              <PDFBar val={val} max={maxVal} color={color} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── POI list ─────────────────────────────────────────────────────────────────
function POIList({ pois }: { pois: PDFClusterSummary['poi_list'] }) {
  if (pois.length === 0) return null;
  return (
    <View>
      {pois.slice(0, 40).map((p, i) => (
        <View key={i} style={S.poiRow}>
          <Text style={S.poiName}>{p.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {p.imputed && (
              <Text style={{ fontSize: 7, color: '#d97706', fontFamily: 'Helvetica-Bold' }}>
                IMPUTÉ
              </Text>
            )}
            <Text style={S.poiVille}>{p.ville}</Text>
          </View>
        </View>
      ))}
      {pois.length > 40 && (
        <Text style={[S.tdMuted, { marginTop: 4 }]}>
          … et {pois.length - 40} autres POI
        </Text>
      )}
    </View>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ label }: { label: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>
        GENESIS — Clustering Filosofi — {new Date().toLocaleDateString('fr-FR')}
      </Text>
      <Text style={S.footerText}>{label}</Text>
    </View>
  );
}

// ─── Main document ────────────────────────────────────────────────────────────
export function ClusteringPDFReport({
  data,
  franceAverages,
  analysis,
}: {
  data:            PDFReportData;
  franceAverages:  PDFFranceAverages;
  analysis?:       GeminiAnalysis;
}) {
  const total     = data.clusters.reduce((acc, c) => acc + c.count, 0);
  const silScore  = data.silhouette_score;
  const silLabel  = silScore >= 0.5 ? 'Excellent' : silScore >= 0.3 ? 'Bon' : 'Faible';
  const silBadge  = silScore >= 0.5 ? S.silBadgeGood : silScore >= 0.3 ? S.silBadgeMid : S.silBadgeBad;
  const createdAt = new Date(data.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  // Titre cover : Gemini > générique
  const coverTitle = analysis?.titre
    ?? (data.feature_names.length < 16
      ? `Clustering\n${data.feature_names.length} Variables`
      : `Analyse Clustering\nSociodémographique`);

  return (
    <Document
      title={analysis?.titre ?? `Clustering Filosofi v${data.version} — GENESIS`}
      author="GENESIS"
      subject="Analyse clustering sociodémographique"
    >
      {/* ── PAGE 1 : COUVERTURE ────────────────────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, color: '#7c3aed', fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginBottom: 20 }}>
            GEO.PROMPT  ·  GENESIS{analysis ? '  ·  RAPPORT GEMINI' : ''}
          </Text>

          <Text style={S.coverTitle}>{coverTitle}</Text>
          <View style={S.coverRule} />
          <Text style={S.coverSubtitle}>
            Profils Filosofi — Modèle v{data.version}
            {data.feature_names.length < 16 ? `  ·  ${data.feature_names.length} variables sélectionnées` : ''}
          </Text>
          <Text style={S.coverDate}>Généré le {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</Text>

          <View style={S.kpiRow}>
            <KPIBox label="Clusters" value={String(data.k)} sub="groupes distincts" />
            <KPIBox label="POI analysés" value={String(total)} sub={`entraînés : ${data.n_poi_trained}`} />
            <KPIBox label="Isochrone" value={`${data.duration_minutes} min`} sub={data.mode} />
            <KPIBox label="Silhouette" value={silScore.toFixed(2)} sub={silLabel} />
          </View>

          <View style={{ marginTop: 32 }}>
            {[
              ['Composantes PCA', `${data.n_pca_components} axes`],
              ['Variance expliquée', `${(data.variance_explained * 100).toFixed(1)} %`],
              ['Features Filosofi', `${data.feature_names.length} variables`],
              ['Date d\'entraînement', createdAt],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f3f4f6' }}>
                <Text style={{ fontSize: 9, color: '#6b7280' }}>{k}</Text>
                <Text style={{ fontSize: 9, color: '#111827', fontFamily: 'Helvetica-Bold' }}>{v}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 24, padding: 12, backgroundColor: '#f5f3ff', borderRadius: 4, borderLeftWidth: 3, borderLeftColor: '#7c3aed' }}>
            <Text style={{ fontSize: 9, color: '#4c1d95', lineHeight: 1.5 }}>
              Ce rapport analyse les points d'intérêt selon le profil sociodémographique
              de leur zone de chalandise (isochrone {data.duration_minutes} min {data.mode}).
              Les {data.k} clusters identifiés regroupent des établissements avec des bassins
              de population similaires selon {data.feature_names.length} variable{data.feature_names.length > 1 ? 's' : ''} INSEE Filosofi.
              {analysis ? ' Analyse rédigée par intelligence artificielle (Google Gemini).' : ''}
            </Text>
          </View>
        </View>
        <Footer label={`v${data.version}`} />
      </Page>

      {/* ── PAGE 2 (si Gemini) : SYNTHÈSE EXÉCUTIVE ──────────────────────── */}
      {analysis && (
        <Page size="A4" style={S.page}>
          <Text style={S.sectionTitle}>Synthèse exécutive</Text>
          <Text style={S.sectionMeta}>
            Analyse Gemini — {data.k} clusters · {total} POI · {data.duration_minutes} min {data.mode}
          </Text>

          <View style={{ backgroundColor: '#f5f3ff', borderLeftWidth: 4, borderLeftColor: '#7c3aed', padding: 16, borderRadius: 2, marginBottom: 20 }}>
            <Text style={[S.body, { marginBottom: 0, fontSize: 11, lineHeight: 1.7 }]}>
              {analysis.synthese_executive}
            </Text>
          </View>

          {/* Tableau résumé des clusters avec titres Gemini */}
          <Text style={S.subTitle}>Clusters identifiés</Text>
          <View style={S.tableHeader}>
            <Text style={[S.th, { width: '8%' }]}>#</Text>
            <Text style={[S.th, { flex: 1 }]}>TITRE</Text>
            <Text style={[S.th, { width: '12%', textAlign: 'right' }]}>POI</Text>
          </View>
          {analysis.clusters.map((ac, i) => (
            <View key={i} style={i % 2 === 1 ? S.tableRowAlt : S.tableRow}>
              <Text style={[S.td, { width: '8%', color: '#7c3aed', fontFamily: 'Helvetica-Bold' }]}>
                C{ac.id}
              </Text>
              <Text style={[S.td, { flex: 1 }]}>{ac.titre}</Text>
              <Text style={[S.td, { width: '12%', textAlign: 'right' }]}>
                {data.clusters[ac.id]?.count ?? '—'}
              </Text>
            </View>
          ))}

          <Footer label="Synthèse exécutive" />
        </Page>
      )}

      {/* ── PAGE RÉPARTITION ──────────────────────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>Répartition des clusters</Text>
        <Text style={S.sectionMeta}>
          {total} POI répartis en {data.k} groupes sociodémographiques · Score de silhouette : {silScore.toFixed(3)} ({silLabel})
        </Text>

        <ClusterTable clusters={data.clusters} />

        {/* Résumé qualité */}
        <View style={{ marginTop: 24, flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 12 }}>
            <Text style={S.kpiLabel}>SCORE DE SILHOUETTE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: silScore >= 0.5 ? '#16a34a' : silScore >= 0.3 ? '#d97706' : '#dc2626' }}>
                {silScore.toFixed(3)}
              </Text>
              <Text style={silBadge}>{silLabel.toUpperCase()}</Text>
            </View>
            <Text style={[S.body, { marginTop: 8, marginBottom: 0 }]}>
              Score ≥ 0.50 : clusters bien séparés.{'\n'}
              Score ≥ 0.30 : structure raisonnable.
            </Text>
          </View>
          <View style={{ flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 12 }}>
            <Text style={S.kpiLabel}>RÉDUCTION DIMENSIONNELLE</Text>
            <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginTop: 4 }}>
              {data.n_pca_components} axes PCA
            </Text>
            <Text style={[S.body, { marginTop: 8, marginBottom: 0 }]}>
              {(data.variance_explained * 100).toFixed(1)}% de variance expliquée{'\n'}
              sur {data.feature_names.length} features initiales.
            </Text>
          </View>
        </View>

        <Footer label="Répartition" />
      </Page>

      {/* ── PAGES PROFIL PAR CLUSTER ──────────────────────────────────────── */}
      {data.clusters.map((cluster, ci) => {
        const geminiCluster = analysis?.clusters.find(ac => ac.id === ci);
        return (
          <Page key={ci} size="A4" style={S.page}>
            {/* Cluster header */}
            <View style={[S.clusterHeader, { borderLeftColor: cluster.color }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 12, height: 12, backgroundColor: cluster.color, borderRadius: 2 }} />
                  <Text style={S.clusterTitle}>
                    Cluster {ci} — {geminiCluster?.titre ?? cluster.label}
                  </Text>
                </View>
                <Text style={S.clusterMeta}>
                  {cluster.label}  ·  {cluster.count} POI · {total > 0 ? `${((cluster.count / total) * 100).toFixed(1)}%` : '—'} du total
                  {franceAverages['revenu_moyen']?.avg && cluster.avg_profile['revenu_moyen']
                    ? `  ·  Revenu index : ${revenusIndex(cluster.avg_profile['revenu_moyen'], franceAverages['revenu_moyen'].avg)}/100`
                    : ''}
                </Text>
              </View>
            </View>

            {/* Texte analyse Gemini */}
            {geminiCluster && (
              <View>
                <View style={S.analyseBox}>
                  <Text style={S.analyseLabel}>Analyse</Text>
                  <Text style={[S.bodySmall, { marginBottom: 0 }]}>{geminiCluster.analyse}</Text>
                </View>
                <View style={S.recoBox}>
                  <Text style={S.recoLabel}>Recommandations</Text>
                  <Text style={[S.bodySmall, { marginBottom: 0 }]}>{geminiCluster.recommandation}</Text>
                </View>
                {geminiCluster.atypiques && (
                  <View style={S.atypiquesBox}>
                    <Text style={S.atypiquesLabel}>Points d'attention — POI atypiques</Text>
                    <Text style={[S.bodySmall, { marginBottom: 0 }]}>{geminiCluster.atypiques}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Feature table */}
            <Text style={S.subTitle}>Profil sociodémographique</Text>
            <FeatureTable
              profile={cluster.avg_profile}
              featureNames={data.feature_names}
              france={franceAverages}
              color={cluster.color}
            />

            {/* POI list — affichée seulement si pas d'analyse Gemini (gain d'espace) */}
            {!geminiCluster && cluster.poi_list.length > 0 && (
              <View>
                <Text style={[S.subTitle, { marginTop: 16 }]}>
                  Points d'intérêt du cluster ({cluster.poi_list.length})
                </Text>
                <POIList pois={cluster.poi_list} />
              </View>
            )}
            {geminiCluster && cluster.poi_list.length > 0 && (
              <View>
                <Text style={[S.subTitle, { marginTop: 8 }]}>
                  POI du cluster ({cluster.poi_list.length})
                </Text>
                <POIList pois={cluster.poi_list.slice(0, 20)} />
                {cluster.poi_list.length > 20 && (
                  <Text style={[S.tdMuted, { marginTop: 4 }]}>… et {cluster.poi_list.length - 20} autres</Text>
                )}
              </View>
            )}

            <Footer label={`Cluster ${ci} / ${data.k}`} />
          </Page>
        );
      })}

      {/* ── PAGE (si Gemini) : COMPARAISON FRANCE + POINTS D'ATTENTION ────── */}
      {analysis && (
        <Page size="A4" style={S.page}>
          <Text style={S.sectionTitle}>Positionnement réseau vs France</Text>
          <Text style={S.sectionMeta}>Analyse comparative — données INSEE Filosofi</Text>

          <Text style={[S.body, { lineHeight: 1.7, marginBottom: 20 }]}>
            {analysis.comparaison_france}
          </Text>

          <Text style={[S.sectionTitle, { marginTop: 8 }]}>Points d'attention</Text>
          <Text style={S.sectionMeta}>Recommandations transversales</Text>

          {analysis.points_attention.map((point, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={S.bulletDot}>·</Text>
              <Text style={S.bulletText}>{point}</Text>
            </View>
          ))}

          <Footer label="Comparaison & Points d'attention" />
        </Page>
      )}

      {/* ── PAGE FINALE : MÉTHODOLOGIE ────────────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>Méthodologie</Text>
        <Text style={S.sectionMeta}>
          Clustering sociodémographique sur profils Filosofi — v{data.version}
        </Text>

        {/* Résumé Gemini si disponible, sinon texte technique */}
        {analysis?.methodologie_resume ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={[S.body, { lineHeight: 1.7 }]}>{analysis.methodologie_resume}</Text>
          </View>
        ) : null}

        {[
          {
            title: '1. Données source',
            body: `Table carreaux_filosofi (INSEE Filosofi 200m²). Filtre secret statistique : individus > 11 par carreau. Carreaux exploitables : ~822 727 sur 2 298 582.`,
          },
          {
            title: '2. Profil de zone de chalandise',
            body: `Isochrone OpenRouteService ${data.duration_minutes} minutes en ${data.mode}. Intersection avec les carreaux Filosofi. Agrégation des ${data.feature_names.length} variable${data.feature_names.length > 1 ? 's' : ''} sélectionnées pour chaque POI. En cas de faible couverture, les valeurs manquantes sont imputées par la médiane des autres POI.`,
          },
          {
            title: `3. Normalisation & réduction dimensionnelle — ${data.n_pca_components} axes (${(data.variance_explained * 100).toFixed(1)}% variance)`,
            body: `Centrage-réduction (μ=0, σ=1) puis ACP avec seuil de variance à 85%. Réduit la dimensionnalité tout en conservant l'information pertinente.`,
          },
          {
            title: `4. Regroupement statistique — K=${data.k} (score de qualité ${data.silhouette_score.toFixed(3)} — ${silLabel})`,
            body: `Recherche du nombre optimal de groupes par maximisation du score de qualité sur K ∈ [3, 10]. Le K=${data.k} a été retenu comme optimal.`,
          },
        ].map(({ title, body }) => (
          <View key={title} style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#7c3aed', marginBottom: 3 }}>
              {title}
            </Text>
            <Text style={[S.body, { marginBottom: 0 }]}>{body}</Text>
          </View>
        ))}

        {/* Feature list */}
        <Text style={[S.subTitle, { marginTop: 8 }]}>Variables utilisées ({data.feature_names.length})</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {data.feature_names.map(f => (
            <View key={f} style={{
              borderWidth: 0.5, borderColor: '#d1d5db', borderRadius: 3,
              padding: '2 6', backgroundColor: '#f9fafb',
            }}>
              <Text style={{ fontSize: 8, color: '#374151' }}>
                {FEAT_SHORT[f] ?? f}
              </Text>
            </View>
          ))}
        </View>

        <Footer label="Méthodologie" />
      </Page>
    </Document>
  );
}

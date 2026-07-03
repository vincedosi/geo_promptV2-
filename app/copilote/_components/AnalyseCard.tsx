'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────
interface TrancheAge {
  id:          string;
  label:       string;
  total:       number;
  pourcentage: number;
}
interface ParRegie {
  regie:       string;
  count:       number;
  pourcentage: number;
}
interface PoiItem {
  categorie: string;
  label:     string;
  count:     number;
}
interface AnalyseOutput {
  type?:     string;
  perimetre?: {
    type:              string;
    value:             string;
    rayon_km:          number;
    source_demo?:      string;
  };
  display_perimetre?: string;
  demographie?: {
    population_totale: number;
    cible:             { indicateur: string; label: string; total: number; pourcentage: number };
    tranches_age:      TrancheAge[];
    revenu_median:     number;
  };
  panneaux?: {
    total:     number;
    par_regie: ParRegie[];
  };
  poi?: PoiItem[];
}

// ── Palette ────────────────────────────────────────────────────────────────────
const P = {
  bg:      'var(--bg-surface)',
  border:  'var(--border-subtle)',
  violet:  'var(--brand-teal)',
  green:   '#10b981',
  orange:  '#f97316',
  blue:    '#38bdf8',
  text:    'var(--text-primary)',
  dim:     'var(--text-secondary)',
  dimmer:  'var(--text-tertiary)',
  gridLn:  'rgba(255,255,255,0.06)',
};

const fontMono  = "'JetBrains Mono', monospace";
const fontInter = "'Inter', sans-serif";

// ── Metric card ────────────────────────────────────────────────────────────────
function Metric({
  value, label, color, sub,
}: { value: string; label: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: `0.5px solid ${P.border}`,
      borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
      transition: 'border-color 0.2s ease',
    }}>
      <div style={{ color, fontWeight: 700, fontSize: 22, fontFamily: fontMono, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ color: P.dim, fontSize: 11, fontFamily: fontInter, lineHeight: 1.3 }}>
        {label}
        {sub && <span style={{ color: P.dimmer }}> · {sub}</span>}
      </div>
    </div>
  );
}

// ── Section title ──────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: P.dimmer, fontSize: 9, fontFamily: fontMono,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      marginBottom: 8, marginTop: 16,
      paddingLeft: 10,
      borderLeft: `2px solid ${P.violet}`,
    }}>
      {children}
    </div>
  );
}

// ── Tooltip custom recharts ────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-level-2)', border: `0.5px solid ${P.border}`,
      borderRadius: 4, padding: '6px 10px',
      fontSize: 11, fontFamily: fontMono, color: P.text,
    }}>
      <div style={{ color: P.dim, marginBottom: 2 }}>{label}</div>
      <div style={{ color: P.text, fontWeight: 600 }}>
        {payload[0].value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}

// ── Mapping Filosofi indicateur → colonne IRIS (pour highlight tranche d'âge) ──
const CIBLE_TO_IRIS: Record<string, string> = {
  'ind':       'population',
  'ind_18_24': 'pop_15_29',
  'ind_25_39': 'pop_30_44',
  'ind_40_54': 'pop_45_59',
  'ind_55_64': 'pop_60_74',
  'ind_65_79': 'pop_60_74',
  'ind_80p':   'pop_75_plus',
  'men':       'nb_menages',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Main component ─────────────────────────────────────────────────────────────
interface AnalyseCardProps {
  output:              Record<string, unknown> | undefined;
  onFlyTo?:            (lat: number, lng: number, zoom: number) => void;
  onHighlightIris?:    (codeIris: string | null) => void;
}

const analyseCardStyles = `
@keyframes analyseCardFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .analyse-card-root { animation: none !important; }
}
`;

export function AnalyseCard({ output, onFlyTo, onHighlightIris }: AnalyseCardProps) {
  // Hooks first — React rule of hooks forbids early returns above hooks.
  const [selectedIris, setSelectedIris] = useState<string | null>(null);

  if (!output || output.type !== "analyse_complete") return null;
  const data = output as unknown as AnalyseOutput;

  const { perimetre, demographie, panneaux, poi } = data;
  if (!perimetre || !demographie) return null;

  const cible          = demographie.cible;
  const tranches       = demographie.tranches_age ?? [];
  const regies         = panneaux?.par_regie ?? [];
  const poiItems       = poi ?? [];

  // ── Régies : top 3 + "Autres" ───────────────────────────────────────────────
  const top3Regies = regies.slice(0, 3);
  const autresCount = regies.slice(3).reduce((s, r) => s + r.count, 0);
  const regiesData = [
    ...top3Regies.map(r => ({ name: truncateLabel(r.regie, 12), count: r.count })),
    ...(autresCount > 0 ? [{ name: "Autres", count: autresCount }] : []),
  ];
  const regieColors = [P.orange, '#fbbf24', '#d97706', P.dimmer];

  // ── POI data ─────────────────────────────────────────────────────────────────
  const poiData = poiItems
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(p => ({ name: truncateLabel(p.label || p.categorie, 12), count: p.count }));

  // ── Tranches âge : highlight cible ───────────────────────────────────────────
  const tranchesData = tranches.map(t => ({
    name:  truncateLabel(t.label.replace(" ans", "").replace("Adultes ", "").replace("Seniors ", "").replace("Jeunes ", ""), 10),
    total: t.total,
    pct:   t.pourcentage,
    id:    t.id,
  }));

  // ── Nombre principal de POI (premier de la liste) ────────────────────────────
  const firstPoi = poiItems[0];

  // ── Comparaison nationale cible ───────────────────────────────────────────────
  const benchPct = (output as Record<string, unknown> & { benchmarks?: { france_pop_pct?: number } }).benchmarks?.france_pop_pct ?? null;
  const diffPct  = benchPct !== null ? Math.round((cible.pourcentage - benchPct) * 10) / 10 : null;

  // ── Revenu benchmark ─────────────────────────────────────────────────────────
  const revLocal  = demographie.revenu_median;
  const revFrance = ((output as Record<string, unknown> & { benchmarks?: { france_rev_median?: number } }).benchmarks?.france_rev_median) ?? 23_080;
  const maxRev    = Math.max(revLocal, revFrance) * 1.3;
  const localPct  = maxRev > 0 ? Math.round((revLocal  / maxRev) * 100) : 0;
  const francePct = maxRev > 0 ? Math.round((revFrance / maxRev) * 100) : 0;

  // ── IRIS distribution ─────────────────────────────────────────────────────────
  const irisData = ((output as Record<string, unknown> & { iris_distribution?: Array<{ code_iris: string; nom: string; pop: number; cible: number; lat?: number | null; lng?: number | null }> }).iris_distribution ?? []);

  const cityCoords = (output as Record<string, unknown> & { coordonnees?: { lat: number; lng: number } }).coordonnees;

  const handleIrisClick = (codeIris: string) => {
    const next = codeIris === selectedIris ? null : codeIris;
    setSelectedIris(next);
    if (next) {
      const entry = irisData.find(r => r.code_iris === next);
      if (entry?.lat && entry?.lng) {
        onFlyTo?.(entry.lat, entry.lng, 15);
      } else {
        if (!entry) console.warn('[IRIS] code_iris non trouvé dans irisData:', next);
        if (cityCoords) onFlyTo?.(cityCoords.lat, cityCoords.lng, 13);
      }
    }
    onHighlightIris?.(next);
  };

  return (
    <>
    <style>{analyseCardStyles}</style>
    <div className="analyse-card-root" style={{
      marginTop: 10,
      background: 'var(--bg-surface)',
      border: `0.5px solid ${P.border}`,
      borderLeft: `3px solid ${P.violet}`,
      borderRadius: '2px 12px 12px 12px',
      padding: '14px 16px',
      fontFamily: fontInter,
      animation: 'analyseCardFadeIn 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontFamily: fontMono, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: P.violet, marginBottom: 4,
        }}>
          Analyse complète
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: P.text, letterSpacing: '0.04em' }}>
          {perimetre.value.toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: P.dim, marginTop: 3 }}>
          {(output.display_perimetre as string | undefined) ?? `Rayon ${perimetre.rayon_km} km`}
          {cible && <span> · Cible : {cible.label}</span>}
        </div>
      </div>

      {/* Metric grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
        <Metric
          value={fmt(demographie.population_totale)}
          label="Population"
          color={P.green}
        />
        <Metric
          value={fmt(cible.total)}
          label={cible.label}
          sub={`${cible.pourcentage}%${diffPct !== null ? ` (${diffPct > 0 ? "+" : ""}${diffPct} vs France)` : ""}`}
          color={P.green}
        />
        <Metric
          value={fmt(panneaux?.total ?? 0)}
          label="Panneaux OOH"
          color={P.orange}
        />
        {firstPoi ? (
          <Metric
            value={fmt(firstPoi.count)}
            label={firstPoi.label || firstPoi.categorie}
            color={P.violet}
          />
        ) : (
          <Metric value="—" label="POI" color={P.dimmer} />
        )}
      </div>

      {/* Revenu médian + barre benchmark */}
      {demographie.revenu_median > 0 && (
        <div style={{
          marginTop: 8, padding: '7px 10px',
          background: 'var(--bg-surface)', border: `1px solid ${P.border}`,
          borderRadius: 6, fontSize: 11, color: P.dim,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span>Revenu moyen / personne</span>
            <span style={{ color: P.blue, fontFamily: fontMono, fontWeight: 600 }}>
              {fmt(demographie.revenu_median)} €/an
            </span>
          </div>
          <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginTop: 14 }}>
            <div style={{
              height: '100%', borderRadius: 3, width: `${localPct}%`,
              background: revLocal >= revFrance ? P.green : '#f87171',
              transition: 'width 0.2s ease',
            }} />
            <div style={{
              position: 'absolute', top: -3, left: `${francePct}%`,
              width: 2, height: 12, background: P.dim, borderRadius: 1,
            }} />
            <div style={{
              position: 'absolute', top: -16, left: `${francePct}%`,
              transform: 'translateX(-50%)', fontSize: 8, color: P.dimmer, fontFamily: fontMono,
            }}>France</div>
          </div>
        </div>
      )}

      {/* Tranches d'âge */}
      {tranchesData.length > 0 && (
        <>
          <SectionTitle>Répartition par tranche d'âge</SectionTitle>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={tranchesData} layout="vertical" barSize={12}
              margin={{ top: 0, right: 40, left: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={P.gridLn} />
              <XAxis type="number" tick={{ fontSize: 9, fill: P.dimmer, fontFamily: fontMono }}
                axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name"
                tick={{ fontSize: 9, fill: P.dim, fontFamily: fontMono }}
                axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(78,205,196,0.06)" }} />
              <Bar dataKey="total" radius={[0, 2, 2, 0]}>
                {tranchesData.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill={entry.id === CIBLE_TO_IRIS[cible?.indicateur ?? ''] ? P.green : 'rgba(78,205,196,0.3)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Régies OOH */}
      {regiesData.length > 0 && (
        <>
          <SectionTitle>Régies OOH</SectionTitle>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={regiesData} barSize={20}
              margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={P.gridLn} />
              <XAxis dataKey="name"
                tick={{ fontSize: 9, fill: P.dim, fontFamily: fontMono }}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: P.dimmer, fontFamily: fontMono }}
                axisLine={false} tickLine={false} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(249,115,22,0.06)" }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {regiesData.map((_, i) => (
                  <Cell key={i} fill={regieColors[i] ?? P.dimmer} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      {/* POI par catégorie */}
      {poiData.length > 1 && (
        <>
          <SectionTitle>Points d'intérêt par catégorie</SectionTitle>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={poiData} barSize={18}
              margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={P.gridLn} />
              <XAxis dataKey="name"
                tick={{ fontSize: 9, fill: P.dim, fontFamily: fontMono }}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: P.dimmer, fontFamily: fontMono }}
                axisLine={false} tickLine={false} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(78,205,196,0.06)" }} />
              <Bar dataKey="count" fill={P.violet} radius={[2, 2, 0, 0]} fillOpacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Top quartiers IRIS — interactif */}
      {irisData.length > 3 && (
        <>
          <SectionTitle>
            Top quartiers — {cible.label}
            {selectedIris && (
              <span
                onClick={() => { setSelectedIris(null); onHighlightIris?.(null); }}
                style={{ marginLeft: 8, color: P.violet, cursor: "pointer", fontWeight: 600 }}
              >✕</span>
            )}
          </SectionTitle>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={irisData.slice(0, 10).map(r => ({ ...r, nom: truncateLabel(r.nom, 16) }))} barSize={14}
              margin={{ top: 0, right: 8, left: 4, bottom: 40 }}>
              <XAxis dataKey="nom"
                tick={{ fontSize: 7, fill: P.dimmer, fontFamily: fontMono }}
                axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={45} />
              <YAxis tick={{ fontSize: 9, fill: P.dimmer, fontFamily: fontMono }}
                axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(16,185,129,0.06)" }} />
              <Bar
                dataKey="cible"
                radius={[2, 2, 0, 0]}
                cursor="pointer"
                onClick={(data: unknown) => {
                  const code = (data as { code_iris?: string } | undefined)?.code_iris;
                  if (code) handleIrisClick(code);
                }}
              >
                {irisData.slice(0, 10).map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.code_iris === selectedIris ? P.green : "rgba(16,185,129,0.4)"}
                    fillOpacity={entry.code_iris === selectedIris ? 1 : 0.75}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Footer source */}
      <div style={{
        marginTop: 16, paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        fontSize: 9, color: "var(--text-tertiary)", fontFamily: fontMono,
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4,
      }}>
        <span>{(output as Record<string, unknown> & { metadata?: { source?: string; date_source?: string } }).metadata?.source ?? "Carreaux Filosofi"} · Millésime {(output as Record<string, unknown> & { metadata?: { date_source?: string } }).metadata?.date_source ?? "2022"}</span>
        <span>Rapport du {(output as Record<string, unknown> & { metadata?: { generated_at?: string } }).metadata?.generated_at ?? new Date().toISOString().split("T")[0]}</span>
      </div>
    </div>
    </>
  );
}

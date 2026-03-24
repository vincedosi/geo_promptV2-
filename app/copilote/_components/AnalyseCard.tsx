'use client';

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
    type:     string;
    value:    string;
    rayon_km: number;
  };
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
  bg:      'rgba(255,255,255,0.035)',
  border:  '#261a35',
  violet:  '#a855f7',
  green:   '#10b981',
  orange:  '#f97316',
  blue:    '#38bdf8',
  text:    '#f1f1f4',
  dim:     '#9ca3af',
  dimmer:  '#6b7280',
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
      background: P.bg, border: `1px solid ${P.border}`,
      borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
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
      background: '#131320', border: `1px solid ${P.border}`,
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function AnalyseCard({ output }: { output: Record<string, unknown> | undefined }) {
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

  return (
    <div style={{
      marginTop: 10,
      background: 'rgba(10,10,20,0.6)',
      border: `1px solid ${P.border}`,
      borderLeft: `3px solid ${P.violet}`,
      borderRadius: '2px 12px 12px 12px',
      padding: '14px 16px',
      fontFamily: fontInter,
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
          Rayon {perimetre.rayon_km} km
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
          sub={`${cible.pourcentage}%`}
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

      {/* Revenu médian */}
      {demographie.revenu_median > 0 && (
        <div style={{
          marginTop: 8, padding: '7px 10px',
          background: P.bg, border: `1px solid ${P.border}`,
          borderRadius: 6, fontSize: 11, color: P.dim,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>Revenu moyen / personne</span>
          <span style={{ color: P.blue, fontFamily: fontMono, fontWeight: 600 }}>
            {fmt(demographie.revenu_median)} €/an
          </span>
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
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(168,85,247,0.06)" }} />
              <Bar dataKey="total" radius={[0, 2, 2, 0]}>
                {tranchesData.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill={entry.id === cible?.indicateur ? P.green : 'rgba(168,85,247,0.35)'}
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
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(168,85,247,0.06)" }} />
              <Bar dataKey="count" fill={P.violet} radius={[2, 2, 0, 0]} fillOpacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

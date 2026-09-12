'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { formaterNombreArrondi } from '@/lib/format/nombre';

// ── Types ────────────────────────────────────────────────────────────────────
interface ResultatLigne {
  code:       string;
  nom:        string;
  population: number;
  valeur:     number;
  part:       number | null;
  classe:     'effectif' | 'proportion' | 'densite';
  lat:        number | null;
  lng:        number | null;
}

interface IndicateurDisponible {
  key:   string;
  label: string;
}

interface ClassementOutput {
  type?:                                    string;
  error?:                                   string;
  indicateurs_disponibles?:                 IndicateurDisponible[];
  indicateur?:                              string;
  indicateur_label?:                        string;
  palier?:                                  'commune' | 'departement';
  palier_label?:                            string;
  tri?:                                     'volume' | 'part';
  classe?:                                  'effectif' | 'proportion' | 'densite' | null;
  plancher_population?:                     number;
  plancher_population_applique_par_defaut?: boolean;
  regrouper_arrondissements?:               boolean;
  limite?:                                  number;
  resultats?:                               ResultatLigne[];
}

// ── Palette — tokens du design system, jamais de hex en dur ─────────────────
const P = {
  border:  'var(--border-subtle)',
  teal:    'var(--brand-teal)',
  text:    'var(--text-primary)',
  dim:     'var(--text-secondary)',
  dimmer:  'var(--text-tertiary)',
  gridLn:  'rgba(255,255,255,0.06)',
  danger:  'var(--danger)',
  warning: 'var(--warning)',
};

const fontMono  = "'JetBrains Mono', monospace";
const fontInter = "'Inter', sans-serif";

function truncateLabel(s: string, max = 16): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatPart(part: number | null): string {
  if (part == null) return '—';
  return `${part.toFixed(1).replace('.', ',')} %`;
}

// ── Tooltip custom recharts (patron AnalyseCard) ────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number; payload: { part: number | null; classe: string } }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const { part, classe } = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-level-2)', border: `0.5px solid ${P.border}`,
      borderRadius: 4, padding: '6px 10px',
      fontSize: 11, fontFamily: fontMono, color: P.text,
    }}>
      <div style={{ color: P.dim, marginBottom: 2 }}>{label}</div>
      <div style={{ color: P.text, fontWeight: 600 }}>
        {payload[0].value.toLocaleString('fr-FR')}
      </div>
      {classe === 'effectif' && part != null && (
        <div style={{ color: P.dimmer, marginTop: 2 }}>{formatPart(part)} de la population</div>
      )}
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────
interface ClassementCardProps {
  output:   Record<string, unknown> | undefined;
  onFlyTo?: (lat: number, lng: number, zoom: number) => void;
}

export function ClassementCard({ output, onFlyTo }: ClassementCardProps) {
  if (!output || output.type !== 'classement_territoires') return null;
  const data = output as unknown as ClassementOutput;

  // ── État d'erreur : message FR + suggestions d'indicateurs valides ────────
  if (data.error) {
    const suggestions = (data.indicateurs_disponibles ?? []).slice(0, 12);
    return (
      <div style={{
        marginTop: 10,
        background: 'var(--bg-surface)',
        border: `0.5px solid ${P.border}`,
        borderLeft: `3px solid ${P.danger}`,
        borderRadius: '2px 12px 12px 12px',
        padding: '14px 16px',
        fontFamily: fontInter,
      }}>
        <div style={{
          fontSize: 11, fontFamily: fontMono, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: P.danger, marginBottom: 6,
        }}>
          Classement impossible
        </div>
        <div style={{ fontSize: 13, color: P.text, lineHeight: 1.5 }}>{data.error}</div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(s => (
              <span key={s.key} style={{
                background: 'var(--bg-level-2)', border: `0.5px solid ${P.border}`,
                borderRadius: 4, padding: '2px 8px', fontSize: 10, color: P.dim,
                fontFamily: fontMono,
              }}>
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const resultats = data.resultats ?? [];
  if (resultats.length === 0) return null;

  const tri            = data.tri ?? 'volume';
  const classe          = data.classe ?? resultats[0]?.classe;
  const estEffectif     = classe === 'effectif';
  const dataKeyGraphe    = tri === 'part' ? 'part' : 'valeur';
  const zoom            = data.palier === 'departement' ? 8 : 12;

  const chartData = resultats
    .filter(r => (dataKeyGraphe === 'part' ? r.part != null : true))
    .map(r => ({
      name:   truncateLabel(r.nom, 16),
      valeur: r.valeur,
      part:   r.part,
      classe: r.classe,
      code:   r.code,
    }));

  const handleClick = (row: ResultatLigne) => {
    if (row.lat != null && row.lng != null) onFlyTo?.(row.lat, row.lng, zoom);
  };

  return (
    <div style={{
      marginTop: 10,
      background: 'var(--bg-surface)',
      border: `0.5px solid ${P.border}`,
      borderLeft: `3px solid ${P.teal}`,
      borderRadius: '2px 12px 12px 12px',
      padding: '14px 16px',
      fontFamily: fontInter,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 11, fontFamily: fontMono, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: P.teal, marginBottom: 4,
        }}>
          Classement de territoires
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>
          {data.indicateur_label ?? data.indicateur}
        </div>
        <div style={{ fontSize: 11, color: P.dim, marginTop: 3 }}>
          Top {resultats.length} {data.palier_label ?? 'communes'} · tri par {tri === 'part' ? 'part' : 'volume'}
        </div>
      </div>

      {/* Notices — pièges de la donnée signalés, jamais masqués */}
      {(data.plancher_population_applique_par_defaut || (data.palier === 'commune' && data.regrouper_arrondissements)) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {data.plancher_population_applique_par_defaut && (
            <div style={{
              fontSize: 10.5, color: P.warning, background: 'rgba(247,183,49,0.1)',
              border: '0.5px solid rgba(247,183,49,0.2)', borderRadius: 4, padding: '5px 8px',
              fontFamily: fontInter,
            }}>
              Seuil de population appliqué par défaut : {formaterNombreArrondi(data.plancher_population)} habitants
              (sans seuil, une très petite commune fausserait le classement en part).
            </div>
          )}
          {data.palier === 'commune' && data.regrouper_arrondissements && (
            <div style={{
              fontSize: 10.5, color: P.dim, background: 'var(--bg-level-2)',
              border: `0.5px solid ${P.border}`, borderRadius: 4, padding: '5px 8px',
              fontFamily: fontInter,
            }}>
              Paris, Lyon et Marseille sont reconstituées depuis leurs arrondissements.
            </div>
          )}
        </div>
      )}

      {/* Histogramme */}
      <ResponsiveContainer width="100%" height={Math.min(260, 32 * chartData.length + 20)}>
        <BarChart data={chartData} layout="vertical" barSize={14}
          margin={{ top: 0, right: 40, left: 4, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={P.gridLn} />
          <XAxis type="number" tick={{ fontSize: 9, fill: P.dimmer, fontFamily: fontMono }}
            axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name"
            tick={{ fontSize: 9, fill: P.dim, fontFamily: fontMono }}
            axisLine={false} tickLine={false} width={90} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(78,205,196,0.06)' }} />
          <Bar
            dataKey={dataKeyGraphe}
            radius={[0, 2, 2, 0]}
            cursor="pointer"
            onClick={(entry: unknown) => {
              const code = (entry as { code?: string } | undefined)?.code;
              const row = resultats.find(r => r.code === code);
              if (row) handleClick(row);
            }}
          >
            {chartData.map((entry) => (
              <Cell key={entry.code} fill="rgba(78,205,196,0.55)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Tableau */}
      <div style={{ marginTop: 14, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `0.5px solid ${P.border}` }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: P.dimmer, fontWeight: 400, fontFamily: fontMono, fontSize: 10 }}>#</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: P.dimmer, fontWeight: 400, fontFamily: fontMono, fontSize: 10 }}>Territoire</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', color: P.dimmer, fontWeight: 400, fontFamily: fontMono, fontSize: 10 }}>Population</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', color: P.dimmer, fontWeight: 400, fontFamily: fontMono, fontSize: 10 }}>Valeur</th>
              {estEffectif && (
                <th style={{ textAlign: 'right', padding: '4px 6px', color: P.dimmer, fontWeight: 400, fontFamily: fontMono, fontSize: 10 }}>Part</th>
              )}
            </tr>
          </thead>
          <tbody>
            {resultats.map((r, i) => {
              const cliquable = r.lat != null && r.lng != null;
              return (
                <tr
                  key={r.code}
                  onClick={() => cliquable && handleClick(r)}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: cliquable ? 'pointer' : 'default',
                    opacity: cliquable ? 1 : 0.6,
                  }}
                >
                  <td style={{ padding: '5px 6px', color: P.dimmer, fontFamily: fontMono }}>{i + 1}</td>
                  <td style={{ padding: '5px 6px', color: P.text }}>{r.nom}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: P.dim, fontFamily: fontMono }}>
                    {formaterNombreArrondi(r.population)}
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: P.teal, fontFamily: fontMono, fontWeight: 600 }}>
                    {formaterNombreArrondi(r.valeur)}
                  </td>
                  {estEffectif && (
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: P.dim, fontFamily: fontMono }}>
                      {formatPart(r.part)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer source */}
      <div style={{
        marginTop: 14, paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: 9, color: P.dimmer, fontFamily: fontMono,
      }}>
        INSEE RP 2022 / Filosofi 2021 — palier {data.palier_label ?? 'communes'}
      </div>
    </div>
  );
}

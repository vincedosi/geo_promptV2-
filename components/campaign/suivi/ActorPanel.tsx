'use client';

/**
 * ActorPanel — panneau « Par acteur » du Suivi : une ligne par acteur
 * sélectionné (livré · dépense · CPM · part · atteinte objectif) + bar-chart de
 * répartition du volume. Données de get_campaign_actors (non filtrées ; le
 * panneau n'affiche que les acteurs cochés).
 */
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  actorDisplayName, actorKindLabel, fmtCpm, fmtInt, fmtPct, isAllActors,
  type ActorRow,
} from '@/lib/campaigns/actor-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = { padding: '7px 10px', fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const headStyle = { padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const };

export function ActorPanel({ actors, selected }: { actors: ActorRow[]; selected: string[] }) {
  if (actors.length <= 1) return null;
  const allSelected = isAllActors(selected, actors.length);
  const rows = allSelected ? actors : actors.filter((a) => selected.includes(a.actor));
  if (rows.length === 0) return null;
  const chart = rows.map((a) => ({ name: actorDisplayName(a.actor), value: a.impressions }));

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Par acteur</span>
      </div>

      <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...headStyle, textAlign: 'left' }}>Acteur</th>
              <th style={headStyle}>Livré</th>
              <th style={headStyle}>Dépense</th>
              <th style={headStyle}>CPM</th>
              <th style={headStyle}>Part</th>
              <th style={headStyle}>Atteinte objectif</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.actor} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-primary)' }}>
                  {actorDisplayName(a.actor)}
                  <span style={{ marginLeft: 8, fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 5px' }}>
                    {actorKindLabel(a.kind)}
                  </span>
                </td>
                <td style={cellStyle}>{fmtInt(a.impressions)}</td>
                <td style={cellStyle}>{fmtInt(a.spend)} €</td>
                <td style={cellStyle}>{fmtCpm(a.cpm)}</td>
                <td style={cellStyle}>{fmtPct(a.share_pct)}</td>
                <td style={cellStyle}>{fmtPct(a.objective_attainment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ height: 120, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="name" tick={{ fontFamily: fInter, fontSize: 10, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, fontFamily: fMono, fontSize: 11 }}
              formatter={(v) => [fmtInt(Number(v)), 'livré']}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chart.map((_, i) => <Cell key={i} fill="var(--brand-teal)" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

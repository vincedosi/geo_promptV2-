'use client';

/**
 * SuiviCockpit — tuiles de tête + alertes du cockpit de suivi (spec
 * 2026-07-17). Composant d'affichage pur : le payload vient de
 * GET /api/digital/[id]/suivi (fetché par CampaignSuivi), les couleurs des
 * helpers purs de lib/campaigns/suivi-metrics. Lecture par exception :
 * 4 chiffres de tête, puis uniquement ce qui sort des rails.
 */
import {
  cpmTone, fmtCpm, fmtInt, fmtPct, holdTone, pacingTone, toneColor,
  type SuiviPayload, type SuiviTone,
} from '@/lib/campaigns/suivi-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

function fmtDateFr(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: SuiviTone }) {
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 140, border: '0.5px solid var(--border-subtle)',
      borderLeft: `2px solid ${toneColor(tone)}`, borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div style={{ fontFamily: fMono, fontSize: 15, color: 'var(--text-primary)', margin: '4px 0 2px' }}>{value}</div>
      <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</div>
    </div>
  );
}

export function SuiviCockpit({
  payload, onShowMap,
}: {
  payload: SuiviPayload;
  /** Présent uniquement quand la carte est disponible (page /map). */
  onShowMap?: (metric: 'hold' | 'cpm') => void;
}) {
  const { pacing, cpm, pressure, objective, alerts } = payload;
  const planShareCible = payload.level1.find((l) => l.zone === 'cible')?.share_plan ?? null;

  // Tuile pression : deux lectures selon le mode de diffusion.
  const exclusion = pressure.mode === 'exclusion';
  const pressureValue = exclusion
    ? fmtPct(pressure.in_target_share)
    : `×${pressure.requested ?? '—'} · ×${pressure.obtained ?? '—'}`;
  const pressureSub = exclusion
    ? `volume dans la cible · plan : ${fmtPct(planShareCible)}`
    : 'demandée · obtenue';
  const pressureTone: SuiviTone = exclusion
    ? holdTone(planShareCible ? ((pressure.in_target_share ?? 0) / planShareCible) * 100 : null)
    : holdTone(pressure.requested && pressure.obtained ? (pressure.obtained / pressure.requested) * 100 : null);

  const objectiveTone = pacingTone(objective.pct != null ? objective.pct / 100 : null);
  const objectiveSub = objective.basis === 'kpi'
    ? `${fmtInt(objective.realized)} vs ${fmtInt(objective.expected)} (KPI cible)`
    : `${fmtInt(objective.realized)} vs ${fmtInt(objective.expected)} (trajectoire budget)`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
          À jour au {fmtDateFr(payload.as_of)} · période {fmtDateFr(payload.start_date)} → {fmtDateFr(payload.end_date)}
        </span>
        {onShowMap && (
          <button
            type="button"
            onClick={() => onShowMap('hold')}
            style={{
              marginLeft: 'auto', background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 12px',
              fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Voir sur la carte
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tile
          label="Pacing"
          value={`${fmtPct(pacing.budget_pct)} · ${fmtPct(pacing.time_pct)}`}
          sub={`budget · temps — indice ${pacing.index ?? '—'}`}
          tone={pacingTone(pacing.index)}
        />
        <Tile
          label="CPM"
          value={`${fmtCpm(cpm.real)} vs ${fmtCpm(cpm.forecast)}`}
          sub={cpm.delta_pct != null ? `${cpm.delta_pct > 0 ? '+' : ''}${fmtPct(cpm.delta_pct)} vs prévu` : 'pas de CPM prévu'}
          tone={cpmTone(cpm.real, cpm.forecast)}
        />
        <Tile label="Pression" value={pressureValue} sub={pressureSub} tone={pressureTone} />
        <Tile label="Objectif" value={fmtPct(objective.pct)} sub={objectiveSub} tone={objectiveTone} />
      </div>

      {alerts.length === 0 ? (
        <div style={{
          fontFamily: fInter, fontSize: 12, color: 'var(--success)',
          border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px', marginBottom: 14,
        }}>
          Tout est dans les rails ✓
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {alerts.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (a.kind === 'zones_under' || a.kind === 'leak') {
                  document.getElementById('suivi-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10, textAlign: 'left',
                border: '0.5px solid var(--border-subtle)',
                borderLeft: `2px solid ${a.severity === 'danger' ? 'var(--danger)' : 'var(--warning)'}`,
                borderRadius: 8, padding: '8px 12px', background: 'transparent',
                cursor: a.kind === 'zones_under' || a.kind === 'leak' ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{a.title}</span>
              <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>{a.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

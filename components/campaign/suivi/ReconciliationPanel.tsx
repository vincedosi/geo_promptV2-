'use client';

/**
 * ReconciliationPanel — section « Réconciliation DSP ⇔ mesure » du cockpit
 * Suivi (spec 2026-07-18). Tuile taux de mesure + composition de l'achat par
 * canal + écart vs ad server. Données de get_campaign_reconciliation ; les
 * canaux/format/création restent DSP-only tant que l'ad server ne les porte pas.
 */
import {
  fmtCpm, fmtInt, fmtPct, measureRateTone, toneColor,
  type ReconciliationPayload,
} from '@/lib/campaigns/reconciliation-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = { padding: '7px 10px', fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const headStyle = { padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const };

export function ReconciliationPanel({
  payload, onPull, pulling, canPull, onShowMap,
}: {
  payload: ReconciliationPayload | null;
  onPull: () => void;
  pulling: boolean;
  canPull: boolean;
  onShowMap?: (metric: 'measure' | 'dspcpm') => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
          Réconciliation DSP ⇔ mesure
        </span>
        {canPull && (
          <button type="button" onClick={onPull} disabled={pulling}
            style={{ background: 'transparent', border: '0.5px solid var(--border-default)', color: 'var(--text-secondary)', borderRadius: 6, padding: '5px 12px', fontFamily: fInter, fontSize: 11, cursor: pulling ? 'wait' : 'pointer' }}>
            {pulling ? 'Actualisation…' : 'Actualiser depuis les DSP'}
          </button>
        )}
      </div>

      {!payload || !payload.has_dsp_report ? (
        <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>
          Aucun rapport DSP encore. {canPull ? 'Actualise depuis les DSP connectés pour réconcilier livré vs mesuré.' : 'Un rapport DSP est nécessaire pour réconcilier.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, alignItems: 'stretch' }}>
            <div style={{ flex: '1 1 180px', minWidth: 160, border: '0.5px solid var(--border-subtle)', borderLeft: `2px solid ${toneColor(measureRateTone(payload.global?.measure_rate ?? null))}`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Taux de mesure</div>
              <div style={{ fontFamily: fMono, fontSize: 15, color: 'var(--text-primary)', margin: '4px 0 2px' }}>{fmtPct(payload.global?.measure_rate ?? null)}</div>
              <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)' }}>
                {fmtInt(payload.global?.adserver_impressions ?? null)} mesuré / {fmtInt(payload.global?.dsp_impressions ?? null)} livré{payload.source === 'simulated' ? ' · simulé' : ''}
              </div>
            </div>
            {onShowMap && (
              <button type="button" onClick={() => onShowMap('measure')}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', borderRadius: 6, padding: '6px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                Voir sur la carte
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ ...headStyle, textAlign: 'left' }}>Canal</th>
                  <th style={headStyle}>Livré (DSP)</th>
                  <th style={headStyle}>Dépense</th>
                  <th style={headStyle}>CPM DSP</th>
                  <th style={headStyle}>Part</th>
                </tr>
              </thead>
              <tbody>
                {(payload.by_channel ?? []).map((c) => (
                  <tr key={c.channel} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-primary)' }}>{c.channel}</td>
                    <td style={cellStyle}>{fmtInt(c.impressions)}</td>
                    <td style={cellStyle}>{fmtInt(c.spend)} €</td>
                    <td style={cellStyle}>{fmtCpm(c.cpm)}</td>
                    <td style={cellStyle}>{fmtPct(c.share_pct)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg-level-2)' }}>
                  <td style={{ ...cellStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>Mesuré ad server</td>
                  <td style={cellStyle}>{fmtInt(payload.global?.adserver_impressions ?? null)}</td>
                  <td style={cellStyle}>—</td>
                  <td style={cellStyle}>—</td>
                  <td style={cellStyle}>écart {fmtPct(payload.global?.gap_pct ?? null)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

/**
 * SuiviTable — tableau hiérarchique du cockpit de suivi (spec 2026-07-17) :
 *   niveau 1 : Cible / Hors cible (payload.level1) ;
 *   niveau 2 : départements triés du pire indice de tenue au meilleur
 *              (payload.depts, pagination locale par 20) ;
 *   niveau 3 : les CP d'un département au clic — fetch à la demande
 *              (GET /suivi/cps?dept=), cache en ref, jamais plus de 500 lignes.
 * Anti-12 000 CP : on ne montre jamais la liste complète des CP.
 */
import { useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  fmtCpm, fmtInt, fmtPct, holdTone, alignmentTone, toneColor,
  type SuiviCpRow, type SuiviPayload, type SuiviTone,
} from '@/lib/campaigns/suivi-metrics';
import { actorsKey } from '@/lib/campaigns/actor-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = {
  padding: '7px 10px', fontFamily: fMono, fontSize: 11.5,
  color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const,
};
const headStyle = {
  padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const,
  letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const,
};

/** Badge « x % » coloré par ton (tenue du plan ou atteinte objectif). */
function ToneBadge({ value, tone }: { value: number | null; tone: SuiviTone }) {
  return (
    <span style={{
      fontFamily: fMono, fontSize: 11, padding: '1px 7px', borderRadius: 4,
      border: `0.5px solid ${toneColor(tone)}`, color: toneColor(tone),
    }}>
      {value != null ? `${value} %` : '—'}
    </span>
  );
}

function fmtDelta(v: number | null): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${fmtPct(v)}`;
}

export function SuiviTable({
  payload, campaignId, actors, onShowMap, showObjective = true,
}: {
  payload: SuiviPayload;
  campaignId: string;
  actors: string[];
  onShowMap?: (metric: 'objectif') => void;
  /** false sous filtre acteur partiel : l'atteinte objectif par zone lit
   *  l'objectif GLOBAL (pas la part de l'acteur) → afficher la contribution
   *  d'un acteur comme une atteinte absolue est trompeur. On masque le bloc. */
  showObjective?: boolean;
}) {
  const [openDepts, setOpenDepts] = useState<Set<string>>(new Set());
  const [visibleDepts, setVisibleDepts] = useState(20);
  const [loadingDept, setLoadingDept] = useState<string | null>(null);
  const cpCacheRef = useRef(new Map<string, SuiviCpRow[]>());
  // Compteur de rendu forcé après remplissage du cache (la ref ne re-rend pas).
  const [, setCpVersion] = useState(0);
  // Clé de cache des acteurs, stable entre l'écriture (toggleDept) et la lecture
  // (boucle de rendu) — un seul calcul par changement de sélection.
  const aKey = useMemo(() => actorsKey(actors), [actors]);

  const toggleDept = async (dept: string) => {
    const next = new Set(openDepts);
    if (next.has(dept)) {
      next.delete(dept);
      setOpenDepts(next);
      return;
    }
    next.add(dept);
    setOpenDepts(next);
    const cacheKey = `${dept}|${aKey}`;
    if (!cpCacheRef.current.has(cacheKey)) {
      setLoadingDept(dept);
      try {
        const actorsQ = actors.length ? `&actors=${encodeURIComponent(actors.join(','))}` : '';
        const res = await adminFetch(`/api/digital/${campaignId}/suivi/cps?dept=${dept}${actorsQ}`, { cache: 'no-store' });
        const d = res.ok ? await res.json() : { cps: [] };
        cpCacheRef.current.set(cacheKey, d.cps ?? []);
        setCpVersion((v) => v + 1);
      } finally {
        setLoadingDept(null);
      }
    }
  };

  const depts = payload.depts.slice(0, visibleDepts);

  return (
    <div id="suivi-table" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          Zones — triées du pire indice au meilleur
        </span>
      </div>

      {showObjective && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 8px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--danger)' }}>{payload.objective_zones.under}</strong> zones sous l&apos;objectif
            {' · '}
            <strong style={{ color: 'var(--brand-teal)' }}>{payload.objective_zones.over}</strong> au-dessus
          </span>
          {onShowMap && (
            <button
              type="button"
              onClick={() => onShowMap('objectif')}
              style={{
                marginLeft: 'auto', background: 'transparent', border: '0.5px solid var(--brand-teal)',
                color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 12px',
                fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              }}
            >
              Voir l&apos;objectif sur la carte
            </button>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...headStyle, textAlign: 'left' }}>Zone</th>
              <th style={headStyle}>Impressions</th>
              <th style={headStyle}>Tenue du plan</th>
              {showObjective && <th style={headStyle}>Atteinte objectif</th>}
              <th style={headStyle}>CPM</th>
              <th style={headStyle}>Spend</th>
              <th style={headStyle}>Δ 7 j</th>
            </tr>
          </thead>
          <tbody>
            {payload.level1.map((l) => (
              <tr key={l.zone} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-level-2)' }}>
                <td style={{ ...cellStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {l.zone === 'cible' ? 'Cible' : 'Hors cible'}
                </td>
                <td style={cellStyle}>{fmtInt(l.impressions)}</td>
                <td style={cellStyle}>
                  {fmtPct(l.share_real)} <span style={{ color: 'var(--text-tertiary)' }}>/ plan {fmtPct(l.share_plan)}</span>
                </td>
                {showObjective && <td style={cellStyle}>—</td>}
                <td style={cellStyle}>{fmtCpm(l.cpm)}</td>
                <td style={cellStyle}>{fmtInt(l.spend)} €</td>
                <td style={cellStyle}>—</td>
              </tr>
            ))}

            {depts.map((d) => {
              const open = openDepts.has(d.dept);
              const cacheKey = `${d.dept}|${aKey}`;
              const cps = cpCacheRef.current.get(cacheKey);
              return [
                <tr
                  key={d.dept}
                  onClick={() => { void toggleDept(d.dept); }}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                >
                  <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-primary)' }}>
                    <span aria-hidden style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                    {d.dept}
                    {d.in_target && (
                      <span style={{ marginLeft: 8, fontFamily: fInter, fontSize: 9, color: 'var(--brand-teal)', border: '0.5px solid var(--brand-teal-30)', borderRadius: 4, padding: '1px 5px' }}>
                        cible
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>{fmtInt(d.impressions)}</td>
                  <td style={cellStyle}><ToneBadge value={d.hold_index} tone={holdTone(d.hold_index)} /></td>
                  {showObjective && <td style={cellStyle}><ToneBadge value={d.objective_alignment} tone={alignmentTone(d.objective_alignment)} /></td>}
                  <td style={cellStyle}>{fmtCpm(d.cpm)}</td>
                  <td style={cellStyle}>{fmtInt(d.spend)} €</td>
                  <td style={cellStyle}>{fmtDelta(d.delta7_pct)}</td>
                </tr>,
                ...(open
                  ? (cps ?? []).map((c) => (
                      <tr key={`${d.dept}-${c.postal_code}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ ...cellStyle, textAlign: 'left', paddingLeft: 34 }}>
                          {c.postal_code}
                          {c.in_target && <span style={{ marginLeft: 8, color: 'var(--brand-teal)', fontSize: 10 }}>●</span>}
                        </td>
                        <td style={cellStyle}>{fmtInt(c.impressions)}</td>
                        <td style={cellStyle}><ToneBadge value={c.hold_index} tone={holdTone(c.hold_index)} /></td>
                        {showObjective && <td style={cellStyle}><ToneBadge value={c.objective_alignment} tone={alignmentTone(c.objective_alignment)} /></td>}
                        <td style={cellStyle}>{fmtCpm(c.cpm)}</td>
                        <td style={cellStyle}>{fmtInt(c.spend)} €</td>
                        <td style={cellStyle}>{fmtDelta(c.delta7_pct)}</td>
                      </tr>
                    ))
                  : []),
                ...(open && loadingDept === d.dept
                  ? [(
                      <tr key={`${d.dept}-loading`}>
                        <td colSpan={showObjective ? 7 : 6} style={{ ...cellStyle, textAlign: 'left', paddingLeft: 34, fontFamily: fInter, color: 'var(--text-tertiary)' }}>
                          Chargement des CP…
                        </td>
                      </tr>
                    )]
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {payload.depts.length > visibleDepts && (
        <button
          type="button"
          onClick={() => setVisibleDepts((v) => v + 20)}
          style={{
            marginTop: 8, background: 'transparent', border: '0.5px solid var(--border-default)',
            color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px',
            fontFamily: fInter, fontSize: 11, cursor: 'pointer',
          }}
        >
          Afficher plus ({payload.depts.length - visibleDepts} départements restants)
        </button>
      )}
    </div>
  );
}

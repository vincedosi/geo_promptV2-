/**
 * MAGELIAN — panneau « OOH » du back-office Data Sources.
 *
 * Synthese des panneaux d'affichage : volumes, regies, types et top villes.
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import type { SourcesStats } from '../_lib/types';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface OohPanelProps {
  sourcesStats: SourcesStats | null;
  sourcesStatsLoading: boolean;
}

export function OohPanel({ sourcesStats, sourcesStatsLoading }: OohPanelProps) {
      const warn = C.warn;
      const warnDim = C.warnDim;
      const warnBorder = `${C.warn}44`;
      const ss = sourcesStats;
      if (!ss) return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
          {sourcesStatsLoading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
        </div>
      );
      const maxType = (ss.ooh.types ?? [])[0]?.nb ?? 1;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
          {/* Header card */}
          <div style={{ background: warnDim, border: `0.5px solid ${warnBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: warn, letterSpacing: 1, marginBottom: 6 }}>
                Data Lake OOH — panneaux_affichage
              </div>
              <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                <span style={{ color: C.textSec }}>Régies: </span><span style={{ color: C.text }}>{(ss.ooh.regies ?? []).slice(0, 5).join(', ')}{(ss.ooh.regies ?? []).length > 5 ? ` +${(ss.ooh.regies ?? []).length - 5}` : ''}</span><br />
                <span style={{ color: C.textSec }}>Sources: </span><span style={{ color: C.text }}>{(ss.ooh.sources ?? []).join(', ')}</span><br />
                <span style={{ color: C.textSec }}>Villes: </span>{ss.ooh.nb_villes} villes couvertes<br />
                <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>panneaux_affichage</span> (actif = true)
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: warn, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                {ss.ooh.total.toLocaleString('fr-FR')}
              </div>
              <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                panneaux actifs
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: 'Villes',   value: ss.ooh.nb_villes,              color: warn },
              { label: 'Régies',   value: (ss.ooh.regies ?? []).length,   color: C.accent },
              { label: 'Types',    value: (ss.ooh.types ?? []).length,    color: '#60a5fa' },
            ].map(({ label, value, color }, idx) => (
              <div key={label} style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 14px', transition: 'all 0.2s ease', animation: `srcFadeIn 0.4s ease-out ${0.05 * idx}s both` }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 700, color, animation: 'srcCountUp 0.5s ease-out' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Types de panneaux */}
            <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
              <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: warn, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                Types de panneaux (top 10)
              </div>
              {(ss.ooh.types ?? []).map(({ type, nb }) => {
                const pct = Math.round(nb / maxType * 100);
                return (
                  <div key={type} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{type}</span>
                      <span style={{ fontFamily: fontMono, fontSize: 10, color: warn, fontWeight: 700, flexShrink: 0 }}>{nb.toLocaleString('fr-FR')}</span>
                    </div>
                    <div style={{ height: 3, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: warn, borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Top 20 villes */}
            <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: warn, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                Top 20 villes
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: C.bgSurface, position: 'sticky', top: 0 }}>
                      {['#', 'Ville', 'Panneaux'].map((h) => (
                        <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(ss.ooh.top_villes ?? []).map((v, i) => (
                      <tr
                        key={v.ville}
                        style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-level-2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                      >
                        <td style={{ padding: '5px 12px', color: C.muted, width: 30 }}>{i + 1}</td>
                        <td style={{ padding: '5px 12px', color: C.text, fontWeight: 600 }}>{v.ville}</td>
                        <td style={{ padding: '5px 12px', color: warn, fontWeight: 700 }}>{v.nb}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      );
}

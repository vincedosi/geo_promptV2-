/**
 * MAGELIAN — panneau « Transport » du back-office Data Sources.
 *
 * Arrets de transport, flux routiers et scoring des panneaux par ville.
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import type { TransportStats } from '../_lib/types';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface TransportPanelProps {
  transportStats: TransportStats | null;
  transportLoading: boolean;
  showTransportTable: boolean;
  /** Setter React complet : le panneau utilise la forme updater `v => !v`. */
  setShowTransportTable: React.Dispatch<React.SetStateAction<boolean>>;
  fetchTransportStats: () => void;
  btnGhostStyle: React.CSSProperties;
}

export function TransportPanel({ transportStats, transportLoading, showTransportTable, setShowTransportTable, fetchTransportStats, btnGhostStyle }: TransportPanelProps) {
      const green2 = '#22c55e';
      const green2Dim = 'rgba(34,197,94,0.10)';
      const green2Border = 'rgba(34,197,94,0.25)';
      const orange = '#f97316';
      const orangeDim = 'rgba(249,115,22,0.10)';
      const orangeBorder = 'rgba(249,115,22,0.25)';

      const pctTransport = transportStats
        ? Math.round(transportStats.panneaux.avec_transport / transportStats.panneaux.total * 100)
        : 0;
      const pctFlux = transportStats
        ? Math.round(transportStats.panneaux.avec_flux / transportStats.panneaux.total * 100)
        : 0;
      const badgeColor = (pct: number) =>
        pct >= 90 ? C.green : pct >= 70 ? C.warn : C.red;

      return (
        <div>
          {transportLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '40px 0', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>
              <Spinner size={18} /> Chargement des statistiques transport...
            </div>
          )}
          {!transportLoading && !transportStats && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
              Aucune donnée. <button onClick={fetchTransportStats} style={{ ...btnGhostStyle, display: 'inline-flex' }}>Charger</button>
            </div>
          )}
          {!transportLoading && transportStats && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>

              {/* Arrêts transport */}
              <div style={{ background: green2Dim, border: `0.5px solid ${green2Border}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: green2, letterSpacing: 1, marginBottom: 6 }}>
                    Arrêts de transport en commun
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                    <span style={{ color: C.textSec }}>Source: </span>GTFS consolidé France — transport.data.gouv.fr<br />
                    {Object.entries(transportStats.arrets.by_source).map(([src, nb]) => (
                      <span key={src}>
                        <span style={{ color: C.textSec }}>Dataset: </span>
                        <span style={{ color: C.text }}>{src}</span>
                        <span style={{ color: C.muted }}> — {nb.toLocaleString('fr-FR')} arrêts</span>
                        <br />
                      </span>
                    ))}
                  </div>
                  {pctTransport > 0 ? (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: badgeColor(pctTransport), background: `${badgeColor(pctTransport)}1a`, border: `0.5px solid ${badgeColor(pctTransport)}44`, padding: '2px 8px', borderRadius: 2 }}>
                        {pctTransport}% panneaux couverts
                      </span>
                      <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                        ({transportStats.panneaux.avec_transport.toLocaleString('fr-FR')} / {transportStats.panneaux.total.toLocaleString('fr-FR')})
                      </span>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.muted, border: `0.5px solid ${C.border}`, padding: '2px 8px', borderRadius: 2, display: 'inline-block' }}>
                      Scoring OOH non calculé
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: green2, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                    {transportStats.arrets.total.toLocaleString('fr-FR')}
                  </div>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                    arrêts physiques
                  </div>
                  <button
                    onClick={fetchTransportStats}
                    style={{ ...btnGhostStyle, marginTop: 10, fontSize: 9 }}
                  >
                    Actualiser
                  </button>
                </div>
              </div>

              {/* Flux routier */}
              <div style={{ background: orangeDim, border: `0.5px solid ${orangeBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: orange, letterSpacing: 1, marginBottom: 6 }}>
                    Flux routier (TMJA)
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                    {Object.entries(transportStats.flux.by_source).map(([src, nb]) => (
                      <span key={src}>
                        <span style={{ color: C.textSec }}>{src === 'tmja_rrn_national' ? 'CEREMA (réel): ' : 'OSM proxy: '}</span>
                        <span style={{ color: C.text }}>{nb.toLocaleString('fr-FR')} sections</span>
                        <br />
                      </span>
                    ))}
                  </div>
                  {pctFlux > 0 ? (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: badgeColor(pctFlux), background: `${badgeColor(pctFlux)}1a`, border: `0.5px solid ${badgeColor(pctFlux)}44`, padding: '2px 8px', borderRadius: 2 }}>
                        {pctFlux}% panneaux couverts
                      </span>
                      <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                        ({transportStats.panneaux.avec_flux.toLocaleString('fr-FR')} / {transportStats.panneaux.total.toLocaleString('fr-FR')})
                      </span>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.muted, border: `0.5px solid ${C.border}`, padding: '2px 8px', borderRadius: 2, display: 'inline-block' }}>
                      Scoring OOH non calculé
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: orange, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                    {transportStats.flux.total.toLocaleString('fr-FR')}
                  </div>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                    sections routières
                  </div>
                </div>
              </div>

              {/* Toggle tableau — masqué si scoring non calculé */}
              <div>
                {transportStats.panneaux.total > 0 && (pctTransport > 0 || pctFlux > 0) && (
                <button
                  onClick={() => setShowTransportTable((v) => !v)}
                  style={{ ...btnGhostStyle, marginBottom: showTransportTable ? 10 : 0 }}
                >
                  {showTransportTable ? '▲ Masquer' : '▼ Détails par ville (top 30)'}
                </button>
                )}
                {showTransportTable && (
                  <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: C.bgSurface }}>
                          {['Ville', 'Panneaux', 'Transport %', 'Moy. transport', 'Flux %', 'Moy. flux', 'Score total'].map((h) => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transportStats.villes.map((v, i) => {
                          const pT = Math.round(v.avec_transport / v.nb_panneaux * 100);
                          const pF = Math.round(v.avec_flux / v.nb_panneaux * 100);
                          return (
                            <tr
                              key={v.ville}
                              style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-level-2)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                            >
                              <td style={{ padding: '6px 12px', color: C.text, fontWeight: 600 }}>{v.ville}</td>
                              <td style={{ padding: '6px 12px', color: C.textDim }}>{v.nb_panneaux}</td>
                              <td style={{ padding: '6px 12px', color: badgeColor(pT) }}>{pT}%</td>
                              <td style={{ padding: '6px 12px', color: C.textDim }}>{v.transport_moyen}</td>
                              <td style={{ padding: '6px 12px', color: badgeColor(pF) }}>{pF}%</td>
                              <td style={{ padding: '6px 12px', color: C.textDim }}>{v.flux_moyen}</td>
                              <td style={{ padding: '6px 12px', color: C.accent, fontWeight: 700 }}>{v.score_moyen}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      );
}

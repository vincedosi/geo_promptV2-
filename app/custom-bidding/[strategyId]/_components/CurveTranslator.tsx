'use client';

/**
 * CurveTranslator — section dépliable sous le Hero qui traduit l'objectif
 * business en custom bidding technique, et affiche l'évolution jour-par-jour
 * de la courbe de pondération INSEE.
 *
 *   Objectif business  →  Variables techniques  →  Frise des ajustements
 *
 * Mini-courbes SVG natives (pas recharts pour 5 points).
 */
import { useEffect, useState } from 'react';
import { Languages, Sparkles } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Snapshot {
  id: string;
  applied_at: string;
  curve: Array<{ x: number; y: number }>;
  delta_pct: Record<string, number> | null;
  triggered_by: 'init' | 'drift_correction' | 'recommendation' | 'manual' | 'agent_auto';
  reason: string | null;
}

interface Props {
  strategyId: string;
  /** Objectif business (label_fr de bidding_objectives). */
  objectiveLabel: string;
  /** Variable INSEE pondérante (ex: "taux d'abstention"). */
  variableLabel: string | null;
  /** Algorithme. */
  algorithmCode: string;
  /** Préset initial. */
  initPresetCode: string | null;
  /** Vue active : 'simple' masque la frise jour-par-jour, garde l'essentiel narratif. */
  viewMode?: 'simple' | 'expert' | 'create';
}

const TRIGGER_META: Record<Snapshot['triggered_by'], { label: string; color: string; icon: string }> = {
  init:               { label: 'Initialisation', color: 'var(--text-tertiary)', icon: '●' },
  drift_correction:   { label: 'Correction drift', color: 'var(--warning)', icon: '⚠' },
  recommendation:     { label: 'Recommandation', color: 'var(--brand-teal)', icon: '✦' },
  manual:             { label: 'Action manuelle', color: 'var(--text-secondary)', icon: '✋' },
  agent_auto:         { label: 'Auto-pilot', color: 'var(--success)', icon: '🤖' },
};

export function CurveTranslator({
  strategyId, objectiveLabel, variableLabel, algorithmCode, initPresetCode,
  viewMode = 'simple',
}: Props) {
  const isExpert = viewMode === 'expert';
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/bidding/strategies/${strategyId}/curve-history`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSnapshots((data.snapshots ?? []) as Snapshot[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [strategyId]);

  const initial = snapshots?.[0]?.curve ?? [];
  const final = snapshots?.[snapshots.length - 1]?.curve ?? [];

  return (
    <div
      style={{
        margin: '12px',
        borderRadius: 10, overflow: 'hidden',
        border: '0.5px solid var(--brand-teal)',
        borderLeft: '3px solid var(--brand-teal)',
        background: 'var(--bg-level-1)',
        fontFamily: fInter, color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '0.5px solid var(--border-subtle)',
        }}
      >
        <Languages size={14} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 12, fontWeight: 500 }}>Traducteur — Objectif → Custom Bidding</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          {snapshots ? `${snapshots.length} ajustements` : 'chargement…'}
        </span>
      </div>

      <div style={{ padding: 14 }}>
          {error && (
            <div style={{ padding: '6px 10px', background: 'var(--bg-level-2)', border: '0.5px solid var(--danger)', borderRadius: 5, fontSize: 11, fontFamily: fMono, color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {/* Bloc 1 : Objectif business */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              📋 Objectif assigné à MAGELIAN
            </div>
            <div style={{
              padding: '10px 14px',
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 6,
              fontSize: 13, fontFamily: fInter,
              color: 'var(--text-primary)',
              fontStyle: 'italic',
            }}>
              «&nbsp;{objectiveLabel}&nbsp;»
            </div>
          </div>

          {/* Flèche traduction */}
          <div style={{ textAlign: 'center', fontSize: 16, color: 'var(--brand-teal)', marginBottom: 8 }}>▼ Traduction MAGELIAN ▼</div>

          {/* Bloc 2 : Variables techniques */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8,
            marginBottom: 14,
          }}>
            <Param label="Variable INSEE pondérante" value={variableLabel ?? 'aucune'} />
            <Param label="Algorithme" value={algorithmCode} mono />
            <Param label="Préset initial" value={initPresetCode ?? 'aucun'} mono highlight />
          </div>

          {/* Bloc 3 : Synthèse before/after */}
          {snapshots && snapshots.length > 1 && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center',
              marginBottom: 14,
              padding: '10px 14px',
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 6,
            }}>
              <div>
                <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                  Courbe initiale (J1)
                </div>
                <CurveSvg curve={initial} color="var(--text-tertiary)" width={170} height={60} />
              </div>
              <div style={{ fontSize: 18, color: 'var(--brand-teal)' }}>→</div>
              <div>
                <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                  Courbe finale (J{snapshots.length})
                </div>
                <CurveSvg curve={final} color="var(--brand-teal)" width={170} height={60} />
              </div>
            </div>
          )}

          {/* Bloc 4 : Frise des ajustements — vue expert uniquement.
              En simple, le résumé before/after (Bloc 3) + synthèse "En clair" (Bloc 5)
              suffisent à raconter l'histoire sans le détail jour-par-jour. */}
          {isExpert && snapshots && snapshots.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                📈 Évolution jour-par-jour
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {snapshots.map((s, idx) => {
                  const meta = TRIGGER_META[s.triggered_by];
                  const isSelected = selectedIdx === idx;
                  const date = new Date(s.applied_at);
                  const dayLabel = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
                  const previousCurve = idx > 0 ? snapshots[idx - 1].curve : null;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedIdx(isSelected ? null : idx)}
                      style={{
                        padding: '8px 10px',
                        background: isSelected ? 'var(--bg-level-2)' : 'transparent',
                        border: `0.5px solid ${isSelected ? meta.color : 'var(--border-subtle)'}`,
                        borderLeft: `2px solid ${meta.color}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                        transition: 'all 200ms',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, color: meta.color, width: 18, textAlign: 'center' }}>{meta.icon}</span>
                        <span style={{ fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)', minWidth: 60 }}>{dayLabel}</span>
                        <span style={{ fontSize: 10, fontFamily: fMono, color: meta.color, padding: '1px 6px', background: 'var(--bg-level-1)', border: `0.5px solid ${meta.color}`, borderRadius: 3 }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-primary)', flex: 1, fontWeight: isSelected ? 500 : 400 }}>
                          {s.reason?.slice(0, 90)}{s.reason && s.reason.length > 90 ? '…' : ''}
                        </span>
                      </div>
                      {isSelected && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                            {s.reason}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center' }}>
                            {previousCurve && (
                              <div>
                                <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', marginBottom: 3 }}>avant</div>
                                <CurveSvg curve={previousCurve} color="var(--text-tertiary)" width={140} height={50} />
                              </div>
                            )}
                            {previousCurve && <div style={{ fontSize: 14, color: meta.color }}>→</div>}
                            <div>
                              <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', marginBottom: 3 }}>après</div>
                              <CurveSvg curve={s.curve} color={meta.color} width={140} height={50} />
                            </div>
                          </div>
                          {s.delta_pct && (
                            <div style={{ marginTop: 6, fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                              {Object.entries(s.delta_pct).map(([k, v]) => (
                                <span key={k} style={{ marginRight: 10 }}>
                                  {k.replace('x_', 'x=')}% : <span style={{ color: v >= 0 ? 'var(--success)' : 'var(--danger)' }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bloc 5 : Synthèse en clair */}
          {snapshots && snapshots.length > 1 && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--brand-teal)',
              borderLeft: '2px solid var(--brand-teal)',
              borderRadius: 5,
              fontSize: 11, fontFamily: fInter, color: 'var(--text-primary)',
              lineHeight: 1.6,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <Sparkles size={12} strokeWidth={1.8} color="var(--brand-teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--brand-teal)', fontFamily: fMono, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>En clair</strong>
                Du préset <em>{initPresetCode ?? 'initial'}</em>, la courbe a été ajustée <strong>{snapshots.length - 1} fois</strong> par MAGELIAN.
                Elle est passée d&apos;une distribution <em>agressive sur le top quartile</em> à une distribution <em>agressive et précise sur le top, atténuée sur le bas</em>, sans toucher au budget total.
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

function Param({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--bg-level-2)',
      border: `0.5px solid ${highlight ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
      borderLeft: highlight ? '2px solid var(--brand-teal)' : '0.5px solid var(--border-subtle)',
      borderRadius: 5,
    }}>
      <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontFamily: mono ? fMono : fInter, color: highlight ? 'var(--brand-teal)' : 'var(--text-primary)', fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function CurveSvg({ curve, color, width, height }: { curve: Array<{ x: number; y: number }>; color: string; width: number; height: number }) {
  if (!curve || curve.length === 0) return null;
  const maxY = Math.max(...curve.map(p => p.y), 3.5);
  const padX = 6, padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xToPx = (x: number) => padX + (x / 100) * innerW;
  const yToPx = (y: number) => padY + innerH - (y / maxY) * innerH;
  const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.x).toFixed(1)} ${yToPx(p.y).toFixed(1)}`).join(' ');
  const areaPath = path + ` L ${xToPx(curve[curve.length - 1].x).toFixed(1)} ${(padY + innerH).toFixed(1)} L ${xToPx(curve[0].x).toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={areaPath} fill={color} fillOpacity={0.12} />
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" />
      {curve.map((p, i) => (
        <circle key={i} cx={xToPx(p.x)} cy={yToPx(p.y)} r={2} fill={color} />
      ))}
    </svg>
  );
}

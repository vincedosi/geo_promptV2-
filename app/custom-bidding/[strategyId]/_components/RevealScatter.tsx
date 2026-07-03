'use client';

/**
 * RevealScatter — graphique de la "révélation" : comment MAGELIAN aligne
 * la diffusion sur la cible.
 *
 * Axe X = valeur INSEE par zone (ex: taux d'abstention)
 * Axe Y = volume métrique servi par zone (impressions)
 * Toggle [Avant MAGELIAN ↔ Après MAGELIAN] avec transition animée
 * Trendline régression linéaire qui pivote
 * Big metric corrélation r=… avant / après — la preuve mathématique du pitch.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { ComparisonRow } from '@/lib/bidding-ml/comparison';
import { aggregateByZone } from '@/lib/bidding-ml/comparison';
import { metricFields, getMetricLabels, type PrimaryMetric } from '@/lib/bidding-ml/metric-labels';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";
// Couleur du nuage "avant" — neutre, lue par les charts SVG (pas une var CSS car
// recharts ne résout pas les var() dans certains props string).
const COLOR_BEFORE = '#a0a0a0';
const COLOR_AFTER = '#06d6a0';

interface Props {
  rows: ComparisonRow[];
  insseValues: Record<string, number> | null;
  metric: PrimaryMetric;
  variableLabel: string | null;
}

interface Point { x: number; y_real: number; y_sim: number; cp: string; }

export function RevealScatter({ rows, insseValues, metric, variableLabel }: Props) {
  const labels = getMetricLabels(metric);
  const fields = metricFields(metric);
  const [phase, setPhase] = useState<'before' | 'after'>('before');
  // Auto-cycle désactivé par défaut (UX cognitive load) — l'utilisateur déclenche.
  const [auto, setAuto] = useState(false);

  // Auto-cycle entre before / after toutes les 3.5s — pour pitch hands-free
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setPhase(p => (p === 'before' ? 'after' : 'before')), 3500);
    return () => clearInterval(id);
  }, [auto]);

  const points: Point[] = useMemo(() => {
    if (!insseValues || rows.length === 0) return [];
    const zones = aggregateByZone(rows);
    const out: Point[] = [];
    for (const z of zones) {
      const v = insseValues[z.postal_code];
      if (!Number.isFinite(v)) continue;
      const real = Number((z as unknown as Record<string, unknown>)[fields.real] as number);
      const sim = Number((z as unknown as Record<string, unknown>)[fields.sim] as number);
      out.push({ x: v, y_real: real, y_sim: sim, cp: z.postal_code });
    }
    return out;
  }, [rows, insseValues, fields.real, fields.sim]);

  const { rBefore, rAfter, regBefore, regAfter, xMin, xMax, yMax } = useMemo(() => {
    const rBefore = pearson(points.map(p => p.x), points.map(p => p.y_real));
    const rAfter = pearson(points.map(p => p.x), points.map(p => p.y_sim));
    const regBefore = linreg(points.map(p => p.x), points.map(p => p.y_real));
    const regAfter = linreg(points.map(p => p.x), points.map(p => p.y_sim));
    let xMin = Infinity, xMax = -Infinity, yMax = 0;
    for (const p of points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y_real > yMax) yMax = p.y_real;
      if (p.y_sim > yMax) yMax = p.y_sim;
    }
    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 60; }
    return { rBefore, rAfter, regBefore, regAfter, xMin, xMax, yMax };
  }, [points]);

  const isAfter = phase === 'after';
  const yKey: 'y_real' | 'y_sim' = isAfter ? 'y_sim' : 'y_real';
  const color = isAfter ? COLOR_AFTER : COLOR_BEFORE;
  const reg = isAfter ? regAfter : regBefore;
  const r = isAfter ? rAfter : rBefore;

  const trendY1 = reg.a * xMin + reg.b;
  const trendY2 = reg.a * xMax + reg.b;

  if (points.length === 0) return null;

  return (
    <div style={{ margin: '12px', padding: '14px 16px', background: 'var(--bg-level-1)', border: '0.5px solid var(--border-subtle)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
            La preuve mathématique : alignement {labels.name.toLowerCase()} × {variableLabel ?? 'cible'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', padding: 2, gap: 2, background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6 }}>
          <PhaseBtn active={!isAfter} onClick={() => { setAuto(false); setPhase('before'); }}>
            Avant MAGELIAN
          </PhaseBtn>
          <PhaseBtn active={isAfter} onClick={() => { setAuto(false); setPhase('after'); }}>
            Après MAGELIAN
          </PhaseBtn>
        </div>
        <button
          type="button"
          onClick={() => setAuto(a => !a)}
          style={{
            padding: '5px 9px', fontSize: 10, fontFamily: fMono,
            background: auto ? 'var(--brand-teal)' : 'transparent',
            color: auto ? 'var(--bg-level-0)' : 'var(--text-secondary)',
            border: `0.5px solid ${auto ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          {auto ? '⏸ pause' : '▶ auto'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px', gap: 16, alignItems: 'center' }}>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 32, left: 12 }}>
              <CartesianGrid stroke="var(--border-subtle)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[Math.floor(xMin), Math.ceil(xMax)]}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fMono }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-default)' }}
                label={{ value: `${variableLabel ?? 'variable'} (%)`, position: 'bottom', fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fInter, offset: 16 }}
              />
              <YAxis
                type="number"
                dataKey={yKey}
                domain={[0, Math.ceil(yMax * 1.05)]}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fMono }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-default)' }}
                width={70}
                tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)}
                label={{ value: labels.name, angle: -90, position: 'left', fill: 'var(--text-secondary)', fontSize: 11, fontFamily: fInter, offset: -2 }}
              />
              <Tooltip
                cursor={{ stroke: 'var(--border-default)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Point;
                  return (
                    <div style={{ background: 'var(--bg-level-1)', border: `0.5px solid ${color}`, borderRadius: 6, padding: '6px 10px', fontFamily: fMono, fontSize: 11 }}>
                      <div style={{ color: 'var(--text-primary)', marginBottom: 2 }}>CP {d.cp}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{variableLabel ?? 'x'} : {d.x.toFixed(1)}%</div>
                      <div style={{ color }}>{labels.name} {isAfter ? 'sim.' : 'réel'} : {Math.round(d[yKey]).toLocaleString('fr-FR')}</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={points}
                fill={color}
                fillOpacity={0.55}
                shape="circle"
                isAnimationActive={true}
                animationDuration={800}
              />
              <ReferenceLine
                segment={[
                  { x: xMin, y: Math.max(0, trendY1) },
                  { x: xMax, y: Math.max(0, trendY2) },
                ]}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="6 3"
                ifOverflow="extendDomain"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Big metric corrélation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            padding: '14px 14px',
            background: isAfter ? 'rgba(6,214,160,0.08)' : 'rgba(160,160,160,0.05)',
            border: `1px solid ${isAfter ? 'rgba(6,214,160,0.4)' : 'rgba(160,160,160,0.2)'}`,
            borderRadius: 8,
            transition: 'all 400ms',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: fInter, marginBottom: 4, textTransform: 'lowercase' }}>
              corrélation Pearson
            </div>
            <div style={{ fontSize: 36, fontFamily: fMono, fontWeight: 500, color: isAfter ? COLOR_AFTER : 'var(--text-primary)', lineHeight: 1, transition: 'color 400ms' }}>
              {r.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fInter, marginTop: 4 }}>
              {isAfter ? 'diffusion alignée sur la cible' : 'diffusion non corrélée'}
            </div>
          </div>
          <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span><span style={{ color: COLOR_BEFORE }}>r avant</span> : {rBefore.toFixed(2)}</span>
            <span><span style={{ color: COLOR_AFTER }}>r après</span> : {rAfter.toFixed(2)}</span>
            <span style={{ color: '#06d6a0', marginTop: 4 }}>
              gain : +{(rAfter - rBefore).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: fInter, marginTop: 6, lineHeight: 1.5 }}>
        Chaque point = un code postal. <strong style={{ color: 'var(--text-primary)' }}>Avant MAGELIAN</strong>, la diffusion est aléatoire par rapport à la cible.
        <strong style={{ color: COLOR_AFTER }}> Après MAGELIAN</strong>, la pente positive de la trendline montre que les zones à fort {variableLabel ?? 'taux'} reçoivent plus d&apos;{labels.name.toLowerCase()}.
      </div>
    </div>
  );
}

function PhaseBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
        background: active ? 'var(--text-primary)' : 'transparent',
        color: active ? 'var(--bg-level-0)' : 'var(--text-secondary)',
        border: 'none', borderRadius: 4, cursor: 'pointer',
        transition: 'all 200ms',
      }}
    >
      {children}
    </button>
  );
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx, ay = ys[i] - my;
    num += ax * ay; dx2 += ax * ax; dy2 += ay * ay;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

function linreg(xs: number[], ys: number[]): { a: number; b: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { a: 0, b: 0 };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx, ay = ys[i] - my;
    num += ax * ay; den += ax * ax;
  }
  const a = den > 0 ? num / den : 0;
  const b = my - a * mx;
  return { a, b };
}

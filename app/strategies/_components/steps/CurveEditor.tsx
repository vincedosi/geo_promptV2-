'use client';

/**
 * CurveEditor — éditeur graphique de courbe X→Y avec poignées draggables.
 *
 * X = valeur d'une variable INSEE (ex: taux d'abstention 0-100%)
 * Y = multiplier (0 à 5)
 *
 * Composant entièrement contrôlé via `value` / `onChange`. Anime les
 * transitions, affiche les ticks min/median/max de la variable, et fournit
 * 3 presets narratifs civiques.
 *
 * Performance : SVG natif, pointer events drag, debounce optionnel via parent.
 */
import { useCallback, useMemo, useState } from 'react';
import { colorForMultiplier } from '@/lib/strategy-wizard/multiplier';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface CurvePoint { x: number; y: number }

export interface CurveEditorProps {
  /** Points de la courbe (≥ 2, triés par x croissant). */
  value: CurvePoint[];
  onChange: (next: CurvePoint[]) => void;
  /** Bornes de l'axe X (typiquement min/max de la variable INSEE). */
  xMin: number;
  xMax: number;
  /** Unité affichée sur l'axe X (ex: "%"). */
  xUnit?: string;
  /** Médiane de la variable — affichée comme tick de référence. */
  xMedian?: number;
  /** Hauteur du SVG (default 180). */
  height?: number;
}

const Y_MIN = 0;
const Y_MAX = 5;
const PADDING = { top: 12, right: 12, bottom: 32, left: 36 };

export function CurveEditor({
  value, onChange, xMin, xMax, xUnit = '', xMedian, height = 180,
}: CurveEditorProps) {
  const [width, setWidth] = useState(360);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Resize observer pour s'adapter à la largeur du parent
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const obs = new ResizeObserver(entries => {
        for (const e of entries) setWidth(Math.max(200, e.contentRect.width));
      });
      obs.observe(el);
    }
  }, []);

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const xToPx = useCallback((x: number) => PADDING.left + ((x - xMin) / (xMax - xMin)) * innerW, [xMin, xMax, innerW]);
  const yToPx = useCallback((y: number) => PADDING.top + (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * innerH, [innerH]);
  const pxToX = useCallback((px: number) => xMin + ((px - PADDING.left) / innerW) * (xMax - xMin), [xMin, xMax, innerW]);
  const pxToY = useCallback((py: number) => Y_MIN + (1 - (py - PADDING.top) / innerH) * (Y_MAX - Y_MIN), [innerH]);

  // Path SVG de la courbe (ligne brisée entre points)
  const pathD = useMemo(() => {
    if (value.length === 0) return '';
    return value.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.x).toFixed(1)} ${yToPx(p.y).toFixed(1)}`).join(' ');
  }, [value, xToPx, yToPx]);

  // Aire sous la courbe colorée par multiplier (pour rendu visuel "richesse")
  const fillSegments = useMemo(() => {
    // 30 segments verticaux échantillonnés, colorés par y interpolé
    const segs: Array<{ x: number; w: number; color: string }> = [];
    const N = 30;
    for (let i = 0; i < N; i++) {
      const x = xMin + ((i + 0.5) / N) * (xMax - xMin);
      // Interpole y sur la courbe à ce x
      let y = 1.0;
      for (let j = 0; j < value.length - 1; j++) {
        const a = value[j], b = value[j + 1];
        if (x >= a.x && x <= b.x) {
          const t = (x - a.x) / (b.x - a.x);
          y = a.y + t * (b.y - a.y);
          break;
        }
      }
      if (x < value[0]?.x) y = value[0]?.y ?? 1;
      if (x > value[value.length - 1]?.x) y = value[value.length - 1]?.y ?? 1;
      segs.push({
        x: PADDING.left + (i / N) * innerW,
        w: innerW / N,
        color: colorForMultiplier(y),
      });
    }
    return segs;
  }, [value, xMin, xMax, innerW]);

  const onPointerDown = (idx: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
    setDragIdx(idx);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIdx === null) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());

    let newX = pxToX(local.x);
    let newY = pxToY(local.y);
    newY = Math.max(Y_MIN, Math.min(Y_MAX, newY));

    // Contraintes : on ne peut pas dépasser les voisins en X
    // (sauf premier et dernier point qui sont fixes en X aux bornes)
    const isFirst = dragIdx === 0;
    const isLast = dragIdx === value.length - 1;
    if (isFirst) newX = xMin;
    else if (isLast) newX = xMax;
    else {
      const prev = value[dragIdx - 1].x + 0.5;
      const next = value[dragIdx + 1].x - 0.5;
      newX = Math.max(prev, Math.min(next, newX));
    }

    const newCurve = value.map((p, i) =>
      i === dragIdx ? { x: newX, y: Math.round(newY * 10) / 10 } : p,
    );
    onChange(newCurve);
  };
  const onPointerUp = () => setDragIdx(null);

  // Ticks Y (multiplier)
  const yTicks = [0, 1, 2, 3, 5];
  // Ticks X (variable)
  const xTicks = [xMin, xMin + (xMax - xMin) * 0.25, xMin + (xMax - xMin) * 0.5, xMin + (xMax - xMin) * 0.75, xMax];

  return (
    <div ref={setRef} style={{ width: '100%', userSelect: 'none' }}>
      <svg
        width={width}
        height={height}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ display: 'block', cursor: dragIdx !== null ? 'grabbing' : 'default' }}
      >
        {/* Aire sous la courbe — gradient coloré par multiplier */}
        {fillSegments.map((s, i) => {
          // Hauteur du segment = position y du point interpolé à mi-segment
          const xMid = pxToX(s.x + s.w / 2);
          let yMid = 1.0;
          for (let j = 0; j < value.length - 1; j++) {
            const a = value[j], b = value[j + 1];
            if (xMid >= a.x && xMid <= b.x) {
              const t = (xMid - a.x) / (b.x - a.x);
              yMid = a.y + t * (b.y - a.y);
              break;
            }
          }
          if (xMid < value[0]?.x) yMid = value[0]?.y ?? 1;
          if (xMid > value[value.length - 1]?.x) yMid = value[value.length - 1]?.y ?? 1;
          const yPx = yToPx(yMid);
          const baseY = PADDING.top + innerH;
          return (
            <rect
              key={i}
              x={s.x}
              y={Math.min(yPx, baseY)}
              width={s.w + 0.5}
              height={Math.abs(baseY - yPx)}
              fill={s.color}
              opacity={0.18}
            />
          );
        })}

        {/* Grille horizontale (Y ticks) */}
        {yTicks.map(y => (
          <g key={`yg-${y}`}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + innerW}
              y1={yToPx(y)}
              y2={yToPx(y)}
              stroke="var(--border-subtle)"
              strokeWidth={y === 1 ? 1 : 0.5}
              strokeDasharray={y === 1 ? '0' : '2 2'}
              opacity={y === 1 ? 0.6 : 0.3}
            />
            <text
              x={PADDING.left - 6}
              y={yToPx(y) + 3}
              textAnchor="end"
              fontSize={9}
              fontFamily={fMono}
              fill="var(--text-tertiary)"
            >
              ×{y}
            </text>
          </g>
        ))}

        {/* Tick spécial médiane */}
        {xMedian !== undefined && xMedian >= xMin && xMedian <= xMax && (
          <g>
            <line
              x1={xToPx(xMedian)}
              x2={xToPx(xMedian)}
              y1={PADDING.top}
              y2={PADDING.top + innerH}
              stroke="var(--brand-teal)"
              strokeWidth={0.5}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <text
              x={xToPx(xMedian)}
              y={PADDING.top - 2}
              textAnchor="middle"
              fontSize={8}
              fontFamily={fMono}
              fill="var(--brand-teal)"
              opacity={0.7}
            >
              médiane
            </text>
          </g>
        )}

        {/* Ticks X */}
        {xTicks.map((x, i) => (
          <text
            key={`xt-${i}`}
            x={xToPx(x)}
            y={PADDING.top + innerH + 14}
            textAnchor="middle"
            fontSize={9}
            fontFamily={fMono}
            fill="var(--text-tertiary)"
          >
            {x.toFixed(0)}{xUnit}
          </text>
        ))}

        {/* Courbe (ligne) */}
        <path d={pathD} fill="none" stroke="var(--brand-teal)" strokeWidth={2} />

        {/* Poignées */}
        {value.map((p, i) => {
          const isHover = hoverIdx === i || dragIdx === i;
          return (
            <g key={`pt-${i}`}>
              {isHover && (
                <g>
                  <rect
                    x={xToPx(p.x) + 8}
                    y={yToPx(p.y) - 22}
                    width={68}
                    height={18}
                    rx={3}
                    fill="var(--bg-level-2)"
                    stroke="var(--border-default)"
                    strokeWidth={0.5}
                  />
                  <text
                    x={xToPx(p.x) + 12}
                    y={yToPx(p.y) - 9}
                    fontSize={10}
                    fontFamily={fMono}
                    fill="var(--text-primary)"
                  >
                    {p.x.toFixed(0)}{xUnit} → ×{p.y.toFixed(1)}
                  </text>
                </g>
              )}
              <circle
                cx={xToPx(p.x)}
                cy={yToPx(p.y)}
                r={isHover ? 7 : 5}
                fill={colorForMultiplier(p.y)}
                stroke="var(--bg-level-0)"
                strokeWidth={2}
                onPointerDown={onPointerDown(i)}
                onPointerEnter={() => setHoverIdx(i)}
                onPointerLeave={() => setHoverIdx(null)}
                style={{ cursor: 'grab', touchAction: 'none' }}
              />
            </g>
          );
        })}

        {/* Label axe X */}
        <text
          x={PADDING.left + innerW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={9}
          fontFamily={fInter}
          fill="var(--text-tertiary)"
        >
          Valeur de la variable ({xUnit || 'unité'})
        </text>
      </svg>
    </div>
  );
}

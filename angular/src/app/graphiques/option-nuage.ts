import type { EChartsCoreOption } from 'echarts/core';
import { echapperHtml, graduationsRecharts } from './option-courbe';

/** Un point du nuage : abscisse, ordonnée, et l'identifiant qu'affiche l'infobulle. */
export interface PointNuage {
  code: string;
  x: number;
  y: number;
}

/** Les couleurs CALCULÉES des jetons (`CouleursService`) : ECharts ne lit pas `var()`. */
export interface CouleursNuage {
  /** Les points (`--brand-teal`). */
  point: string;
  /** Graduations et nom d'axe (`--text-tertiary`). */
  texte: string;
  /** Lignes d'axe et bord de l'infobulle (`--border-subtle`). */
  axe: string;
  /** Fond de l'infobulle (`--surface`). */
  fondInfobulle: string;
  /** Première ligne de l'infobulle (`--text-primary`). */
  textePrincipal: string;
  /** Lignes suivantes (`--text-secondary`). */
  texteSecondaire: string;
}

export interface ParametresNuage {
  points: readonly PointNuage[];
  libelleX: string;
  formaterX: (v: number) => string;
  /** Les lignes de l'infobulle d'un point — du texte, échappé ici. */
  infobulle: (p: PointNuage) => readonly string[];
  couleurs: CouleursNuage;
}

/**
 * Diamètre d'un point, MESURÉ sur le nuage React (`ZAxis range={[16, 16]}`, symbole de 9 × 9 px au navigateur, T18) —
 * la lecture « aire de 16 px² » de la prop donnerait 4,5 px, deux fois trop petit.
 */
const DIAMETRE_POINT = 9;

/**
 * La zone de tracé de Recharts : `margin` (8 / 12 / 24 / 4) PLUS la place de ses axes — XAxis haut de 30 px par défaut,
 * YAxis large de 38 (`width={38}`). Mesuré au navigateur : tracé de 152 à 380 px en x, de 8 à 166 px en y.
 */
const GRILLE = { top: 8, right: 12, bottom: 24 + 30, left: 4 + 38, containLabel: false };

const POLICE_MONO = "'JetBrains Mono', monospace";
const POLICE_INTER = "'Inter', system-ui, sans-serif";

/**
 * L'option ECharts d'un nuage de points — le `ScatterChart` de `CorrelationTool.tsx:262-296` : un point par entrée,
 * teal à 55 %, abscisse nommée en bas, graduations en mono 9 px, sans traits de graduation, marges de Recharts.
 * L'infobulle est du HTML : chaque ligne est ÉCHAPPÉE (un libellé vient de la base).
 */
export function optionNuage(p: ParametresNuage): EChartsCoreOption {
  const c = p.couleurs;
  // Les graduations « rondes » de Recharts sur [0, max] (5 graduations) : sans elles, ECharts choisit les siennes.
  const domaine = (max: number) => {
    const g = graduationsRecharts(max);
    return g ? { min: g.min, max: g.max, interval: g.pas } : {};
  };
  const graduations = { color: c.texte, fontSize: 9, fontFamily: POLICE_MONO };
  return {
    animation: false,
    grid: GRILLE,
    xAxis: {
      type: 'value', ...domaine(Math.max(0, ...p.points.map((pt) => pt.x))), name: p.libelleX, nameLocation: 'middle', nameGap: 34,
      nameTextStyle: { color: c.texte, fontSize: 9, fontFamily: POLICE_INTER },
      axisLabel: { ...graduations, formatter: p.formaterX },
      axisLine: { show: true, lineStyle: { color: c.axe } }, axisTick: { show: false }, splitLine: { show: false },
    },
    yAxis: {
      // Pas de `scale` : l'axe part de 0, comme le domaine `[0, 'auto']` de Recharts.
      type: 'value', ...domaine(Math.max(0, ...p.points.map((pt) => pt.y))),
      // Nombres bruts, comme les graduations Y de Recharts (« 60000 », jamais « 60,000 »).
      axisLabel: { ...graduations, formatter: (v: number) => String(v) },
      axisLine: { show: true, lineStyle: { color: c.axe } }, axisTick: { show: false }, splitLine: { show: false },
    },
    tooltip: {
      // Plate (« flat total ») : ECharts pose par défaut une ombre et un bord de 1 px — comme `option-courbe.ts`.
      trigger: 'item', backgroundColor: c.fondInfobulle, borderColor: c.axe, borderWidth: 0.5, borderRadius: 4, padding: [6, 10],
      shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, extraCssText: 'box-shadow:none;',
      textStyle: { fontFamily: POLICE_MONO, fontSize: 10, color: c.texteSecondaire },
      formatter: (e: { data: [number, number, string] }) => {
        const [x, y, code] = e.data;
        const [premiere, ...suite] = p.infobulle({ code, x, y });
        return [`<div style="color:${c.textePrincipal}">${echapperHtml(premiere ?? '')}</div>`, ...suite.map((l) => `<div>${echapperHtml(l)}</div>`)].join('');
      },
    },
    series: [{
      type: 'scatter',
      data: p.points.map((pt) => [pt.x, pt.y, pt.code]),
      symbolSize: DIAMETRE_POINT,
      itemStyle: { color: c.point, opacity: 0.55 },
    }],
  };
}

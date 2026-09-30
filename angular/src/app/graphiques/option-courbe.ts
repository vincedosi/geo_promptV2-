import type { EChartsCoreOption } from 'echarts/core';

export interface SerieCourbe {
  cle: string;
  libelle: string;
  /** Nom de jeton sans `--` (ex. `brand-teal`, `nature-1`). */
  jeton: string;
  points: ReadonlyArray<readonly [number, number]>;
  epaisseur?: number;
}

export interface RepereCourbe {
  x: number;
  libelle: string;
}

export interface CouleursCourbe {
  /** Couleur de chaque série, par `cle`. */
  series: Record<string, string>;
  texte: string;
  grille: string;
  fondInfobulle: string;
  bordInfobulle: string;
  repere: string;
}

/** Construit l'option ECharts d'une courbe. PURE : testée sans ECharts ni DOM. */
export function optionCourbe(e: {
  series: SerieCourbe[];
  masquees: ReadonlySet<string>;
  couleurs: CouleursCourbe;
  formaterX: (x: number) => string;
  formaterY: (y: number) => string;
  repere?: RepereCourbe;
  domaineX?: readonly [number, number];
}): EChartsCoreOption {
  const c = e.couleurs;
  const visibles = e.series.filter((s) => !e.masquees.has(s.cle));
  const police = { color: c.texte, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10 };
  return {
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: 'value',
      min: e.domaineX?.[0],
      max: e.domaineX?.[1],
      axisLabel: { ...police, formatter: e.formaterX },
      axisLine: { lineStyle: { color: c.grille } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { ...police, formatter: e.formaterY },
      splitLine: { lineStyle: { color: c.grille } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.fondInfobulle,
      borderColor: c.bordInfobulle,
      textStyle: { ...police, fontSize: 11 },
      valueFormatter: (v: unknown) => e.formaterY(Number(v)),
    },
    series: visibles.map((s, i) => ({
      type: 'line',
      name: s.libelle,
      data: s.points.map((p) => [p[0], p[1]]),
      showSymbol: false,
      lineStyle: { color: c.series[s.cle], width: s.epaisseur ?? 1.5 },
      itemStyle: { color: c.series[s.cle] },
      ...(i === 0 && e.repere
        ? {
            markLine: {
              symbol: 'none',
              silent: true,
              lineStyle: { color: c.repere, type: 'dashed', width: 1 },
              label: { ...police, position: 'insideEndTop' },
              data: [{ xAxis: e.repere.x, label: { formatter: e.repere.libelle } }],
            },
          }
        : {}),
    })),
  };
}

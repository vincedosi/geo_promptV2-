import { graduationsRecharts, optionCourbe, positionInfobulle, type SerieCourbe } from './option-courbe';

const COULEURS = {
  series: { total: '#4ecdc4', a: '#e07a3f' },
  texte: '#8a8a8a', textePrincipal: '#f0f0f0', grille: '#1a1a1a', axe: '#262626',
  fondInfobulle: 'rgba(10,10,10,0.92)', bordInfobulle: '#262626', repere: '#4ecdc4', halo: '#0a0a0a', pointActif: '#ffffff',
};
const SERIES: SerieCourbe[] = [
  { cle: 'total', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 10], [200, 30]], epaisseur: 2 },
  { cle: 'a', libelle: 'Nature A', jeton: 'nature-1', points: [[100, 4], [200, 9]] },
];
const base = { series: SERIES, masquees: new Set<string>(), couleurs: COULEURS, formaterX: (x: number) => `${x / 1000} km`, formaterY: (y: number) => String(y) };

describe('optionCourbe', () => {
  it('une série par courbe, dans sa couleur, avec ses points', () => {
    const o = optionCourbe(base) as { series: { name: string; data: unknown; lineStyle: { color: string; width: number } }[] };
    expect(o.series.map((s) => s.name)).toEqual(['Toutes natures', 'Nature A']);
    expect(o.series[0].lineStyle.color).toBe('#4ecdc4');
    expect(o.series[0].lineStyle.width).toBe(2);
    expect(o.series[1].lineStyle.width).toBe(1.3);
    expect(o.series[1].data).toEqual([[100, 4], [200, 9]]);
  });

  it('une série masquée disparaît', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['a']) }) as { series: { name: string }[] };
    expect(o.series.map((s) => s.name)).toEqual(['Toutes natures']);
  });

  it('le repère est un trait vertical teal tireté 3 3, sans libellé, porté par la première série visible', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['total']), repere: { x: 5000 } }) as {
      series: { markLine?: { data: { xAxis: number }[]; label: { show: boolean }; lineStyle: { color: string; type: number[]; width: number } } }[];
    };
    const m = o.series[0].markLine!;
    expect(m.data[0].xAxis).toBe(5000);
    expect(m.label.show).toBe(false);
    expect(m.lineStyle).toEqual({ color: COULEURS.repere, type: [3, 3], width: 1 });
  });

  it('un repère nommé garde son libellé', () => {
    const o = optionCourbe({ ...base, repere: { x: 5000, libelle: 'Rayon 5 km' } }) as {
      series: { markLine?: { label: { formatter: string } } }[];
    };
    expect(o.series[0].markLine!.label.formatter).toBe('Rayon 5 km');
  });

  it('les courbes sont lissées sans dépasser leurs points (monotone de Recharts)', () => {
    const o = optionCourbe(base) as { series: { smooth: boolean; smoothMonotone: string }[] };
    for (const s of o.series) {
      expect(s.smooth).toBe(true);
      expect(s.smoothMonotone).toBe('x');
    }
  });

  it('grille horizontale seule, pointillée 2 4, en --border-subtle ; deux axes tracés en --border-default', () => {
    const o = optionCourbe(base) as {
      xAxis: { splitLine: { show: boolean }; axisLine: { show: boolean; lineStyle: { color: string } }; axisLabel: { fontFamily: string } };
      yAxis: { splitLine: { show: boolean; lineStyle: { color: string; type: number[] } }; axisLine: { show: boolean; lineStyle: { color: string } }; axisLabel: { fontFamily: string } };
    };
    expect(o.xAxis.splitLine.show).toBe(false);
    expect(o.yAxis.splitLine.show).toBe(true);
    expect(o.yAxis.splitLine.lineStyle).toMatchObject({ color: COULEURS.grille, type: [2, 4] });
    for (const a of [o.xAxis, o.yAxis]) {
      expect(a.axisLine).toMatchObject({ show: true, lineStyle: { color: COULEURS.axe } });
      expect(a.axisLabel.fontFamily).toContain('JetBrains Mono');
    }
  });

  it('graduations X imposées : étiquettes ET traits aux seules valeurs données', () => {
    const o = optionCourbe({ ...base, graduationsX: [1000, 2000] }) as {
      xAxis: { axisLabel: { customValues: number[] }; axisTick: { customValues: number[] } };
    };
    expect(o.xAxis.axisLabel.customValues).toEqual([1000, 2000]);
    expect(o.xAxis.axisTick.customValues).toEqual([1000, 2000]);
  });

  it('infobulle plate (V7) : bord de 0,5 px, rayon 6, aucune ombre, fond --card-overlay', () => {
    const o = optionCourbe(base) as { tooltip: Record<string, unknown> };
    expect(o.tooltip).toMatchObject({
      backgroundColor: COULEURS.fondInfobulle, borderColor: COULEURS.bordInfobulle,
      borderWidth: 0.5, borderRadius: 6, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    });
    expect(o.tooltip['extraCssText']).toContain('box-shadow:none');
  });

  it('infobulle : titre « à moins de X km », une ligne « nom : valeur » à la couleur du trait, texte échappé', () => {
    const o = optionCourbe({
      ...base, formaterTitre: (x) => `à moins de ${x / 1000} km`, formaterValeur: (y) => `${y} hab.`,
    }) as { tooltip: { formatter: (p: unknown) => string } };
    const html = o.tooltip.formatter([
      { seriesName: 'Toutes natures', value: [5000, 12], color: '#4ecdc4' },
      { seriesName: '<b>x</b>', value: [5000, 3], color: '#e07a3f' },
    ]);
    expect(html).toContain('à moins de 5 km');
    expect(html).toContain('color:#4ecdc4">Toutes natures : 12 hab.');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; : 3 hab.');
    expect(html).not.toContain('<b>');
  });

  it('point actif au survol comme Recharts : disque plein de 8 px à la couleur du trait, bord de 2 px', () => {
    const o = optionCourbe(base) as {
      series: { symbol: string; symbolSize: number; showSymbol: boolean; itemStyle: { color: string; borderWidth: number; borderColor: string } }[];
    };
    for (const [i, s] of o.series.entries()) {
      expect(s).toMatchObject({ symbol: 'circle', symbolSize: 8, showSymbol: false });
      expect(s.itemStyle.borderWidth).toBe(2);
      expect(s.itemStyle.borderColor).toBe(COULEURS.pointActif);
      expect(s.itemStyle.color).toBe(Object.values(COULEURS.series)[i]);
    }
  });

  it('étiquettes au kilomètre : série invisible à part, la vraie courbe garde son point de survol', () => {
    const series = SERIES.map((s) => (s.cle === 'total' ? { ...s, etiquetee: true } : s));
    const sans = optionCourbe({ ...base, series }) as { grid: { top: number }; series: unknown[] };
    expect(sans.series.length).toBe(2);
    expect(sans.grid.top).toBe(4);
    const avec = optionCourbe({ ...base, series, etiquettes: true, formaterY: (y) => `<${y}>` }) as {
      grid: { top: number };
      series: { id?: string; silent?: boolean; symbolSize: number; showSymbol: boolean; tooltip?: { show: boolean }; data: unknown; lineStyle: { width: number }; label?: { formatter: (p: unknown) => string; textBorderColor: string } }[];
    };
    expect(avec.grid.top).toBe(20);
    expect(avec.series.length).toBe(3);
    expect(avec.series[0]).toMatchObject({ symbolSize: 8, showSymbol: false });
    expect(avec.series[0].label).toBeUndefined();
    const l = avec.series[2];
    expect(l).toMatchObject({ id: 'etiquettes:total', silent: true, symbolSize: 0, showSymbol: true, tooltip: { show: false } });
    expect(l.lineStyle.width).toBe(0);
    expect(l.data).toEqual(avec.series[0].data);
    expect(l.label!.textBorderColor).toBe(COULEURS.halo);
    expect(l.label!.formatter({ value: [2000, 30] })).toBe('<30>');
    expect(l.label!.formatter({ value: [2100, 31] })).toBe('');
  });

  it("infobulle triée comme Recharts : par CLÉ de série, unité de code par unité de code (`*` d'abord, « GPL » avant « Gaz »)", () => {
    const series: SerieCourbe[] = [
      { cle: 'Gaz', libelle: 'Gaz', jeton: 'nature-1', points: [[100, 1]] },
      { cle: '*', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 9]] },
      { cle: 'GPL', libelle: 'GPL', jeton: 'nature-2', points: [[100, 2]] },
      { cle: 'Agro', libelle: 'Agro', jeton: 'nature-3', points: [[100, 3]] },
    ];
    const o = optionCourbe({ ...base, series }) as { tooltip: { formatter: (p: unknown) => string } };
    const html = o.tooltip.formatter(series.map((s, i) => ({ seriesIndex: i, seriesName: s.libelle, value: [100, 1], color: '#000' })));
    expect([...html.matchAll(/">([^:<]+) :/g)].map((m) => m[1])).toEqual(['Toutes natures', 'Agro', 'GPL', 'Gaz']);
  });

  it('infobulle triée avec une série MASQUÉE : les indices ECharts portent sur les séries VISIBLES', () => {
    const series: SerieCourbe[] = [
      { cle: 'Gaz', libelle: 'Gaz', jeton: 'nature-1', points: [[100, 1]] },
      { cle: '*', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 9]] },
      { cle: 'GPL', libelle: 'GPL', jeton: 'nature-2', points: [[100, 2]] },
      { cle: 'Agro', libelle: 'Agro', jeton: 'nature-3', points: [[100, 3]] },
    ];
    const o = optionCourbe({ ...base, series, masquees: new Set(['*']) }) as { tooltip: { formatter: (p: unknown) => string } };
    // ECharts numérote les séries de l'option : Gaz 0, GPL 1, Agro 2 (« Toutes natures » n'y est pas).
    const visibles = series.filter((s) => s.cle !== '*');
    const html = o.tooltip.formatter(visibles.map((s, i) => ({ seriesIndex: i, seriesName: s.libelle, value: [100, 1], color: '#000' })));
    expect([...html.matchAll(/">([^:<]+) :/g)].map((m) => m[1])).toEqual(['Agro', 'GPL', 'Gaz']);
  });

  it('graduations Y de Recharts (5 graduations rondes) : 0-60 M par 15 M pour la courbe réelle de l’étape ② (max 42 409 940)', () => {
    expect(graduationsRecharts(42409940)).toEqual({ min: 0, max: 60000000, pas: 15000000 });
    // Mesuré dans Recharts (React, « Toutes natures » masquée) : 0, 8, 16, 24, 32 M.
    expect(graduationsRecharts(30731688)).toEqual({ min: 0, max: 32000000, pas: 8000000 });
    expect(graduationsRecharts(0)).toBeNull();
    const o = optionCourbe({ ...base, series: [{ cle: '*', libelle: 'T', jeton: 'brand-teal', points: [[100, 42409940]] }] }) as {
      yAxis: { min: number; max: number; interval: number };
    };
    expect([o.yAxis.min, o.yAxis.max, o.yAxis.interval]).toEqual([0, 60000000, 15000000]);
  });

  it("la série d'étiquettes n'apparaît jamais dans l'infobulle partagée", () => {
    const o = optionCourbe(base) as { tooltip: { formatter: (p: unknown) => string } };
    const html = o.tooltip.formatter([
      { seriesId: 'serie0', seriesName: 'Toutes natures', value: [5000, 12], color: '#4ecdc4' },
      { seriesId: 'etiquettes:total', seriesName: 'Toutes natures', value: [5000, 12], color: '#000000' },
    ]);
    expect(html.match(/<li /g)!.length).toBe(1);
  });

  it('infobulle à 10 px du curseur, retournée quand elle sortirait du graphique', () => {
    expect(positionInfobulle([100, 50], [200, 120], [1000, 280])).toEqual([110, 60]);
    expect(positionInfobulle([900, 50], [200, 120], [1000, 280])).toEqual([690, 60]);
    expect(positionInfobulle([100, 200], [200, 120], [1000, 280])).toEqual([110, 70]);
    expect(positionInfobulle([5, 5], [2000, 400], [1000, 280])).toEqual([0, 0]);
    // Retournée, elle s'arrête au coin de la zone de tracé (Recharts : `viewBox.x`, `viewBox.y`), jamais au bord.
    expect(positionInfobulle([232, 60], [280, 400], [434, 280], [62, 20])).toEqual([62, 20]);
  });

  it('les axes utilisent les formateurs et le domaine donnés', () => {
    const o = optionCourbe({ ...base, domaineX: [100, 10000] }) as {
      xAxis: { min: number; max: number; axisLabel: { formatter: (v: number) => string } };
      yAxis: { axisLabel: { formatter: (v: number) => string } };
    };
    expect(o.xAxis.min).toBe(100);
    expect(o.xAxis.max).toBe(10000);
    expect(o.xAxis.axisLabel.formatter(5000)).toBe('5 km');
    expect(o.yAxis.axisLabel.formatter(12)).toBe('12');
  });

  it('aucune couleur ne vient d\'ailleurs que de la palette reçue', () => {
    const texte = JSON.stringify(optionCourbe({ ...base, repere: { x: 5000, libelle: 'R' } }));
    const hex = texte.match(/#[0-9a-fA-F]{6}/g) ?? [];
    const permises = new Set([...Object.values(COULEURS.series), COULEURS.texte, COULEURS.textePrincipal, COULEURS.grille, COULEURS.axe, COULEURS.fondInfobulle, COULEURS.bordInfobulle, COULEURS.repere, COULEURS.halo, COULEURS.pointActif]);
    expect(hex.filter((h) => !permises.has(h))).toEqual([]);
  });
});

import { type CouleursNuage, optionNuage } from './option-nuage';

const COULEURS: CouleursNuage = {
  point: '#4ecdc4', texte: '#8a8a8a', axe: '#1a1a1a', fondInfobulle: '#0a0a0a', textePrincipal: '#f0f0f0', texteSecondaire: '#b0b0b0',
};

type Option = {
  grid: Record<string, number>;
  xAxis: { name: string; axisLabel: { formatter: (v: number) => string; color: string }; axisLine: { lineStyle: { color: string } } };
  yAxis: { axisLabel: { color: string } };
  tooltip: { formatter: (p: { data: [number, number, string] }) => string; backgroundColor: string; borderColor: string };
  series: { type: string; data: unknown[]; symbolSize: number; itemStyle: { color: string; opacity: number } }[];
};

describe('optionNuage (ScatterChart de CorrelationTool.tsx:262-296)', () => {
  const option = optionNuage({
    points: [{ code: '13001', x: 1200, y: 21.34 }, { code: '<b>', x: 5, y: 1 }],
    libelleX: 'Impressions',
    formaterX: (v) => `${v}k`,
    infobulle: (p) => [p.code, `${p.x} impressions`, `Revenu : ${p.y.toFixed(1)}`],
    couleurs: COULEURS,
  }) as unknown as Option;

  it('un point par code postal, teal à 55 %, 9 px comme le nuage React mesuré', () => {
    expect(option.series).toHaveLength(1);
    expect(option.series[0].type).toBe('scatter');
    expect(option.series[0].data).toEqual([[1200, 21.34, '13001'], [5, 1, '<b>']]);
    expect(option.series[0].itemStyle).toEqual({ color: '#4ecdc4', opacity: 0.55 });
    expect(option.series[0].symbolSize).toBe(9);
  });

  it('axes : « Impressions » en bas, graduations abrégées, couleurs des jetons ; marges de Recharts', () => {
    expect(option.xAxis.name).toBe('Impressions');
    expect(option.xAxis.axisLabel.formatter(3)).toBe('3k');
    expect(option.xAxis.axisLabel.color).toBe('#8a8a8a');
    expect(option.xAxis.axisLine.lineStyle.color).toBe('#1a1a1a');
    expect(option.grid).toEqual({ top: 8, right: 12, bottom: 54, left: 42, containLabel: false });
  });

  it('infobulle : trois lignes, le code en couleur principale, ÉCHAPPÉE', () => {
    const html = option.tooltip.formatter({ data: [5, 1, '<b>'] });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('5 impressions');
    expect(option.tooltip.backgroundColor).toBe('#0a0a0a');
  });
});

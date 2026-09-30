import { optionCourbe, type SerieCourbe } from './option-courbe';

const COULEURS = {
  series: { total: '#4ecdc4', a: '#e07a3f' },
  texte: '#8a8a8a', grille: '#1a1a1a', fondInfobulle: '#0a0a0a', bordInfobulle: '#262626', repere: '#b0b0b0',
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
    expect(o.series[1].data).toEqual([[100, 4], [200, 9]]);
  });

  it('une série masquée disparaît', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['a']) }) as { series: { name: string }[] };
    expect(o.series.map((s) => s.name)).toEqual(['Toutes natures']);
  });

  it('le repère est une ligne verticale étiquetée, portée par la première série visible', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['total']), repere: { x: 5000, libelle: 'Rayon 5 km' } }) as {
      series: { markLine?: { data: { xAxis: number; label: { formatter: string } }[] } }[];
    };
    expect(o.series[0].markLine!.data[0].xAxis).toBe(5000);
    expect(o.series[0].markLine!.data[0].label.formatter).toBe('Rayon 5 km');
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
    const permises = new Set([...Object.values(COULEURS.series), COULEURS.texte, COULEURS.grille, COULEURS.fondInfobulle, COULEURS.bordInfobulle, COULEURS.repere]);
    expect(hex.filter((h) => !permises.has(h))).toEqual([]);
  });
});

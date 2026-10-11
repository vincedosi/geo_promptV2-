import {
  type CadreGraphique, optionBarres, optionBarresEcart, optionBarresGroupees, optionDonut, optionNuagePca,
} from './options-graphiques';

const CADRE: CadreGraphique = {
  texte: '#b0b0b0', texteDiscret: '#8a8a8a', textePrincipal: '#f0f0f0', bord: '#1a1a1a', fondInfobulle: '#0a0a0a',
  positif: '#3dffa0', negatif: '#ff5757', reference: '#8a8a8a',
};
type Opt = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('options ECharts du rapport (les graphiques Recharts de ClusterDetails.tsx)', () => {
  it('donut : anneau 55 → 85, écart 2, pourcentage arrondi, couleurs des clusters, légende en bas', () => {
    const o = optionDonut([{ nom: 'A', valeur: 3, couleur: '#4e79a7' }, { nom: 'B', valeur: 1, couleur: '#f28e2b' }], CADRE) as Opt;
    const s = o['series'][0];
    expect(s.type).toBe('pie');
    expect(s.radius).toEqual([55, 85]);
    expect(s.padAngle).toBe(2);
    expect(s.data.map((d: Opt) => [d['name'], d['value'], d['itemStyle'].color])).toEqual([['A', 3, '#4e79a7'], ['B', 1, '#f28e2b']]);
    expect(s.label.formatter({ percent: 75 })).toBe('75%');
    expect(o['tooltip'].formatter({ name: 'A', value: 3, color: '#4e79a7' })).toContain('3 POI (75.0%)');
    expect(o['legend'].bottom).toBe(0);
  });

  it('barres horizontales : catégories de HAUT en BAS (ordre des données), une couleur par barre, repère « idéal » optionnel', () => {
    const o = optionBarres([{ nom: 'A', valeur: 3, couleur: '#4e79a7' }, { nom: 'B', valeur: 1, couleur: '#f28e2b' }], CADRE, { largeurAxe: 140, ideal: 2 }) as Opt;
    expect(o['yAxis'].inverse).toBe(true);
    expect(o['yAxis'].data).toEqual(['A', 'B']);
    expect(o['series'][0].data.map((d: Opt) => d['itemStyle'].color)).toEqual(['#4e79a7', '#f28e2b']);
    expect(o['series'][0].markLine.data[0].xAxis).toBe(2);
    expect(o['series'][0].markLine.data[0].label.formatter).toBe('idéal');
    expect((optionBarres([], CADRE, { largeurAxe: 140 }) as Opt)['series'][0].markLine).toBeUndefined();
  });

  it('barres d’écart : signe dans les graduations, vert au-dessus de 0, rouge en dessous, ligne 0', () => {
    const o = optionBarresEcart([{ variable: '0-17', ecart: 0.05 }, { variable: 'HLM', ecart: -0.02 }], CADRE) as Opt;
    expect(o['xAxis'].axisLabel.formatter(0.05)).toBe('+5%');
    expect(o['xAxis'].axisLabel.formatter(-0.02)).toBe('-2%');
    expect(o['series'][0].data.map((d: Opt) => d['itemStyle'].color)).toEqual(['#3dffa0', '#ff5757']);
    expect(o['series'][0].markLine.data[0].xAxis).toBe(0);
    expect(o['tooltip'].formatter([{ name: '0-17', value: 0.05, color: '#3dffa0' }])).toContain('+5.00 pp');
  });

  it('barres groupées : une série par cluster (en %), puis « Moy. France » discrète', () => {
    const o = optionBarresGroupees(['0-17'], [{ nom: 'A', couleur: '#4e79a7', valeurs: [20.16] }], [20.0], CADRE) as Opt;
    expect(o['series'].map((s: Opt) => s['name'])).toEqual(['A', 'Moy. France']);
    expect(o['series'][1].itemStyle.color).toBe('#8a8a8a');
    expect(o['series'][1].itemStyle.opacity).toBe(0.5);
    expect(o['xAxis'].axisLabel.formatter(20)).toBe('20%');
    expect(o['xAxis'].name).toBe('% (0–100)');
  });

  it('nuage PCA : une série par cluster, infobulle nom · ville · PC1 / PC2', () => {
    const o = optionNuagePca([{ nom: 'A', couleur: '#4e79a7', points: [{ x: 0.1234, y: -0.5, nom: 'Lycée', ville: 'Lyon' }] }], CADRE) as Opt;
    expect(o['series'][0].type).toBe('scatter');
    expect(o['series'][0].data[0].value).toEqual([0.1234, -0.5]);
    const html = o['tooltip'].formatter({ data: o['series'][0].data[0] });
    expect(html).toContain('Lycée');
    expect(html).toContain('PC1 0.123 · PC2 -0.500');
    expect(o['xAxis'].name).toBe('Composante PCA 1');
  });

  it('les noms venus de la base sont ÉCHAPPÉS dans les infobulles (HTML)', () => {
    const o = optionNuagePca([{ nom: 'A', couleur: '#4e79a7', points: [{ x: 0, y: 0, nom: '<img src=x onerror=alert(1)>', ville: '' }] }], CADRE) as Opt;
    expect(o['tooltip'].formatter({ data: o['series'][0].data[0] })).not.toContain('<img');
  });
});

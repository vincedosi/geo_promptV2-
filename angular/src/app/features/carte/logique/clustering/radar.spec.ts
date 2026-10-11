import { dessinerRadar } from './radar';

const CLES = ['pct_0_17', 'pct_18_39', 'pct_40_54', 'revenu_moyen'];

describe('dessinerRadar (RadarChart de ClusterPanel, ClusterRadar du rapport)', () => {
  it('moins de 3 axes, ou aucun profil : rien à dessiner', () => {
    expect(dessinerRadar({ profils: [{}], couleurs: ['#000'], libelles: ['a'], cles: ['a', 'b'], taille: 190, maxAxes: 6 })).toBeNull();
    expect(dessinerRadar({ profils: [], couleurs: [], libelles: [], cles: CLES, taille: 190, maxAxes: 6 })).toBeNull();
  });

  it('axes plafonnés (6 au panneau), le premier à la verticale du centre, rayon 0,33 × taille, toFixed(1)', () => {
    const cles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const d = dessinerRadar({ profils: [{ a: 1 }], couleurs: ['#4e79a7'], libelles: ['C0'], cles, taille: 200, maxAxes: 6 })!;
    expect(d.axes).toHaveLength(6);
    expect(d.axes[0]).toEqual({ x1: '100.0', y1: '100.0', x2: '100.0', y2: '34.0' });
    expect(d.grilles.map((g) => g.exterieur)).toEqual([false, false, false, true]);
    expect(d.etiquettes.map((e) => e.texte)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('chaque axe est normalisé par le MAXIMUM des profils (et de la référence), plafonné à 1', () => {
    const d = dessinerRadar({
      profils: [{ pct_0_17: 0.2, pct_18_39: 0.1, pct_40_54: 0.3, revenu_moyen: 2 }, { pct_0_17: 0.1, pct_18_39: 0.1, pct_40_54: 0.3, revenu_moyen: 1 }],
      couleurs: ['#4e79a7', '#f28e2b'], libelles: ['A', 'B'], cles: CLES, taille: 100, maxAxes: 16,
      reference: { pct_0_17: 0.4, pct_18_39: 0.1, pct_40_54: 0.3, revenu_moyen: 1 },
    })!;
    // Axe 0 (haut) : 0,2 / 0,4 = 0,5 du rayon 33 → y = 50 − 16,5.
    expect(d.traces[0].d.startsWith('M 50.0,33.5 L ')).toBe(true);
    expect(d.reference!.startsWith('M 50.0,17.0 L ')).toBe(true);
    expect(d.traces.map((t) => t.couleur)).toEqual(['#4e79a7', '#f28e2b']);
  });

  it('étiquettes : libellé court (« 0-17 »), repli sur les 9 premiers caractères ; ancre selon la position', () => {
    const d = dessinerRadar({ profils: [{}], couleurs: ['#000'], libelles: ['x'], cles: [...CLES, 'variable_inconnue'], taille: 190, maxAxes: 16 })!;
    expect(d.etiquettes.map((e) => e.texte)).toEqual(['0-17', '18-39', '40-54', 'Revenu', 'variable_']);
    expect(d.etiquettes[0]).toMatchObject({ ancre: 'middle', base: 'auto' });
    expect(d.etiquettes[1]).toMatchObject({ ancre: 'start' });
  });

  it('légende : une entrée par série, puis « Moy. France » en tirets si une référence est donnée — sauf légende de référence masquée', () => {
    const base = { profils: [{}], couleurs: ['#4e79a7'], libelles: ['C0: Seniors'], cles: CLES, taille: 200, maxAxes: 16 };
    const avec = dessinerRadar({ ...base, reference: {} })!;
    expect(avec.legende).toEqual([
      { transform: 'translate(4, 190)', couleur: '#4e79a7', libelle: 'C0: Seniors', tirets: false },
      { transform: 'translate(4, 178)', couleur: 'var(--text-tertiary)', libelle: 'Moy. France', tirets: true },
    ]);
    expect(dessinerRadar({ ...base, reference: {}, legendeReference: false })!.legende).toHaveLength(1);
    expect(dessinerRadar({ ...base, legende: false })!.legende).toEqual([]);
  });
});

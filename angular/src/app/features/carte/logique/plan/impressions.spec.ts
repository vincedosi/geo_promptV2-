import { impressionsPrevues, previsions, repartitionParCp, totauxPrevus } from './impressions';

describe('impressionsPrevues — budget ÷ CPM × 1 000, arrondi à l’unité (A-10)', () => {
  it('arrondit à l’unité', () => {
    expect(impressionsPrevues(52000, 7.1)).toBe(7323944);
    expect(impressionsPrevues(1000, 3)).toBe(333333);
  });
  it('CPM nul, négatif ou absent, budget absent ou nul : aucune impression prévue', () => {
    expect(impressionsPrevues(1000, 0)).toBeNull();
    expect(impressionsPrevues(1000, -2)).toBeNull();
    expect(impressionsPrevues(1000, null)).toBeNull();
    expect(impressionsPrevues(null, 4)).toBeNull();
    expect(impressionsPrevues(0, 4)).toBeNull();
  });
});

describe('previsions et totauxPrevus', () => {
  const lignes = previsions(['dv360', 'meta', 'tiktok'], { dv360: 1000, meta: 500, tiktok: 300 }, { dv360: 4, meta: 2.5 });

  it('une ligne par plateforme cochée, dans l’ordre donné ; CPM absent → impressions nulles', () => {
    expect(lignes).toEqual([
      { code: 'dv360', budget: 1000, cpm: 4, impressions: 250000 },
      { code: 'meta', budget: 500, cpm: 2.5, impressions: 200000 },
      { code: 'tiktok', budget: 300, cpm: null, impressions: null },
    ]);
  });

  it('totaux : budget de toutes les lignes, impressions et CPM moyen PONDÉRÉ sur les lignes chiffrées, CPM manquants nommés', () => {
    // CPM moyen = (1 000 + 500) ÷ 450 000 × 1 000 = 3,333… → 3,33 ; le budget sans CPM n'y entre pas.
    expect(totauxPrevus(lignes)).toEqual({ budget: 1800, impressions: 450000, cpmMoyen: 3.33, cpmManquants: ['tiktok'] });
  });

  it('rien de chiffré : budget, impressions et CPM moyen nuls', () => {
    expect(totauxPrevus(previsions(['dv360'], {}, {}))).toEqual({ budget: null, impressions: null, cpmMoyen: null, cpmManquants: ['dv360'] });
    expect(totauxPrevus([])).toEqual({ budget: null, impressions: null, cpmMoyen: null, cpmManquants: [] });
  });
});

describe('repartitionParCp — impressions × multiplicateur ÷ Σ multiplicateurs de SES CP (A-11, planned_share)', () => {
  it('au prorata des multiplicateurs, trié par impressions décroissantes', () => {
    expect(repartitionParCp(1000, [
      { code_postal: '13001', multiplicateur: 1 },
      { code_postal: '13002', multiplicateur: 3 },
    ])).toEqual([
      { code_postal: '13002', multiplicateur: 3, impressions: 750 },
      { code_postal: '13001', multiplicateur: 1, impressions: 250 },
    ]);
  });

  it('la somme retombe EXACTEMENT sur le total de la plateforme (plus forts restes), malgré les arrondis', () => {
    const cps = [
      { code_postal: '69001', multiplicateur: 1 },
      { code_postal: '69002', multiplicateur: 1 },
      { code_postal: '69003', multiplicateur: 1 },
    ];
    const r = repartitionParCp(100, cps);
    expect(r.reduce((s, c) => s + c.impressions, 0)).toBe(100);
    // 33,33… chacun : le reste (1) va au premier code à égalité de reste.
    expect(r.map((c) => [c.code_postal, c.impressions])).toEqual([['69001', 34], ['69002', 33], ['69003', 33]]);

    const groupes = [
      { code_postal: '75001', multiplicateur: 0.333 },
      { code_postal: '75002', multiplicateur: 0.333 },
      { code_postal: '75003', multiplicateur: 1.5 },
      { code_postal: '75004', multiplicateur: 0.75 },
    ];
    expect(repartitionParCp(7323944, groupes).reduce((s, c) => s + c.impressions, 0)).toBe(7323944);
  });

  it('plateforme sans CP, multiplicateurs nuls ou impressions absentes : aucune répartition', () => {
    expect(repartitionParCp(1000, [])).toEqual([]);
    expect(repartitionParCp(1000, [{ code_postal: '13001', multiplicateur: 0 }])).toEqual([]);
    expect(repartitionParCp(null, [{ code_postal: '13001', multiplicateur: 1 }])).toEqual([]);
  });
});

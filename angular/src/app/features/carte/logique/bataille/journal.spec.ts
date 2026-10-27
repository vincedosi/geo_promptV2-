import { journalInitialRemplissage, journalInitialV2, lireMessageRemplissage, teinteLigneV2 } from './journal';

describe('journal des batailles (use-isochrone-battle.ts)', () => {
  it('remplissage : total, progression en place, anneaux cumulés en place, le reste ajouté — sans « > > » ni « ◆ ◆ » (défauts React)', () => {
    let r = lireMessageRemplissage(journalInitialRemplissage('cirfa', 'drive', [10, 20]), '> 2 POIs trouvés — démarrage ORS...');
    expect(r.total).toBe(2);
    expect(r.journal.at(-1)).toBe('> 2 POIs trouvés — démarrage ORS...');
    r = lireMessageRemplissage(r.journal, '> 1/2 POIs traités — 50%');
    expect(r).toMatchObject({ termines: 1, total: 2, pct: 50 });
    r = lireMessageRemplissage(r.journal, '> 2/2 POIs traités — 100%');
    expect(r.journal.filter((l) => l.startsWith('> ORS —'))).toEqual(['> ORS — 2/2 POIs — 100%']);
    r = lireMessageRemplissage(r.journal, '> ◆ +4 isochrones sur la carte');
    expect(r.anneaux).toBe(4);
    r = lireMessageRemplissage(r.journal, '> ◆ +2 isochrones sur la carte');
    expect(r.journal.filter((l) => l.startsWith('> ◆'))).toEqual(['> ◆ +2 isochrones sur la carte']);
    expect(lireMessageRemplissage(['x'], '> autre').journal).toEqual(['x', '> autre']);
    expect(lireMessageRemplissage(['x'], '   ').journal).toEqual(['x']);
  });

  it('journaux initiaux du remplissage et de V2', () => {
    expect(journalInitialRemplissage('cirfa', 'drive', [10, 20])).toEqual([
      '> [ORS] Calcul des isochrones manquants...', '> catégorie : cirfa | mode : drive', '> paliers : 10, 20 min',
    ]);
    expect(journalInitialV2('cirfa', 'drive', [10, 20])).toEqual([
      '> catégorie : cirfa', '> mode : drive | paliers : 10, 20 min', '> lecture cache isochrones...',
    ]);
  });

  it('teintes des lignes V2', () => {
    expect(teinteLigneV2('> ✓ ok')).toBe('success');
    expect(teinteLigneV2('> ✕ ko')).toBe('danger');
    expect(teinteLigneV2('> ! attention')).toBe('warning');
    expect(teinteLigneV2('> ◆ +3')).toBe('secondary');
    expect(teinteLigneV2('> ORS — 1/2')).toBe('warning');
    expect(teinteLigneV2('> [3/3] fin')).toBe('tertiary');
  });
});

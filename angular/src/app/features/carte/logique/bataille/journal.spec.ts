import {
  compteursProgression, journalInitialRemplissage, journalInitialV1, journalInitialV2, lireMessageRemplissage,
  remplacerProgression, teinteLigneV1, teinteLigneV2, tickJournal,
} from './journal';

describe('journal des batailles (use-isochrone-battle.ts)', () => {
  it('journal V1 initial : quatre lignes, textes exacts', () => {
    expect(journalInitialV1('cirfa', 'drive', 30, '1 dept(s)')).toEqual([
      '> catégorie : cirfa',
      '> mode : drive | max : 30 min',
      '> territoire : 1 dept(s)',
      '> [1/3] vérification cache isochrones...',
    ]);
  });

  it('ticker : « elapsed » ajouté puis MIS À JOUR en place ; étapes aux secondes 3, 10, 20, 35', () => {
    let j = journalInitialV1('cirfa', 'drive', 30, 'x');
    j = tickJournal(j, 1, '1.0');
    expect(j.at(-1)).toBe('> elapsed : 1.0s');
    j = tickJournal(j, 2, '2.0');
    expect(j.at(-1)).toBe('> elapsed : 2.0s');
    expect(j.filter((l) => l.startsWith('> elapsed')).length).toBe(1);
    j = tickJournal(j, 3, '3.0');
    expect(j.slice(-2)).toEqual(['> [2/3] appel ORS (peut prendre 30-120s)...', '> elapsed : 3.0s']);
    expect(tickJournal(j, 10, '10.0')).toContain('> ! premier batch ORS en cours...');
  });

  it('progression V1 : la dernière ligne « POIs traités / trouvés » est REMPLACÉE, sinon ajoutée', () => {
    let j = ['> a'];
    j = remplacerProgression(j, '> 2 POIs trouvés — démarrage ORS...');
    j = remplacerProgression(j, '> 1/2 POIs traités — 50%');
    expect(j).toEqual(['> a', '> 1/2 POIs traités — 50%']);
    expect(compteursProgression('> 1/2 POIs traités — 50%')).toEqual({ termines: 1, total: 2 });
    expect(compteursProgression('> 7 POIs trouvés — démarrage ORS...')).toEqual({ total: 7 });
    expect(compteursProgression('> ◆ +3 isochrones sur la carte')).toEqual({});
  });

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

  it('teintes des lignes : V1 et V2 ont leurs propres règles', () => {
    expect(teinteLigneV1('> ✓ ok')).toBe('success');
    expect(teinteLigneV1('> ✕ ko')).toBe('danger');
    expect(teinteLigneV1('> ! attention')).toBe('warning');
    expect(teinteLigneV1('> [3/3] fin')).toBe('success');
    expect(teinteLigneV1('> autre')).toBe('tertiary');
    expect(teinteLigneV2('> ◆ +3')).toBe('secondary');
    expect(teinteLigneV2('> ORS — 1/2')).toBe('warning');
    expect(teinteLigneV2('> [3/3] fin')).toBe('tertiary');
  });
});

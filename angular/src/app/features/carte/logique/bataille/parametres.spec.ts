import {
  basculerPalier, corpsRemplissage, corpsVerification, parametresRemplissage, parametresV2,
  messageRefusTerritoireBataille, territoireDuFiltre, type ContexteBataille,
} from './parametres';

const DEPT_13: ContexteBataille = {
  categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: ['13'] }, nbRegionsRef: 18,
};

describe('paramètres de bataille (use-isochrone-battle.ts)', () => {
  it('territoire dérivé du filtre unique : commune → ville, région / département → leur code, le reste → rien', () => {
    expect(territoireDuFiltre({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' })).toEqual({ ville: '', regions: [], depts: ['13'] });
    expect(territoireDuFiltre({ type: 'region', code: '93', label: 'PACA' })).toEqual({ ville: '', regions: ['93'], depts: [] });
    expect(territoireDuFiltre({ type: 'commune', code: '13055', label: 'Marseille' })).toEqual({ ville: 'Marseille', regions: [], depts: [] });
    expect(territoireDuFiltre({ type: 'cp', code: '13001', label: '13001' })).toEqual({ ville: '', regions: [], depts: [] });
    expect(territoireDuFiltre(null)).toEqual({ ville: '', regions: [], depts: [] });
  });

  it('refus d’un filtre non transmis : code postal et zone refusés, nommés ; les filtres transmis et les autres → null', () => {
    expect(messageRefusTerritoireBataille({ type: 'cp', code: '13001', label: '13001' })).toContain('à un code postal');
    expect(messageRefusTerritoireBataille({ type: 'zone', code: 'z', label: 'Z' })).toContain('à une zone enregistrée');
    for (const type of ['commune', 'departement', 'region', 'france'] as const) {
      expect(messageRefusTerritoireBataille({ type, code: 'x', label: 'x' })).toBeNull();
    }
    expect(messageRefusTerritoireBataille(null)).toBeNull();
  });

  it('corps de vérification du cache : mêmes clés que buildCheckParams, les absentes non envoyées', () => {
    expect(JSON.parse(JSON.stringify(corpsVerification(DEPT_13, [10, 30])))).toEqual({
      category: 'cirfa', mode: 'drive', paliers: [10, 30], metropolitaine: true, filtre_depts: ['13'],
    });
  });

  it('règle « toutes les régions » : une région seule part, toutes ne partent pas, référentiel vide → part', () => {
    const region = (n: number, nbRegionsRef: number) => corpsVerification(
      { ...DEPT_13, territoire: { ville: '', regions: Array.from({ length: n }, (_, i) => String(i)), depts: [] }, nbRegionsRef }, [10],
    ).filtre_regions;
    expect(region(1, 18)).toEqual(['0']);
    expect(region(18, 18)).toBeUndefined();
    expect(region(1, 0)).toEqual(['0']);
  });

  it('remplissage : le corps EXACT de la route protégée — filtres absents à null, force_recalculate à false', () => {
    const p = parametresRemplissage(DEPT_13, [30, 10]);
    expect(corpsRemplissage(p)).toEqual({
      category: 'cirfa', mode: 'drive', max_minutes: 30, durations: [10, 30],
      filtre_ville: null, filtre_regions: null, filtre_depts: ['13'], metropolitaine: true, force_recalculate: false,
    });
  });

  it('remplissage V2 : durées = paliers triés, maximum ; V2 : paliers triés et force_battle', () => {
    expect(parametresRemplissage(DEPT_13, [90, 10])).toMatchObject({ durations: [10, 90], max_minutes: 90, filtre_depts: ['13'] });
    expect(parametresV2(DEPT_13, [20, 10], true)).toMatchObject({ category: 'cirfa', paliers: [10, 20], force_battle: true, metropolitaine: true });
  });

  it('basculerPalier : ajoute en gardant l’ordre croissant, retire', () => {
    expect(basculerPalier([10, 30], 20)).toEqual([10, 20, 30]);
    expect(basculerPalier([10, 30], 30)).toEqual([10]);
  });
});

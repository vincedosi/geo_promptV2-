import { formaterNombre } from '../../../core/format/nombre';
import {
  DEFAUTS, REGLAGES, classeBouton, lignesBilan, lignesPartenaires, pct, sitesSousServis,
} from './panneau-campagne';
import { PARAMS_DEFAUT } from './simulation/parametres';
import type { LigneZone, VueSimulation } from './simulation/vue';

const zone = (id: string, part_plan: number, indice: number | null, n_sites: number) =>
  ({ id, nom: `Bassin ${id}`, part_plan, indice, n_sites }) as LigneZone;

describe('réglages de la diffusion', () => {
  it('six réglages, la graine ramenée sous le maximum du curseur', () => {
    expect(REGLAGES.map((r) => r.cle)).toEqual(['budget', 'intensite', 'fuite', 'bruit', 'amortissement', 'graine']);
    expect(DEFAUTS.graine).toBe(PARAMS_DEFAUT.graine % 100_000);
    expect(DEFAUTS.graine).toBeLessThanOrEqual(REGLAGES[5].max);
  });

  it('formats : euros, pourcentages, graine brute', () => {
    expect(REGLAGES[0].format(20_000)).toBe(`${formaterNombre(20_000)} €`);
    expect(REGLAGES[2].format(0.05)).toBe('5,0 %');
    expect(REGLAGES[5].format(42)).toBe('42');
  });
});

describe('pct et classeBouton', () => {
  it('pct : une décimale, tiret sans valeur', () => {
    expect(pct(0.123)).toBe('12,3 %');
    expect(pct(null)).toBe('—');
    expect(pct(undefined)).toBe('—');
  });

  it('classeBouton : teal si principal, curseur interdit si désactivé', () => {
    expect(classeBouton(true, false)).toContain('border-teal text-teal');
    expect(classeBouton(true, false)).toContain('cursor-pointer');
    expect(classeBouton(false, true)).toContain('border-default text-secondary');
    expect(classeBouton(false, true)).toContain('cursor-not-allowed opacity-50');
  });
});

describe('blocs du panneau', () => {
  it('sans réponse : aucun bilan, aucun partenaire', () => {
    expect(lignesBilan(null)).toBeNull();
    expect(lignesPartenaires(null)).toEqual([]);
  });

  it('partenaires : impressions abrégées, CPM en euros, parts en %', () => {
    const v = { partenaires: [{ nom: 'A', impressions: 1000, cpm: 4.5, part_en_zone: 0.8, taux_utile: null }] } as unknown as VueSimulation;
    expect(lignesPartenaires(v)).toEqual([{ nom: 'A', impressions: expect.any(String), cpm: '4,50 €', partEnZone: '80,0 %', tauxUtile: '—' }]);
  });

  it('sites sous-servis : seulement les bassins du plan pas « servis », du pire au moins pire, huit au plus', () => {
    const zones = [
      zone('a', 0.1, 120, 3), // servi
      zone('b', 0.1, 40, 2), // sous-servi
      zone('c', 0, 10, 9), // hors plan
      zone('d', 0.1, 70, 1), // partiel
      ...Array.from({ length: 8 }, (_, i) => zone(`z${i}`, 0.1, 80, 1)),
    ];
    const r = sitesSousServis({ zones } as unknown as VueSimulation);
    expect(r.zones.map((z) => z.id).slice(0, 2)).toEqual(['b', 'd']);
    expect(r.zones).toHaveLength(8);
    expect(r.nBassins).toBe('10');
    expect(r.nSites).toBe('11');
    expect(r.zones[0]).toEqual({ id: 'b', nom: 'Bassin b', sites: '2 sites', indice: '40' });
    expect(r.zones[1].sites).toBe('1 site');
  });
});

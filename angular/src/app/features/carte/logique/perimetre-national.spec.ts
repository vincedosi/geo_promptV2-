import type { FiltreActif } from './filtre';
import { type OutilAnalyse, messageGardeOutil } from './garde-perimetre';
import {
  FILTRE_FRANCE_ENTIERE, FILTRE_METROPOLE, corpsPoisDuFiltre, estMetropole, messageGardeCarte, scopeDuFiltre,
} from './perimetre-national';

const OUTILS: OutilAnalyse[] = ['voronoi', 'bataille_v1', 'bataille_v2', 'application_bataille', 'clustering', 'score_composite'];
const REGION: FiltreActif = { type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" };
const FILTRES: (FiltreActif | null)[] = [
  null, REGION, FILTRE_METROPOLE, FILTRE_FRANCE_ENTIERE,
  { type: 'departement', code: '13', label: '13 — Bouches-du-Rhône' },
  { type: 'commune', code: 'brest', label: 'Brest' },
  { type: 'cp', code: '13001', label: 'CP 13001' },
  { type: 'zone', code: 'z1', label: 'Zone', bbox: [5, 43, 6, 44] },
];

describe('perimetre-national', () => {
  it('les deux filtres nationaux', () => {
    expect(FILTRE_METROPOLE).toEqual({ type: 'france', code: 'metro', label: 'France métropolitaine' });
    expect(FILTRE_FRANCE_ENTIERE).toEqual({ type: 'france', code: 'france', label: 'France entière' });
    expect(estMetropole(FILTRE_METROPOLE)).toBe(true);
    expect(estMetropole(FILTRE_FRANCE_ENTIERE)).toBe(false);
    expect(estMetropole(REGION)).toBe(false);
    expect(estMetropole(null)).toBe(false);
  });

  it('scopeDuFiltre : le filtre fait foi, le repli ne joue que sans filtre', () => {
    expect(scopeDuFiltre(FILTRE_METROPOLE, null)).toBe('metro');
    expect(scopeDuFiltre(FILTRE_FRANCE_ENTIERE, 'metro')).toBe('all');
    expect(scopeDuFiltre(REGION, 'metro')).toBeNull();
    expect(scopeDuFiltre(null, 'metro')).toBe('metro');
    expect(scopeDuFiltre(null, null)).toBeNull();
  });

  it('messageGardeCarte sur la métropole : la bataille V2 et le score passent, Voronoï et clustering refusent en la nommant', () => {
    for (const o of ['bataille_v2', 'score_composite'] as const) {
      expect(messageGardeCarte(o, FILTRE_METROPOLE)).toBeNull();
    }
    // La V1 et son application, retirées d’Angular (27/10), ne sont plus admises sur la métropole.
    for (const o of ['bataille_v1', 'application_bataille'] as const) {
      expect(messageGardeCarte(o, FILTRE_METROPOLE)).toContain('sur toute la France métropolitaine');
    }
    expect(messageGardeCarte('voronoi', FILTRE_METROPOLE))
      .toBe('Le Voronoï ne peut pas être calculé sur toute la France métropolitaine — choisissez une région ou un département.');
    expect(messageGardeCarte('clustering', FILTRE_METROPOLE))
      .toBe('Le clustering ne peut pas être calculé sur toute la France métropolitaine — choisissez une région ou un département.');
  });

  it('hors métropole, messageGardeCarte = messageGardeOutil (tous les outils × tous les filtres × zone)', () => {
    for (const o of OUTILS) for (const f of FILTRES) for (const z of [null, undefined, 'zone-1']) {
      if (estMetropole(f)) continue;
      expect(messageGardeCarte(o, f, z), `${o} / ${f?.type ?? 'null'} / ${String(z)}`).toBe(messageGardeOutil(o, f, z));
    }
    // La France entière reste refusée aux batailles.
    expect(messageGardeCarte('bataille_v2', FILTRE_FRANCE_ENTIERE)).toMatch(/sur la France entière/);
  });

  it('corpsPoisDuFiltre : chaque type de filtre', () => {
    const vide = { regions: [], depts: [], ville: '' };
    expect(corpsPoisDuFiltre(null)).toEqual(vide);
    expect(corpsPoisDuFiltre(REGION)).toEqual({ ...vide, regions: ['93'] });
    expect(corpsPoisDuFiltre({ type: 'departement', code: '2A', label: '2A — Corse-du-Sud' })).toEqual({ ...vide, depts: ['2A'] });
    expect(corpsPoisDuFiltre({ type: 'commune', code: 'brest', label: 'Brest' })).toEqual({ ...vide, ville: 'Brest' });
    expect(corpsPoisDuFiltre({ type: 'cp', code: '06300', label: 'CP 06300' })).toEqual({ ...vide, code_postal: '06300' });
    expect(corpsPoisDuFiltre({ type: 'zone', code: 'z1', label: 'Zone', bbox: [5, 43, 6, 44] })).toEqual(vide);
    expect(corpsPoisDuFiltre(FILTRE_METROPOLE)).toEqual(vide);
    expect(corpsPoisDuFiltre(FILTRE_FRANCE_ENTIERE)).toEqual(vide);
  });
});

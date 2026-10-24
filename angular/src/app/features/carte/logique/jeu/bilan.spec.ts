import type { ResultatCouverture } from '../analyses/couverture';
import { type ResultatCercles, bilanDe, cleCouverture, lectureRequise, parPlateforme, rangerCouverture } from './bilan';
import type { PlateformeGeo } from './plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
const couverture = (decoupage: string, zone_maj: string, population = 1000) => ({
  decoupage, zone_maj, population, surface_km2: 10,
  lignes: [{ code: 'a', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 600, pop_totale: 1000, part: 60 }],
} as unknown as ResultatCouverture);
const pavage = { rayon_m: 5000, seuil: 20, n_cercles: 3, n_candidates: 9, couverte: 900, achetee: 1200, manques: 100, hors_zone: 300, taux_utile: 75 } as ResultatCercles;

describe('bilan d’un choix (logique pure de ⑤)', () => {
  const cp = ligne({ plateforme: 'dv360', maille: 'cp' });
  const cercle = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 2 } });
  const point = { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 5000 } as const;

  it('la lecture requise : découpage, forme pour une maille exacte, pavage pour un cercle calculé', () => {
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, null)).toBe('cp');
    expect(lectureRequise({ maille: 'polygone', seuil: 20 }, ligne({ plateforme: 'ttd', maille: 'polygone' }), null)).toBe('forme');
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, { v: 1, type: 'codes_postaux', codes: ['13001'] })).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, point)).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 8000 }, cercle, point)).toBe('cercles');
  });
  it('maille territoriale : le seuil se rejoue sur la couverture ; exacte : aucune perte ; rien de lu : null', () => {
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 1, couverte: 600, manques: 400 });
    expect(bilanDe({ maille: 'cp', seuil: 70 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 0, manques: 1000 });
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, { v: 1, type: 'codes_postaux', codes: ['1', '2', '2'] }, couverture('forme', 'v1'))?.resume)
      .toMatchObject({ exacte: true, n_unites: 2, manques: 0 });
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, undefined)).toBeNull();
  });
  it('cercles : le pavage vaut pour SON rayon et SON seuil ; les limites de la ligne avertissent', () => {
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, null, pavage);
    expect(b?.resume).toMatchObject({ exacte: false, n_unites: 3, n_touchees: 9, taux_utile: 75 });
    expect(b?.avertissements).toEqual([{ code: 'max_unites', limite: 2, valeur: 3 }]);
    expect(bilanDe({ maille: 'cercle', seuil: 40, rayon_m: 5000 }, cercle, null, pavage)).toBeNull();
    expect(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 6000 }, cercle, null, pavage)).toBeNull();
  });
  it('la clé porte la date de mise à jour : une zone recalculée se relit', () => {
    expect(cleCouverture('z', 'm1', 'ind', 'cp')).not.toBe(cleCouverture('z', 'm2', 'ind', 'cp'));
    expect(cleCouverture('z', null, 'ind', 'cp')).toBe('z||ind|cp');
  });
  it('ranger : une autre version de la forme purge les entrées de la MÊME zone, pas celles d’une autre', () => {
    const avant = new Map([
      [cleCouverture('z', null, 'ind', 'forme'), couverture('forme', 'v1')],
      [cleCouverture('y', null, 'ind', 'cp'), couverture('cp', 'w1')],
    ]);
    const r = rangerCouverture(avant, cleCouverture('z', null, 'ind', 'cp'), couverture('cp', 'v2'));
    expect(r.purgee).toBe(true);
    expect([...r.cache.keys()].sort()).toEqual(['y||ind|cp', 'z||ind|cp']);
    const memeVersion = rangerCouverture(avant, cleCouverture('z', null, 'ind', 'cp'), couverture('cp', 'v1'));
    expect([memeVersion.purgee, memeVersion.cache.size]).toEqual([false, 3]);
  });
  it('par plateforme : seules les plateformes au registre, valeurs absentes omises', () => {
    const regle = (p: string) => (p === 'dv360' ? cp : undefined);
    expect(parPlateforme({ dv360: { maille: 'cp', seuil: 20 }, ttd: { maille: 'cp', seuil: 20 } }, regle, () => 1)).toEqual({ dv360: 1 });
    expect(parPlateforme({ dv360: { maille: 'cp', seuil: 20 } }, regle, () => null)).toEqual({});
  });
});

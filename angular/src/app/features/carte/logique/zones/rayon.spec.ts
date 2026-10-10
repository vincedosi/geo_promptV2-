import { RAYON_MAX_M, RAYON_MIN_M, cercleApercu, corpsRayon, libelleRayon, nomRayonParDefaut } from './rayon';

describe('rayon — logique pure de la zone par rayon (CreerZoneRayon.tsx)', () => {
  it('bornes du curseur : 500 m à 100 km (le minimum de la route est plus bas, à dessein)', () => {
    expect(RAYON_MIN_M).toBe(500);
    expect(RAYON_MAX_M).toBe(100_000);
  });

  it('Marseille, 20 km → le corps de /source/rayon : { lon, lat, rayon_m: 20000 }', () => {
    expect(corpsRayon({ lon: 5.3698, lat: 43.2965 }, 20_000)).toEqual({ lon: 5.3698, lat: 43.2965, rayon_m: 20000 });
  });

  it('un rayon hors bornes est ramené dans [500 m ; 100 km] avant de partir', () => {
    expect(corpsRayon({ lon: 0, lat: 45 }, 250_000).rayon_m).toBe(100_000);
    expect(corpsRayon({ lon: 0, lat: 45 }, 10).rayon_m).toBe(500);
  });

  it('libellé du curseur et nom par défaut, comme React', () => {
    expect(libelleRayon(20_000)).toBe('20 km');
    expect(libelleRayon(1_500)).toBe('1.5 km');
    expect(libelleRayon(500)).toBe('500 m');
    expect(nomRayonParDefaut(20_000)).toBe('Rayon de 20 km');
  });

  it('aperçu : 65 positions (64 segments, anneau fermé), étiré en longitude par cos(latitude)', () => {
    const f = cercleApercu(5, 60, 10_000);
    const anneau = (f.geometry as GeoJSON.Polygon).coordinates[0];
    expect(anneau).toHaveLength(65);
    expect(anneau[0][0]).toBeCloseTo(anneau[64][0], 10);
    const demiLargeur = anneau[0][0] - 5;
    const demiHauteur = anneau[16][1] - 60;
    // À 60° de latitude, un degré de longitude vaut la moitié d'un degré de latitude.
    expect(demiLargeur / demiHauteur).toBeCloseTo(2, 5);
  });
});

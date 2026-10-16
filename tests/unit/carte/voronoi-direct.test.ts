/**
 * `lib/carte/voronoi-direct.ts` — les deux traductions que faisait le chat :
 * le territoire du panneau en paramètres de `GET /api/voronoi`, et le
 * résultat en affichage (branche `voronoi_analysis` de `useToolProcessor`).
 */
import { describe, it, expect, vi } from 'vitest';
import { requeteVoronoi, appliquerResultatVoronoi, type TerritoireVoronoi } from '@/lib/carte/voronoi-direct';
import type { VoronoiData, ZoneData } from '@/types/spatial';

const REGIONS = [{ code_region: '53', nom_region: 'Bretagne' }, { code_region: '84', nom_region: 'Auvergne-Rhône-Alpes' }];
const vide: TerritoireVoronoi = { scope: null, selectedRegions: [], selectedDepts: [], ville: '', refRegions: REGIONS };
const params = (q: string) => Object.fromEntries(new URLSearchParams(q));

describe('requeteVoronoi — le territoire de la phrase au chat, en paramètres', () => {
  it('« de France » / « de France métropolitaine » : la catégorie seule (métropole, le défaut de l’outil)', () => {
    expect(params(requeteVoronoi('lycee', vide))).toEqual({ categorie: 'lycee' });
    expect(params(requeteVoronoi('lycee', { ...vide, scope: 'metro' }))).toEqual({ categorie: 'lycee' });
  });

  it('« de France entière » : metropolitaine=false', () => {
    expect(params(requeteVoronoi('lycee', { ...vide, scope: 'all' }))).toEqual({ categorie: 'lycee', metropolitaine: 'false' });
  });

  it('la ville prime, puis UN département, puis UNE région (par son NOM, comme la RPC le filtre)', () => {
    const tout = { ...vide, ville: ' Rennes ', selectedDepts: ['35'], selectedRegions: ['53'] };
    expect(params(requeteVoronoi('lycee', tout))).toEqual({ categorie: 'lycee', ville: 'Rennes' });
    expect(params(requeteVoronoi('lycee', { ...tout, ville: '' }))).toEqual({ categorie: 'lycee', departement: '35' });
    expect(params(requeteVoronoi('lycee', { ...tout, ville: '', selectedDepts: [] }))).toEqual({ categorie: 'lycee', region: 'Bretagne' });
  });

  it('région inconnue du référentiel (pas encore chargé) : son code, plutôt que rien', () => {
    expect(params(requeteVoronoi('lycee', { ...vide, selectedRegions: ['53'], refRegions: [] }))).toEqual({ categorie: 'lycee', region: '53' });
  });

  it('plusieurs départements ou régions : pas d’équivalent dans la RPC, retombe sur l’étendue', () => {
    expect(params(requeteVoronoi('lycee', { ...vide, selectedDepts: ['35', '29'], selectedRegions: ['53'] }))).toEqual({ categorie: 'lycee' });
    expect(params(requeteVoronoi('lycee', { ...vide, scope: 'all', selectedRegions: ['53', '84'] }))).toEqual({ categorie: 'lycee', metropolitaine: 'false' });
  });

  it('encode la catégorie', () => {
    expect(requeteVoronoi('école & lycée', vide)).toBe('categorie=%C3%A9cole+%26+lyc%C3%A9e');
  });
});

describe('appliquerResultatVoronoi — la branche voronoi_analysis de useToolProcessor', () => {
  const afficheur = () => ({ applyVoronoi: vi.fn(), setZoneData: vi.fn(), setError: vi.fn() });
  const geo = (n: number): VoronoiData => ({
    type: 'FeatureCollection',
    features: Array.from({ length: n }, () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })),
    _meta: { category: 'lycee' },
  });
  const zone = { ville: 'Bretagne', pois: [], nb_pois: 0 } as unknown as ZoneData;

  it('erreur : le bandeau, avec le préfixe de l’outil, et rien d’autre', () => {
    const a = afficheur();
    appliquerResultatVoronoi({ error: 'Catégorie « bmw » hors de votre périmètre de données.' }, a);
    expect(a.setError).toHaveBeenCalledWith('⬡ Voronoï — Erreur : Catégorie « bmw » hors de votre périmètre de données.');
    expect(a.applyVoronoi).not.toHaveBeenCalled();
    expect(a.setZoneData).not.toHaveBeenCalled();
  });

  it('succès : les cellules, puis les POI de la zone', () => {
    const a = afficheur();
    const g = geo(3);
    appliquerResultatVoronoi({ voronoiGeoJSON: g, poisForMap: zone }, a);
    expect(a.applyVoronoi).toHaveBeenCalledWith(g);
    expect(a.setZoneData).toHaveBeenCalledWith(zone);
    expect(a.setError).not.toHaveBeenCalled();
  });

  it('zéro cellule : rien à peindre, mais la zone est posée (comme l’outil)', () => {
    const a = afficheur();
    appliquerResultatVoronoi({ voronoiGeoJSON: geo(0), poisForMap: zone }, a);
    expect(a.applyVoronoi).not.toHaveBeenCalled();
    expect(a.setZoneData).toHaveBeenCalledWith(zone);
  });
});

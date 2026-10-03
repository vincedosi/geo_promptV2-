import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { PROFIL_DEFAUT } from '../logique/profil';
import {
  APERCU_SITES_MAX, CERCLES_MAX, ID_APERCU, ID_CERCLES, ID_SITES, ID_SURVOL, SOURCE_APERCU, SOURCE_CERCLES,
  SOURCE_SITES, SOURCE_SURVOL, type TeintesSites, basculerCerclesSites, cerclesApercu, cerclesDesSites,
  cerclesSurvol, poserCouchesSites, repeindreCouchesSites,
} from './couches-sites';

const TEINTES: TeintesSites = {
  haut: 'rgb(1, 1, 1)', bas: 'rgb(2, 2, 2)', autres: 'rgb(3, 3, 3)', contourPoint: 'rgba(255, 255, 255, 0.9)',
};

function site(gravite: string, lon = 5, lat = 43.5): GeoJSON.Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { gravite } };
}

function collection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

/** Toutes les chaînes d'une valeur imbriquée (expressions MapLibre). */
function chaines(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(chaines);
  if (v && typeof v === 'object') return Object.values(v).flatMap(chaines);
  return [];
}

describe('couches-sites — cercles', () => {
  it('site par site : 150 sites du seuil haut × 3 anneaux → 400 cercles EXACTEMENT (le plafond porte sur les cercles)', () => {
    const fc = collection(Array.from({ length: 150 }, (_, i) => site('seveso_haut', 5 + i / 1000)));
    const cercles = cerclesDesSites(fc, PROFIL_DEFAUT, CERCLES_MAX);
    expect(CERCLES_MAX).toBe(400);
    expect(cercles).toHaveLength(400);
    expect(cercles.every((c) => c.properties?.['niveau'] === 'haut')).toBe(true);
    expect((cercles[0].geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(65); // 64 segments, refermé
  });

  it('site par site : `anneauxDuNiveau` (bas 500 m/1 km), un site « autres » garde son point sans cercle', () => {
    const fc = collection([site('seveso_bas'), site('autorisation'), { type: 'Feature', geometry: null as never, properties: {} }]);
    const cercles = cerclesDesSites(fc, PROFIL_DEFAUT, CERCLES_MAX);
    expect(cercles.map((c) => c.properties?.['niveau'])).toEqual(['bas', 'bas']);
    // Cadenas fermé : les anneaux du seuil haut valent pour TOUS les niveaux, « autres » compris (comme React).
    const lies = cerclesDesSites(fc, { ...PROFIL_DEFAUT, lie: true }, CERCLES_MAX);
    expect(lies).toHaveLength(6);
  });

  it('aperçu : 300 sites → 250 cercles (APERCU_SITES_MAX), un cercle par site au rayon réglé', () => {
    const fc = collection(Array.from({ length: 300 }, () => site('seveso_bas')));
    expect(APERCU_SITES_MAX).toBe(250);
    expect(cerclesApercu(fc, { niveau: null, rayonM: 2000 }, APERCU_SITES_MAX)).toHaveLength(250);
  });

  it('aperçu d’un niveau : seuls ses sites bougent ; `null` (niveaux liés) les dessine tous', () => {
    const fc = collection([site('seveso_haut'), site('seveso_bas'), site('ied')]);
    expect(cerclesApercu(fc, { niveau: 'bas', rayonM: 800 }, 250)).toHaveLength(1);
    expect(cerclesApercu(fc, { niveau: null, rayonM: 800 }, 250)).toHaveLength(3);
    // Le rayon est celui du réglage : à 43,5° N, 800 m vers le nord ≈ 0,0072°.
    const nord = (cerclesApercu(fc, { niveau: 'haut', rayonM: 800 }, 250)[0].geometry as GeoJSON.Polygon).coordinates[0][16];
    expect(nord[1] - 43.5).toBeCloseTo(800 / 6371000 * 180 / Math.PI, 6);
  });

  it('survol : les anneaux du site au profil courant, AUCUNE requête (fonction pure)', () => {
    expect(cerclesSurvol(site('seveso_haut'), PROFIL_DEFAUT)).toHaveLength(3);
    expect(cerclesSurvol(site('seveso_bas'), PROFIL_DEFAUT)).toHaveLength(2);
    expect(cerclesSurvol(site('autre'), PROFIL_DEFAUT)).toHaveLength(0);
    expect(cerclesSurvol({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }, PROFIL_DEFAUT)).toEqual([]);
  });
});

describe('couches-sites — couches', () => {
  function poser(cerclesVisibles = false) {
    const f = new CarteFactice();
    poserCouchesSites(f as unknown as maplibregl.Map, TEINTES, cerclesVisibles);
    return f;
  }

  it('quatre sources vides et quatre couches, du dessous au dessus : cercles, aperçu, survol, points', () => {
    const f = poser();
    expect([...f.sources.keys()]).toEqual([SOURCE_CERCLES, SOURCE_APERCU, SOURCE_SURVOL, SOURCE_SITES]);
    expect(f.couches.map((c) => c.couche['id'])).toEqual([ID_CERCLES, ID_APERCU, ID_SURVOL, ID_SITES]);
  });

  it('points colorés par `gravite`, cerne inversé ; cercles par `niveau`, tiretés ; aucun `var(`', () => {
    const f = poser();
    const points = f.getLayer(ID_SITES)!['paint'] as Record<string, unknown>;
    expect(points['circle-color']).toEqual(['match', ['get', 'gravite'], 'seveso_haut', TEINTES.haut, 'seveso_bas', TEINTES.bas, TEINTES.autres]);
    expect(points['circle-stroke-color']).toBe(TEINTES.contourPoint);
    expect(points['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5]);
    const cercles = f.getLayer(ID_CERCLES)!;
    expect((cercles['paint'] as Record<string, unknown>)['line-dasharray']).toEqual([2, 2]);
    expect((cercles['layout'] as Record<string, unknown>)['visibility']).toBe('none');
    expect((f.getLayer(ID_APERCU)!['paint'] as Record<string, unknown>)['line-color']).toBe(TEINTES.haut);
    expect((f.getLayer(ID_SURVOL)!['paint'] as Record<string, unknown>)['line-color']).toBe(TEINTES.contourPoint);
    const toutes = f.couches.flatMap((c) => chaines([c.couche['paint'], c.couche['layout']]));
    expect(toutes.some((x) => x.startsWith('var('))).toBe(false);
  });

  it('cercles nés visibles en mode site par site ; la bascule ne touche que leur visibilité', () => {
    const f = poser(true);
    expect((f.getLayer(ID_CERCLES)!['layout'] as Record<string, unknown>)['visibility']).toBe('visible');
    basculerCerclesSites(f as unknown as maplibregl.Map, false);
    expect(f.dispositions).toEqual([{ couche: ID_CERCLES, propriete: 'visibility', valeur: 'none' }]);
  });

  it('repeinte : cinq propriétés, aucune couche ni source recréée', () => {
    const f = poser();
    const n = f.couches.length;
    const clair: TeintesSites = { haut: 'rgb(9, 9, 9)', bas: 'rgb(8, 8, 8)', autres: 'rgb(7, 7, 7)', contourPoint: 'rgba(26, 26, 26, 0.85)' };
    repeindreCouchesSites(f as unknown as maplibregl.Map, clair);
    expect(f.peintures.map((p) => `${p.couche}.${p.propriete}`)).toEqual([
      `${ID_SITES}.circle-color`, `${ID_SITES}.circle-stroke-color`, `${ID_CERCLES}.line-color`,
      `${ID_APERCU}.line-color`, `${ID_SURVOL}.line-color`,
    ]);
    expect(chaines(f.peintures.map((p) => p.valeur))).toContain(clair.contourPoint);
    expect(f.couches).toHaveLength(n);
  });

  it('une carte qui ne porte pas les couches : repeinte et bascule sans effet ni erreur', () => {
    const f = new CarteFactice();
    expect(() => repeindreCouchesSites(f as unknown as maplibregl.Map, TEINTES)).not.toThrow();
    expect(() => basculerCerclesSites(f as unknown as maplibregl.Map, true)).not.toThrow();
    expect(f.peintures).toEqual([]);
  });
});

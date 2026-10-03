import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { expressionOpaciteSelonZoom } from '../logique/opacites-zones';
import { PROFIL_DEFAUT } from '../logique/profil';
import {
  COUCHES_ZONES, ID_CONTOUR, ID_ETIQUETTES, ID_FOND, ID_PPRT, SOURCE_ZONES, type TeintesZones,
  basculerCouchesZones, expressionEtiquetteClasse, poserCouchesZones, repeindreCouchesZones, retirerCouchesZones,
} from './couches-zones';

const TEINTES: TeintesZones = { haut: 'rgb(1, 1, 1)', bas: 'rgb(2, 2, 2)', autres: 'rgb(3, 3, 3)', halo: 'rgba(0, 0, 0, 0.75)' };
const URL = 'http://x/api/tiles/zones-risque/{z}/{x}/{y}?profil=h1';

function poser(visible = true) {
  const f = new CarteFactice();
  const carte = f as unknown as maplibregl.Map;
  poserCouchesZones(carte, { url: URL, teintes: TEINTES, profil: PROFIL_DEFAUT, visible });
  const couche = (id: string) => f.getLayer(id) as Record<string, unknown> & {
    minzoom?: number; paint: Record<string, unknown>; layout: Record<string, unknown>;
  };
  return { f, carte, couche };
}

/** Toutes les chaînes d'une valeur imbriquée (expressions MapLibre). */
function chaines(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(chaines);
  if (v && typeof v === 'object') return Object.values(v).flatMap(chaines);
  return [];
}

describe('couches-zones', () => {
  it('pose UNE source vectorielle (plancher 4, max 14) et quatre couches, dans cet ordre', () => {
    const { f } = poser();
    expect(f.sources.get(SOURCE_ZONES)!.spec).toEqual({ type: 'vector', tiles: [URL], minzoom: 4, maxzoom: 14 });
    expect(f.couches.map((c) => c.couche['id'])).toEqual([...COUCHES_ZONES]);
    expect(f.couches.every((c) => c.couche['source'] === SOURCE_ZONES && c.couche['source-layer'] === 'zones_risque')).toBe(true);
  });

  it('minzoom sur les COUCHES : fond et PPRT à 7 (lisible), contour et étiquettes à 10 (détail)', () => {
    const { couche } = poser();
    expect([ID_FOND, ID_PPRT, ID_CONTOUR, ID_ETIQUETTES].map((id) => couche(id).minzoom)).toEqual([7, 7, 10, 10]);
  });

  it('opacité du fond selon le zoom = expressionOpaciteSelonZoom(10) : aplat fondu, puis bandes', () => {
    const { couche } = poser();
    expect(couche(ID_FOND).paint['fill-opacity']).toEqual(expressionOpaciteSelonZoom(10));
    expect(couche(ID_FOND).paint['fill-opacity']).toEqual(['step', ['zoom'], 0.32, 10, expect.any(Array)]);
  });

  it('contour tireté filtré sur les bandes ; PPRT plein filtré sur `bande` nulle', () => {
    const { couche } = poser();
    expect(couche(ID_CONTOUR)['filter']).toEqual(['!=', ['get', 'bande'], null]);
    expect(couche(ID_CONTOUR).paint['line-dasharray']).toEqual([2, 2]);
    expect(couche(ID_PPRT)['filter']).toEqual(['==', ['get', 'bande'], null]);
    expect(couche(ID_PPRT).paint['line-dasharray']).toBeUndefined();
    expect(couche(ID_PPRT).paint['line-width']).toBe(1.5);
  });

  it('aucune chaîne `var(` dans paint ni layout : MapLibre lèverait', () => {
    const { f } = poser();
    const toutes = f.couches.flatMap((c) => chaines([c.couche['paint'], c.couche['layout']]));
    expect(toutes.some((x) => x.startsWith('var('))).toBe(false);
    expect(toutes).toContain('rgb(1, 1, 1)');
  });

  it('étiquettes : un libellé par classe, composé depuis le PROFIL (PPRT, 1 km, 2 km, 5 km, 500 m…)', () => {
    expect(expressionEtiquetteClasse(PROFIL_DEFAUT)).toEqual([
      'match', ['get', 'classe'],
      'haut:pprt', 'PPRT', 'haut:1', '1 km', 'haut:2', '2 km', 'haut:3', '5 km',
      'bas:pprt', 'PPRT', 'bas:1', '500 m', 'bas:2', '1 km',
      'autres:pprt', 'PPRT',
      '',
    ]);
    expect(poser().couche(ID_ETIQUETTES).layout['symbol-placement']).toBe('line');
  });

  it('visibilité à la création : `visible=false` → les quatre couches en `none`', () => {
    const { f } = poser(false);
    expect(f.couches.map((c) => (c.couche['layout'] as Record<string, unknown>)['visibility'])).toEqual(['none', 'none', 'none', 'none']);
  });

  it('reposer retire les couches AVANT la source, puis recrée (removeSource lèverait sinon)', () => {
    const { f, carte } = poser();
    poserCouchesZones(carte, { url: `${URL}2`, teintes: TEINTES, profil: PROFIL_DEFAUT, visible: true });
    expect(f.retraits).toEqual([...COUCHES_ZONES.map((id) => `couche:${id}`), `source:${SOURCE_ZONES}`]);
    expect((f.sources.get(SOURCE_ZONES)!.spec as { tiles: string[] }).tiles).toEqual([`${URL}2`]);
    expect(f.couches).toHaveLength(4);
  });

  it('retirer sur une carte nue ne lève pas', () => {
    const f = new CarteFactice();
    expect(() => retirerCouchesZones(f as unknown as maplibregl.Map)).not.toThrow();
    expect(f.retraits).toEqual([]);
  });

  it('repeindre : setPaintProperty sur les quatre couches, sans aucune source ni couche ajoutée', () => {
    const { f, carte } = poser();
    const sources = f.sources.size;
    const nbCouches = f.couches.length;
    const clair: TeintesZones = { haut: 'rgb(9, 9, 9)', bas: 'rgb(8, 8, 8)', autres: 'rgb(7, 7, 7)', halo: 'rgba(255, 255, 255, 0.85)' };
    repeindreCouchesZones(carte, clair);
    expect(f.peintures.map((p) => `${p.couche}/${p.propriete}`)).toEqual([
      `${ID_FOND}/fill-color`, `${ID_CONTOUR}/line-color`, `${ID_PPRT}/line-color`,
      `${ID_ETIQUETTES}/text-color`, `${ID_ETIQUETTES}/text-halo-color`,
    ]);
    expect(chaines(f.peintures[0].valeur)).toContain('rgb(9, 9, 9)');
    expect(f.peintures[4].valeur).toBe('rgba(255, 255, 255, 0.85)');
    expect([f.sources.size, f.couches.length]).toEqual([sources, nbCouches]);
  });

  it('repeindre ou basculer avant la pose ne lève pas et ne fait rien', () => {
    const f = new CarteFactice();
    repeindreCouchesZones(f as unknown as maplibregl.Map, TEINTES);
    basculerCouchesZones(f as unknown as maplibregl.Map, false);
    expect([f.peintures.length, f.dispositions.length]).toEqual([0, 0]);
  });

  it('basculer : setLayoutProperty(visibility) sur les quatre couches, rien d’autre', () => {
    const { f, carte } = poser();
    basculerCouchesZones(carte, false);
    expect(f.dispositions).toEqual(COUCHES_ZONES.map((couche) => ({ couche, propriete: 'visibility', valeur: 'none' })));
    expect(f.retraits).toEqual([]);
  });
});

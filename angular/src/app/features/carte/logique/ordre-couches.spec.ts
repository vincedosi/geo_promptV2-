import type maplibregl from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { poserApercuRayon } from '../couches/apercu-rayon';
import { poserCouchesIris, type PeintureIris } from '../couches/couche-iris';
import { poserCouchesPprt, poserCouchesRisques, type TeintesRisques } from '../couches/couche-risques';
import { poserZoneCustom } from '../couches/couche-zones-custom';

/**
 * Revue finale du lot 4, I-1 : les couches que React pose APRÈS le `load` (sites ICPE, PPRT, zones enregistrées,
 * aperçu du rayon…) restent AU-DESSUS des couches du `load` (IRIS, carreaux, POI), quel que soit l'ordre des gestes.
 * Ces scénarios passent par les VRAIES fonctions de pose, sur la carte factice qui rejoue les `beforeId`.
 */
const TEINTES_RISQUES = {
  toxique: '#111', inflammable: '#222', pollution: '#333', autres: '#444', non_precise: '#555', contour: '#fff',
} as unknown as TeintesRisques;
const PEINTURE_IRIS: PeintureIris = {
  couleur: '#123', opacite: 0.45, traitOpacite: 0.5, hauteur: 0, trait: '#456', filtre: null, visible: true, relief: false,
};
const ZONE: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: {} };
const CERCLE: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: {} };

function carte(): CarteFactice {
  const c = new CarteFactice();
  c.styleCharge = true;
  return c;
}
const comme = (c: CarteFactice) => c as unknown as maplibregl.Map;
const RISQUES = ['risques-zone', 'risques-zone-contour', 'risques-halo', 'risques-point'];
const IRIS = ['iris-fill', 'iris-border', 'iris-extrusion'];

describe('ordre des couches posées après le load (revue finale I-1)', () => {
  it('ICPE puis IRIS : les points ICPE restent AU-DESSUS de l’IRIS', () => {
    const c = carte();
    poserCouchesRisques(comme(c), TEINTES_RISQUES);
    poserCouchesIris(comme(c), '/tuiles/{z}/{x}/{y}', PEINTURE_IRIS);
    expect(c.ordreRendu()).toEqual([...IRIS, ...RISQUES]);
  });

  it('IRIS puis ICPE : même empilement', () => {
    const c = carte();
    poserCouchesIris(comme(c), '/tuiles/{z}/{x}/{y}', PEINTURE_IRIS);
    poserCouchesRisques(comme(c), TEINTES_RISQUES);
    expect(c.ordreRendu()).toEqual([...IRIS, ...RISQUES]);
  });

  it('PPRT posés avant les sites ICPE : les sites passent dessous, à leur rang de montage (page.tsx)', () => {
    const c = carte();
    poserCouchesPprt(comme(c), { fond: '#000', contour: '#fff' });
    poserCouchesRisques(comme(c), TEINTES_RISQUES);
    expect(c.ordreRendu()).toEqual([...RISQUES, 'pprt-fond', 'pprt-contour']);
  });

  it('zone enregistrée puis IRIS puis ICPE : la zone reste au sommet, l’IRIS au fond', () => {
    const c = carte();
    poserZoneCustom(comme(c), 'a', ZONE, '#4ecdc4');
    poserCouchesIris(comme(c), '/tuiles/{z}/{x}/{y}', PEINTURE_IRIS);
    poserCouchesRisques(comme(c), TEINTES_RISQUES);
    expect(c.ordreRendu()).toEqual([...IRIS, ...RISQUES, 'custom-zone-fill-a', 'custom-zone-line-a']);
  });

  it('deux zones enregistrées : la seconde au-dessus de la première, comme au clic chez React ; l’aperçu du rayon au-dessus', () => {
    const c = carte();
    poserApercuRayon(comme(c), CERCLE, '#4ecdc4');
    poserZoneCustom(comme(c), 'a', ZONE, '#111');
    poserZoneCustom(comme(c), 'b', ZONE, '#222');
    expect(c.ordreRendu()).toEqual([
      'custom-zone-fill-a', 'custom-zone-line-a', 'custom-zone-fill-b', 'custom-zone-line-b',
      'apercu-rayon-fill', 'apercu-rayon-line',
    ]);
  });
});

import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import {
  COUCHE_CAMPAGNE_OOH_A_VERIFIER, COUCHE_CAMPAGNE_OOH_POINTS, IMAGE_ANNEAU_A_VERIFIER, SOURCE_CAMPAGNE_OOH, couleurEnRgba,
  ecouterCampagneOoh, expressionCouleurLigne, imageAnneauPointille, poserCoucheCampagneOoh, retirerCoucheCampagneOoh,
} from './couche-campagne-ooh';

const TEINTES = ['#e8a33d', '#4f9fe0', '#d9667f', '#5cc08a', '#e0d05a', '#5d7fc4', '#e58a6b', '#8bb84a'];
const PEINTURE = { lignes: TEINTES, contour: '#ffffff', anneau: '#1a1a1a' };
const donnees = (n: number): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [2 + i, 48] },
    properties: { id: `p${i}`, ligne: 'l1', rang: 1, qualite: i === 0 ? 'a_verifier' : 'sure' },
  })),
});

function carte(): { factice: CarteFactice; carte: maplibregl.Map } {
  const factice = new CarteFactice();
  factice.styleCharge = true;
  return { factice, carte: factice as unknown as maplibregl.Map };
}

/** Les couleurs opaques (« r,g,b ») présentes dans une image RGBA, triées. */
function couleursPresentes(data: Uint8Array): string[] {
  const vues = new Set<string>();
  for (let k = 0; k < data.length; k += 4) if (data[k + 3] > 0) vues.add(`${data[k]},${data[k + 1]},${data[k + 2]}`);
  return [...vues].sort();
}

describe('couche d une campagne OOH (pure)', () => {
  it('pose une source, l image de l anneau et deux couches : cercles colorés par ligne, anneau des points à vérifier', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(2), PEINTURE);
    expect((factice.sources.get(SOURCE_CAMPAGNE_OOH)!.spec as { data: GeoJSON.FeatureCollection }).data.features).toHaveLength(2);
    expect(factice.images.has(IMAGE_ANNEAU_A_VERIFIER)).toBe(true);
    const points = factice.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)!;
    expect(points['type']).toBe('circle');
    expect(points['paint']).toEqual({
      'circle-color': expressionCouleurLigne(TEINTES), 'circle-radius': 6, 'circle-opacity': 0.92,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['case', ['==', ['get', 'qualite'], 'a_verifier'], 0, 1.5],
    });
    const anneau = factice.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)!;
    expect(anneau['type']).toBe('symbol');
    expect(anneau['filter']).toEqual(['==', ['get', 'qualite'], 'a_verifier']);
    expect((anneau['layout'] as Record<string, unknown>)['icon-image']).toBe(IMAGE_ANNEAU_A_VERIFIER);
  });

  it('l expression de couleur suit le rang de la ligne, huit teintes, la première par défaut', () => {
    expect(expressionCouleurLigne(TEINTES)).toEqual(['match', ['get', 'rang'], 1, TEINTES[0], 2, TEINTES[1], 3, TEINTES[2], 4, TEINTES[3], 5, TEINTES[4], 6, TEINTES[5], 7, TEINTES[6], 8, TEINTES[7], TEINTES[0]]);
  });

  it('reposer : setData et repeinture, jamais une couche en double', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(2), PEINTURE);
    poserCoucheCampagneOoh(c, donnees(1), { lignes: ['#b9770f', ...TEINTES.slice(1)], contour: '#ffffff', anneau: '#202020' });
    expect(factice.couches).toHaveLength(2);
    // L'image existante est repeinte, pas ajoutée une seconde fois (MapLibre lève sur un `addImage` en double).
    expect(factice.imagesRepeintes).toEqual([IMAGE_ANNEAU_A_VERIFIER]);
    const repeinte = factice.images.get(IMAGE_ANNEAU_A_VERIFIER) as { data: Uint8Array };
    expect(couleursPresentes(repeinte.data)).toContain('32,32,32');
    expect(factice.sources.get(SOURCE_CAMPAGNE_OOH)!.donnees).toEqual([donnees(1)]);
    expect(factice.peintures).toContainEqual({ couche: COUCHE_CAMPAGNE_OOH_POINTS, propriete: 'circle-color', valeur: expressionCouleurLigne(['#b9770f', ...TEINTES.slice(1)]) });
  });

  it('au-dessus des zones enregistrées, sous l aperçu du rayon (ordre des couches)', () => {
    const { factice, carte: c } = carte();
    factice.addLayer({ id: 'custom-zone-fill-z1', type: 'fill', source: 'x' });
    factice.addLayer({ id: 'apercu-rayon-fill', type: 'fill', source: 'y' });
    poserCoucheCampagneOoh(c, donnees(1), PEINTURE);
    expect(factice.ordreRendu()).toEqual(['custom-zone-fill-z1', COUCHE_CAMPAGNE_OOH_POINTS, COUCHE_CAMPAGNE_OOH_A_VERIFIER, 'apercu-rayon-fill']);
  });

  it('retirer : les deux couches, puis la source, puis l image', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(1), PEINTURE);
    retirerCoucheCampagneOoh(c);
    expect(factice.retraits).toEqual([
      `couche:${COUCHE_CAMPAGNE_OOH_A_VERIFIER}`, `couche:${COUCHE_CAMPAGNE_OOH_POINTS}`, `source:${SOURCE_CAMPAGNE_OOH}`, `image:${IMAGE_ANNEAU_A_VERIFIER}`,
    ]);
    retirerCoucheCampagneOoh(c);
    expect(factice.retraits).toHaveLength(4);
  });

  it('l anneau pointillé BICOLORE : transparent au centre, segments alternés des deux couleurs, sans trou', () => {
    const img = imageAnneauPointille('#ffffff', '#1a1a1a');
    expect(img.width).toBe(22);
    expect(img.data).toHaveLength(22 * 22 * 4);
    const pixel = (x: number, y: number) => [...img.data.slice((y * 22 + x) * 4, (y * 22 + x) * 4 + 4)].join(',');
    expect(pixel(11, 11)).toBe('0,0,0,0');
    let clairs = 0;
    let sombres = 0;
    for (let a = 0; a < 360; a += 5) {
      const x = Math.floor(11 + 9 * Math.cos((a * Math.PI) / 180));
      const y = Math.floor(11 + 9 * Math.sin((a * Math.PI) / 180));
      if (pixel(x, y) === '255,255,255,255') clairs++;
      if (pixel(x, y) === '26,26,26,255') sombres++;
    }
    // Les deux couleurs sont sur le cercle, en proportions voisines : l'anneau se voit sur fond clair ET sombre.
    expect(clairs).toBeGreaterThan(10);
    expect(sombres).toBeGreaterThan(10);
    expect(couleursPresentes(img.data)).toEqual(['255,255,255', '26,26,26']);
  });

  it('couleurEnRgba : hexadécimal court ou long, rgb(), rgba() ; une couleur illisible lève', () => {
    expect(couleurEnRgba('#fff')).toEqual([255, 255, 255, 1]);
    expect(couleurEnRgba('#4ecdc4')).toEqual([78, 205, 196, 1]);
    expect(couleurEnRgba('rgba(26, 26, 26, 0.85)')).toEqual([26, 26, 26, 0.85]);
    expect(couleurEnRgba('rgb(1,2,3)')).toEqual([1, 2, 3, 1]);
    expect(() => couleurEnRgba('teal')).toThrow('Couleur illisible');
  });

  it('écoute : un clic sur un point rend son identifiant ; le survol change le curseur ; tout se retire', () => {
    const { factice, carte: c } = carte();
    const clics: string[] = [];
    const retirer = ecouterCampagneOoh(c, (id) => clics.push(id));
    factice.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p3' } }] });
    factice.emettreSurCouche('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, {});
    expect(clics).toEqual(['p3']);
    expect(factice.getCanvas().style.cursor).toBe('pointer');
    factice.emettreSurCouche('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, {});
    expect(factice.getCanvas().style.cursor).toBe('');
    retirer();
    factice.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p4' } }] });
    expect(clics).toEqual(['p3']);
  });
});

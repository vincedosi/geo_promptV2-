import { formaterNombre } from '../../../../core/format/nombre';
import { lireForme } from './import-forme';

const CARRE = [[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]];
const TROU = [[5.02, 43.02], [5.04, 43.02], [5.04, 43.04], [5.02, 43.02]];

describe('lireForme — GeoJSON', () => {
  it('FeatureCollection mêlant polygones et points : polygones gardés, points comptés comme ignorés', () => {
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [CARRE, TROU] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: {} },
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[CARRE]] }, properties: {} },
    ] };
    const r = lireForme(JSON.stringify(fc), 'zones.geojson');
    expect(r).toEqual({ ok: true, format: 'geojson', polygones: 2, ignores: 1, sommets: 14,
      geometrie: { type: 'MultiPolygon', coordinates: [[CARRE, TROU], [CARRE]] } });
  });
  it('un Polygon nu, un Feature nu', () => {
    expect(lireForme(JSON.stringify({ type: 'Polygon', coordinates: [CARRE] }), 'a.json')).toMatchObject({ ok: true, polygones: 1 });
    expect(lireForme(JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [CARRE] } }), 'a.json')).toMatchObject({ ok: true, polygones: 1 });
  });
  it.each([
    ['JSON illisible', '{pas du json', 'Fichier illisible : ni GeoJSON ni KML.'],
    ['aucun polygone', JSON.stringify({ type: 'Point', coordinates: [5, 43] }), 'Aucun polygone dans ce fichier.'],
    ['fichier vide', '   ', 'Fichier vide.'],
  ])('%s', (_n, texte, message) => {
    expect(lireForme(texte, 'a.geojson')).toEqual({ ok: false, message });
  });
  it('plus de 20 000 sommets : refusé avec le compte', () => {
    const anneau = Array.from({ length: 20_001 }, (_, i) => [5 + i * 1e-6, 43]);
    const r = lireForme(JSON.stringify({ type: 'Polygon', coordinates: [anneau] }), 'a.geojson');
    // formaterNombre (core/format/nombre.ts, toLocaleString fr-FR) : le séparateur est celui du navigateur, pas une espace écrite ici
    expect(r).toEqual({ ok: false, message: `La forme compte ${formaterNombre(20_001)} sommets, au-delà de ${formaterNombre(20_000)} : simplifiez-la avant de l’importer.` });
  });
  it('coordonnées manifestement inversées (lat, lon) : dit, pas corrigé en silence', () => {
    const inverse = CARRE.map(([x, y]) => [y, x]);
    const r = lireForme(JSON.stringify({ type: 'Polygon', coordinates: [inverse] }), 'a.geojson');
    expect(r).toEqual({ ok: false, message: 'Coordonnées hors des bornes longitude/latitude : le fichier inverse-t-il latitude et longitude ?' });
  });
  it('Mayotte (lon 45, lat −12,8) n’est jamais prise pour une forme inversée', () => {
    const mayotte = [[45.1, -12.8], [45.2, -12.8], [45.2, -12.7], [45.1, -12.8]];
    expect(lireForme(JSON.stringify({ type: 'Polygon', coordinates: [mayotte] }), 'a.geojson')).toMatchObject({ ok: true, polygones: 1 });
  });
});

describe('lireForme — KML', () => {
  it('Polygon avec trou, altitude ignorée, MultiGeometry', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><MultiGeometry>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>5,43,0 5.1,43,0 5.1,43.1,0 5,43.1,0 5,43,0</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>5.02,43.02 5.04,43.02 5.04,43.04 5.02,43.02</coordinates></LinearRing></innerBoundaryIs></Polygon>
        <Point><coordinates>5,43</coordinates></Point>
      </MultiGeometry></Placemark></Document></kml>`;
    expect(lireForme(kml, 'zones.kml')).toEqual({ ok: true, format: 'kml', polygones: 1, ignores: 1, sommets: 9,
      geometrie: { type: 'MultiPolygon', coordinates: [[CARRE, TROU]] } });
  });
  it('KML à préfixe (`kml:Polygon`) : lu comme sans préfixe', () => {
    const kml = `<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Placemark><kml:Polygon><kml:outerBoundaryIs><kml:LinearRing>
      <kml:coordinates>5,43 5.1,43 5.1,43.1 5,43.1 5,43</kml:coordinates></kml:LinearRing></kml:outerBoundaryIs></kml:Polygon></kml:Placemark></kml:kml>`;
    expect(lireForme(kml, 'a.kml')).toMatchObject({ ok: true, polygones: 1, sommets: 5 });
  });
  it('KML déclaré ISO-8859-1, lu par file.text() en UTF-8 : les noms abîmés (�) ne gênent pas les coordonnées', () => {
    const kml = `<?xml version="1.0" encoding="ISO-8859-1"?><kml><Placemark><name>Zone march�</name><Polygon><outerBoundaryIs><LinearRing>
      <coordinates>5,43 5.1,43 5.1,43.1 5,43.1 5,43</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    expect(lireForme(kml, 'a.kml')).toMatchObject({ ok: true, polygones: 1, sommets: 5 });
  });
  it('KML aux virgules ESPACÉES (« 5, 43 ») : chaque tuple reste un point, pas deux demi-points perdus', () => {
    const kml = `<kml><Placemark><Polygon><outerBoundaryIs><LinearRing>
      <coordinates>5, 43, 0  5.1 ,43   5.1 , 43.1 5,43.1 5,  43</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    expect(lireForme(kml, 'a.kml')).toMatchObject({ ok: true, polygones: 1, sommets: 5, geometrie: { type: 'MultiPolygon', coordinates: [[CARRE]] } });
  });
  it('KML sans polygone', () => {
    expect(lireForme('<kml><Placemark><Point><coordinates>5,43</coordinates></Point></Placemark></kml>', 'a.kml'))
      .toEqual({ ok: false, message: 'Aucun polygone dans ce fichier.' });
  });
});

import {
  SEUIL_FERMETURE_PX, type EtatTrace, apercuTrace, cliquer, doubleCliquer, messageAideDessin, nombreSommets, retirerDernier,
  traceVide,
} from './dessin';

/** Projection identité : la position EST le pixel — les seuils se lisent directement. */
const ident = (p: readonly [number, number]) => ({ x: p[0], y: p[1] });
const clic = (e: EtatTrace, x: number, y: number) => cliquer(e, [x, y], { x, y }, ident);

function polygoneDe(points: [number, number][]): EtatTrace {
  return points.reduce((e, [x, y]) => clic(e, x, y), traceVide('polygone'));
}

describe('dessin — logique pure du tracé maison (B8, sans terra-draw)', () => {
  it('3 clics + double-clic sur le dernier sommet → polygone FERMÉ de 4 positions (le double-clic n’ajoute rien)', () => {
    let e = polygoneDe([[0, 0], [100, 0], [100, 100]]);
    // Un double-clic émet d'abord deux `click` au même point, puis `dblclick`.
    e = clic(e, 100, 100);
    e = clic(e, 100, 100);
    e = doubleCliquer(e);
    expect(e.ferme).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 100], [0, 0]]] });
    expect(nombreSommets(e)).toBe(3);
  });

  it('double-clic AILLEURS : son premier clic pose le dernier sommet, puis ferme (5 positions)', () => {
    let e = polygoneDe([[0, 0], [100, 0], [100, 100]]);
    e = clic(e, 0, 100);
    e = clic(e, 0, 100);
    e = doubleCliquer(e);
    expect(e.ferme!.coordinates[0]).toHaveLength(5);
  });

  it(`clic à moins de ${SEUIL_FERMETURE_PX} px du premier sommet (3 sommets posés) → ferme ; plus loin → ajoute`, () => {
    const pres = clic(polygoneDe([[0, 0], [100, 0], [100, 100]]), 5, 5);
    expect(pres.ferme!.coordinates[0]).toEqual([[0, 0], [100, 0], [100, 100], [0, 0]]);
    const loin = clic(polygoneDe([[0, 0], [100, 0], [100, 100]]), 8, 0);
    expect(loin.ferme).toBeNull();
    expect(loin.sommets).toHaveLength(4);
  });

  it('près du premier sommet avec DEUX sommets seulement : pas de fermeture (aucune surface)', () => {
    const e = clic(polygoneDe([[0, 0], [100, 0]]), 2, 2);
    expect(e.ferme).toBeNull();
  });

  it('double-clic avec moins de trois sommets : rien ne se ferme', () => {
    expect(doubleCliquer(polygoneDe([[0, 0], [100, 0]])).ferme).toBeNull();
  });

  it('Backspace retire le dernier sommet du tracé EN COURS ; sans effet sur un tracé fermé ou vide', () => {
    const e = retirerDernier(polygoneDe([[0, 0], [100, 0], [100, 100]]));
    expect(e.sommets).toEqual([[0, 0], [100, 0]]);
    expect(retirerDernier(traceVide('polygone'))).toEqual(traceVide('polygone'));
    const ferme = doubleCliquer(polygoneDe([[0, 0], [100, 0], [100, 100]]));
    expect(retirerDernier(ferme)).toBe(ferme);
  });

  it('rectangle : deux clics aux coins opposés → 5 positions, anneau fermé', () => {
    let e = traceVide('rectangle');
    e = clic(e, 0, 0);
    expect(e.ferme).toBeNull();
    e = clic(e, 100, 50);
    expect(e.ferme).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]] });
  });

  it('rectangle : un second clic au même point ne ferme rien (rectangle sans surface)', () => {
    const e = clic(clic(traceVide('rectangle'), 0, 0), 3, 3);
    expect(e.ferme).toBeNull();
    expect(e.sommets).toEqual([[0, 0]]);
  });

  it('un clic après un tracé fermé en commence un NOUVEAU (une zone = une géométrie)', () => {
    const ferme = doubleCliquer(polygoneDe([[0, 0], [100, 0], [100, 100]]));
    const e = clic(ferme, 500, 500);
    expect(e.ferme).toBeNull();
    expect(e.sommets).toEqual([[500, 500]]);
  });

  it('aperçu : ligne élastique jusqu’au curseur et points des sommets ; polygone rempli une fois fermé', () => {
    const enCours = polygoneDe([[0, 0], [100, 0]]);
    const a = apercuTrace(enCours, [50, 50]);
    expect(a.features.map((f) => f.geometry.type)).toEqual(['LineString', 'Point', 'Point']);
    expect((a.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([[0, 0], [100, 0], [50, 50]]);
    const ferme = doubleCliquer(polygoneDe([[0, 0], [100, 0], [100, 100]]));
    expect(apercuTrace(ferme, null).features.map((f) => f.geometry.type)).toEqual(['Polygon']);
    const rect = apercuTrace(clic(traceVide('rectangle'), 0, 0), [10, 20]);
    expect((rect.features[0].geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5);
  });

  it('message d’aide : le compte des sommets, sinon le geste du mode (textes de React)', () => {
    expect(messageAideDessin('polygone', 0)).toBe('Cliquez pour poser les sommets, double-clic pour fermer');
    expect(messageAideDessin('rectangle', 0)).toBe('Cliquez deux coins opposés pour tracer un rectangle');
    expect(messageAideDessin('polygone', 1)).toBe('1 sommet tracé');
    expect(messageAideDessin('polygone', 4)).toBe('4 sommets tracés');
  });
});

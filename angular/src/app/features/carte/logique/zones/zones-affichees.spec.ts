import { PALETTE_ZONES } from '../palettes-donnees-carte';
import { bboxDeGeometrie, bboxDeZone, couleurZone, dateZone, idsZone, messageHttp, typesDeSource } from './zones-affichees';

describe('zones-affichees (ZonesOverlay.tsx:57-85)', () => {
  it('identifiants MapLibre de React', () => {
    expect(idsZone('x')).toEqual({ source: 'custom-zone-x', aplat: 'custom-zone-fill-x', contour: 'custom-zone-line-x' });
  });

  it('teinte en cycle sur le nombre de zones déjà affichées', () => {
    expect(couleurZone(0)).toBe(PALETTE_ZONES[0]);
    expect(couleurZone(5)).toBe(PALETTE_ZONES[0]);
    expect(couleurZone(6)).toBe(PALETTE_ZONES[1]);
  });

  it('emprise : parcours récursif, null sans coordonnée ; la bbox de la liste prime', () => {
    expect(bboxDeGeometrie({ type: 'MultiPolygon', coordinates: [[[[1, 5], [3, 2]]], [[[-1, 4], [0, 9]]]] })).toEqual([-1, 2, 3, 9]);
    expect(bboxDeGeometrie({ type: 'GeometryCollection', geometries: [] })).toBeNull();
    expect(bboxDeGeometrie(null)).toBeNull();
    expect(bboxDeZone([1, 2, 3, 4], { type: 'Point', coordinates: [9, 9] })).toEqual([1, 2, 3, 4]);
    expect(bboxDeZone([1, 2], { type: 'Point', coordinates: [9, 9] })).toEqual([9, 9, 9, 9]);
  });

  it('date « 03 sept. 2026 », types de source triés uniques, message HTTP', () => {
    expect(dateZone('2026-09-03T10:00:00Z')).toBe('03 sept. 2026');
    expect(typesDeSource([{ source_type: 'b' }, { source_type: 'a' }, { source_type: 'b' }])).toEqual(['a', 'b']);
    expect(messageHttp({ status: 404 }, 'r')).toBe('HTTP 404');
    expect(messageHttp(new Error('réseau'), 'r')).toBe('réseau');
    expect(messageHttp({ status: 0 }, 'repli')).toBe('repli');
  });
});

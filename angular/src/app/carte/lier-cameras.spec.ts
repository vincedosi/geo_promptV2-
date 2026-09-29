import { lierCameras } from './lier-cameras';
import { CarteFactice } from './testing/carte-factice';

describe('lierCameras', () => {
  it('aligne la seconde sur la première dès la liaison', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    a.zoom = 11;
    lierCameras(a as never, b as never);
    expect(b.zoom).toBe(11);
  });

  it('déplacer l\'une déplace l\'autre UNE fois, sans boucle', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    lierCameras(a as never, b as never);
    a.sauts.length = 0;
    b.sauts.length = 0;
    a.zoom = 12;
    a.emettre('move');
    expect(b.sauts.length).toBe(1);
    expect(a.sauts.length).toBe(0);
  });

  it('délier débranche les deux écoutes', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    const delier = lierCameras(a as never, b as never);
    delier();
    expect(a.nombreEcouteurs('move')).toBe(0);
    expect(b.nombreEcouteurs('move')).toBe(0);
  });
});

import { TestBed } from '@angular/core/testing';
import { RecetteImportComponent, TAILLE_MAX_IMPORT_OCTETS } from './recette-import.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));
const CARRE = [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]];
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: CARRE } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: CARRE } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] } },
  ],
});

function monter() {
  const f = TestBed.createComponent(RecetteImportComponent);
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { for (let i = 0; i < 3; i++) { await attendre(); await f.whenStable(); } };
  return { f, el, c: f.componentInstance, stable };
}

function deposer(el: HTMLElement, fichier: File) {
  const entree = el.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(entree, 'files', { value: [fichier], configurable: true });
  entree.dispatchEvent(new Event('change'));
}

describe('RecetteImportComponent (lot 3, T10)', () => {
  it('n’accepte que GeoJSON / KML ; sans fichier, aucune recette', async () => {
    const { el, c, stable } = monter();
    await stable();
    expect(el.querySelector('input[type=file]')!.getAttribute('accept')).toBe('.geojson,.json,.kml');
    expect(c.recette()).toBeNull();
  });

  it('GeoJSON déposé → « 2 polygones · 1 élément ignoré », recette import et géométrie', async () => {
    const { el, c, stable } = monter();
    await stable();
    deposer(el, new File([GEOJSON], 'zones.geojson'));
    await stable();
    expect(el.querySelector('[data-resume]')!.textContent!.trim()).toBe('2 polygones · 1 élément ignoré');
    expect(c.recette()).toEqual({ v: 1, type: 'import', format: 'geojson', fichier: 'zones.geojson' });
    expect(c.geometrie()).toEqual({ type: 'MultiPolygon', coordinates: [CARRE, CARRE] });
  });

  it('fichier refusé par lireForme → son message, aucune recette', async () => {
    const { el, c, stable } = monter();
    await stable();
    deposer(el, new File(['{"type":"Point","coordinates":[5,43]}'], 'point.geojson'));
    await stable();
    expect(el.querySelector('[data-refus]')!.textContent!.trim()).toBe('Aucun polygone dans ce fichier.');
    expect(c.recette()).toBeNull();
  });

  it('plus de 5 Mo → « Fichier trop volumineux (5 Mo au plus). » SANS lecture (revue T9 : un parse de 100 Mo fige l’onglet)', async () => {
    const { el, c, stable } = monter();
    await stable();
    const lourd = new File(['x'], 'enorme.geojson');
    Object.defineProperty(lourd, 'size', { value: TAILLE_MAX_IMPORT_OCTETS + 1 });
    const lire = vi.spyOn(lourd, 'text');
    deposer(el, lourd);
    await stable();
    expect(lire).not.toHaveBeenCalled();
    expect(el.querySelector('[data-refus]')!.textContent!.trim()).toBe('Fichier trop volumineux (5 Mo au plus).');
    expect(c.recette()).toBeNull();
  });
});

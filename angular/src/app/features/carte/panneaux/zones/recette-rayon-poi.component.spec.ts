import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { RecetteRayonPoiComponent } from './recette-rayon-poi.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));
const BDR = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };

function monter(filtre: unknown) {
  const chargerUneFois = vi.fn();
  const types = signal([{ id: 'lycee', label: 'Lycées', origine: 'commune' }, { id: 'bmw', label: 'Concessions', origine: 'espace' }]);
  TestBed.configureTestingModule({ providers: [
    { provide: EtatCarteService, useValue: { filtre: signal(filtre) } },
    { provide: CataloguePoiService, useValue: { types, chargerUneFois, chargement: signal(false), erreur: signal(null) } },
  ] });
  const f = TestBed.createComponent(RecetteRayonPoiComponent);
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, chargerUneFois, types };
}

describe('RecetteRayonPoiComponent (lot 3, T10)', () => {
  it('les types viennent du catalogue de la page, lu UNE fois (aucune autre lecture)', async () => {
    const { f, el, chargerUneFois } = monter(BDR);
    f.detectChanges(); await attendre();
    expect(chargerUneFois).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll('select[data-categorie] option')].map((o) => o.textContent)).toEqual(['Lycées', 'Concessions']);
  });

  it('réglette de 100 m à 50 km par pas de 100 m, 5 km par défaut, affichée en JetBrains Mono', async () => {
    const { f, el } = monter(BDR);
    f.detectChanges(); await attendre();
    const r = el.querySelector<HTMLInputElement>('input[data-rayon]')!;
    expect([r.min, r.max, r.step, r.value]).toEqual(['100', '50000', '100', '5000']);
    const lib = el.querySelector('[data-rayon-libelle]')!;
    expect(lib.textContent!.trim()).toBe('5 km');
    expect(lib.classList).toContain('font-mono');
    r.value = '2500'; r.dispatchEvent(new Event('input'));
    f.detectChanges(); await attendre();
    expect(lib.textContent!.trim()).toBe('2,5 km');
  });

  it('recette { v: 1, type: rayon_poi, categorie, rayon_m: 5000, perimetre }', async () => {
    const { f, el, c } = monter(BDR);
    f.detectChanges(); await attendre();
    expect(c.recette()).toEqual({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } });
    const s = el.querySelector<HTMLSelectElement>('select[data-categorie]')!;
    s.value = 'bmw'; s.dispatchEvent(new Event('change'));
    expect(c.recette()).toMatchObject({ categorie: 'bmw' });
  });

  it('sans périmètre : aucune recette, la raison dite', async () => {
    const { f, el, c } = monter(null);
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toContain('étape ①');
  });

  it('catalogue vide : aucune recette, « Aucun type de POI disponible. »', async () => {
    const { f, el, c, types } = monter(BDR);
    types.set([]);
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toBe('Aucun type de POI disponible.');
  });
});

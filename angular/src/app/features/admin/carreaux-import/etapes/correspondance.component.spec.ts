import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { ImportGeoApi } from '../data/import-geo.api';
import { ImportShapefileService } from '../etat/import-shapefile.service';
import { fichiersEssai } from '../testing/shapefile.fixture';
import { texte } from '../testing/aides';
import { CorrespondanceComponent } from './correspondance.component';

describe('CorrespondanceComponent — étape 2 (`MappingStep.tsx`, lot 6, T14)', { timeout: 20_000 }, () => {
  async function monter() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportGeoApi, ImportShapefileService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const etat = TestBed.inject(ImportShapefileService);
    await etat.lire(fichiersEssai(50));
    const f = TestBed.createComponent(CorrespondanceComponent);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement, etat };
  }

  const lignes = (el: HTMLElement) => [...el.querySelectorAll('[data-ligne]')];

  it('réglages lus du bundle (200m, 2021, idcar_200m), libellés reliés, lignes de React, compte, aucune requête', async () => {
    const { el } = await monter();
    expect((el.querySelector('#shp-resolution') as HTMLSelectElement).value).toBe('200m');
    expect([...el.querySelectorAll('#shp-resolution option')].map((o) => texte(o))).toEqual(['200m × 200m', '1km × 1km']);
    expect((el.querySelector('#shp-millesime') as HTMLInputElement).value).toBe('2021');
    expect((el.querySelector('#shp-id') as HTMLSelectElement).value).toBe('idcar_200m');
    expect([...el.querySelectorAll('#shp-id option')].map((o) => texte(o))).toEqual(['— Auto-index —', 'idcar_200m', 'ind', 'men', 'lcog_geo']);
    expect([...el.querySelectorAll('label')].map((l) => [texte(l), l.getAttribute('for')])).toEqual([
      ['Résolution', 'shp-resolution'], ['Millésime', 'shp-millesime'], ['Colonne ID (idcar)', 'shp-id'],
    ]);
    expect(lignes(el).map((l) => [texte(l.querySelector('.source')), texte(l.querySelector('.genre')), texte(l.querySelector('.exemple'))]))
      .toEqual([
        ['idcar_200m', 'texte', 'ESSAI_LOT6_0001'], ['ind', 'numérique', '10'], ['men', 'numérique', '4'], ['lcog_geo', 'texte', '75056'],
      ]);
    // `&nbsp;·&nbsp;` de React, entouré de ses deux espaces.
    expect(el.querySelector('[data-compte]')!.textContent).toBe('4 / 4 colonnes sélectionnées  ·  50 features à insérer');
    TestBed.inject(HttpTestingController).verify();
  });

  it('décocher, renommer, « Tout exclure », « Tout inclure » : l’état suit, la ligne exclue s’éteint et son champ se ferme', async () => {
    const { f, el, etat } = await monter();
    const cases = () => [...el.querySelectorAll<HTMLInputElement>('[data-ligne] input[type="checkbox"]')];
    const cibles = () => [...el.querySelectorAll<HTMLInputElement>('[data-ligne] input.cible')];
    cases()[3].click();
    const champ = cibles()[1];
    champ.value = 'population';
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(etat.mappings()).toEqual([
      { source: 'idcar_200m', target: '' }, { source: 'ind', target: 'population' },
      { source: 'men', target: '' }, { source: 'lcog_geo', target: '__skip__' },
    ]);
    expect(lignes(el)[3].classList).toContain('exclue');
    expect(cibles()[3].disabled).toBe(true);
    expect(texte(el.querySelector('[data-compte]'))).toBe('3 / 4 colonnes sélectionnées · 50 features à insérer');
    const [inclure, exclure] = [...el.querySelectorAll<HTMLButtonElement>('.outil')];
    expect([texte(inclure), texte(exclure)]).toEqual(['Tout inclure', 'Tout exclure']);
    exclure.click();
    await f.whenStable();
    expect(etat.mappings().every((m) => m.target === '__skip__')).toBe(true);
    expect(texte(el.querySelector('[data-compte]'))).toBe('0 / 4 colonnes sélectionnées · 50 features à insérer');
    inclure.click();
    await f.whenStable();
    expect(etat.mappings().every((m) => m.target === '')).toBe(true);
  });

  it('réglages modifiables ; « Retour » mène à l’étape 1, « Lancer l’import » à l’étape 3 sans rien envoyer', async () => {
    const { f, el, etat } = await monter();
    const resolution = el.querySelector('#shp-resolution') as HTMLSelectElement;
    resolution.value = '1km';
    resolution.dispatchEvent(new Event('change'));
    const millesime = el.querySelector('#shp-millesime') as HTMLInputElement;
    millesime.value = '2019';
    millesime.dispatchEvent(new Event('input'));
    const id = el.querySelector('#shp-id') as HTMLSelectElement;
    id.value = '';
    id.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect([etat.resolution(), etat.millesime(), etat.idColumn()]).toEqual(['1km', '2019', '']);
    const [retour, lancer] = [...el.querySelectorAll<HTMLButtonElement>('.boutons button')];
    expect([texte(retour), texte(lancer)]).toEqual(['Retour', 'Lancer l\'import']);
    lancer.click();
    expect(etat.etape()).toBe(3);
    retour.click();
    expect(etat.etape()).toBe(1);
    TestBed.inject(HttpTestingController).verify();
  });
});

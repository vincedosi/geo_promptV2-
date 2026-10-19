import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ImportPoiService } from '../etat/import-poi.service';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { CorrespondanceComponent } from './correspondance.component';
import { texte } from '../../testing/dom';
import { fournisseursImportPoi } from '../testing/fournisseurs';

async function monter() {
  TestBed.configureTestingModule({ providers: fournisseursImportPoi() });
  const etat = TestBed.inject(ImportPoiService);
  const http = TestBed.inject(HttpTestingController);
  etat.analyser([new File(['x'], 'poi-essai.csv')]);
  http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
  const f = TestBed.createComponent(CorrespondanceComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, etat };
}

/** Les lignes « libellé → colonne choisie (exemple) » d'un bloc. */
const lignes = (racine: Element) => [...racine.querySelectorAll('[data-ligne]')].map((l) => [
  texte(l.querySelector('label')), (l.querySelector('select') as HTMLSelectElement).value, texte(l.querySelector('[data-exemple]')),
]);

describe('mg-import-correspondance — étape 03 « Mapping colonnes » (`MappingStep.tsx`, lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('en-tête « 8 colonnes detectees » ; six champs standards pré-remplis par la suggestion de la route, exemple de la colonne choisie', async () => {
    const { el } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('03');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Mapping colonnes');
    expect(texte(el.querySelector('[data-detectees]'))).toBe('8 colonnes detectees');
    expect(texte(el.querySelector('[data-note-standard]'))).toBe('// champs dentsu.explore → colonnes fichier');
    expect(lignes(el.querySelector('[data-standard]')!)).toEqual([
      ['Nom', 'nom', 'ex: [ESSAI lot 6] POI 01'],
      ['Adresse', 'adresse', 'ex: Place de l’Hôtel de Ville'],
      ['Ville', 'ville', 'ex: Paris'],
      ['Code postal', 'code_postal', 'ex: 75004'],
      ['Departement', '', ''],
      ['Region', '', ''],
    ]);
    const options = [...el.querySelectorAll<HTMLSelectElement>('[data-standard] [data-ligne] select')[0].options];
    expect(options.map((o) => texte(o))).toEqual(['— Non mappe —', ...ANALYSE_POI_ESSAI.columns.map((c) => c.name)]);
  });

  it('géolocalisation : trois modes aux textes de React, GPS coché ; Latitude / Longitude pré-remplies', async () => {
    const { el } = await monter();
    expect(texte(el.querySelector('[data-note-geo]'))).toBe('// geolocalisation');
    const modes = [...el.querySelectorAll('[data-mode]')];
    // Angular retire les blancs entre éléments : titre et description se comparent un à un.
    expect(modes.map((m) => [texte(m.querySelector('.titre-mode')), texte(m.querySelector('.desc-mode'))])).toEqual([
      ['GPS direct', 'Colonnes latitude / longitude deja presentes'],
      ['Geocodage adresse', 'Adresse → coordonnees via API BAN (gratuit)'],
      ['Lambert 93 (X, Y)', 'Coordonnees projetees EPSG:2154 → WGS84'],
    ]);
    expect(modes.map((m) => (m.querySelector('input[type="radio"]') as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(modes.map((m) => m.classList.contains('actif'))).toEqual([true, false, false]);
    expect(lignes(el.querySelector('[data-geo-champs]')!)).toEqual([
      ['Latitude', 'latitude', 'ex: 48.8566'],
      ['Longitude', 'longitude', 'ex: 2.3522'],
    ]);
  });

  it('choisir « Geocodage adresse » : trois sélecteurs vides (le mapping géo, pas le standard) et la note BAN ; Lambert : X / Y et la note proj4', async () => {
    const { f, el, etat } = await monter();
    (el.querySelectorAll('[data-mode] input[type="radio"]')[1] as HTMLInputElement).click();
    await f.whenStable();
    expect(etat.modeGeo()).toBe('address');
    expect(lignes(el.querySelector('[data-geo-champs]')!)).toEqual([['Adresse', '', ''], ['Code postal', '', ''], ['Ville', '', '']]);
    expect(texte(el.querySelector('[data-note-mode]'))).toBe('// geocodage via api-adresse.data.gouv.fr (BAN) — ~100ms/adresse');
    (el.querySelectorAll('[data-mode]')[2] as HTMLElement).click();
    await f.whenStable();
    expect(etat.modeGeo()).toBe('lambert93');
    expect(lignes(el.querySelector('[data-geo-champs]')!).map((l) => l[0])).toEqual(['X (Est)', 'Y (Nord)']);
    expect(texte(el.querySelector('[data-note-mode]'))).toBe('// EPSG:2154 → EPSG:4326 via proj4');
  });

  it('un clic sur un mode (libellé ou bouton radio) appelle le choix UNE seule fois — le `(change)` du radio suffit (vague finale E2)', async () => {
    const { f, el, etat } = await monter();
    const choix = vi.spyOn(etat, 'choisirModeGeo');
    (el.querySelectorAll('[data-mode]')[1] as HTMLElement).click();
    await f.whenStable();
    expect(choix).toHaveBeenCalledTimes(1);
    expect(etat.modeGeo()).toBe('address');
    choix.mockClear();
    (el.querySelectorAll('[data-mode] input[type="radio"]')[2] as HTMLInputElement).click();
    await f.whenStable();
    expect(choix).toHaveBeenCalledTimes(1);
    expect(etat.modeGeo()).toBe('lambert93');
  });

  it('changer un sélecteur écrit l’état : champ standard (vide → retiré) et colonne géo', async () => {
    const { f, el, etat } = await monter();
    const sNom = el.querySelector<HTMLSelectElement>('[data-standard] [data-ligne] select')!;
    sNom.value = 'statut';
    sNom.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(etat.correspondance()['nom']).toBe('statut');
    sNom.value = '';
    sNom.dispatchEvent(new Event('change'));
    expect(etat.correspondance()['nom']).toBeUndefined();
    const sLat = el.querySelector<HTMLSelectElement>('[data-geo-champs] [data-ligne] select')!;
    sLat.value = 'capacite';
    sLat.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(etat.correspondanceGeo()['colLat']).toBe('capacite');
    expect(lignes(el.querySelector('[data-geo-champs]')!)[0]).toEqual(['Latitude', 'capacite', 'ex: 120']);
  });
});

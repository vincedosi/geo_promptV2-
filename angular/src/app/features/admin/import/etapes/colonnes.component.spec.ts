import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ImportPoiService } from '../etat/import-poi.service';
import { ANALYSE_POI_ESSAI } from '../testing/import-poi.fixture';
import { ColonnesComponent } from './colonnes.component';
import { texte } from '../../testing/dom';
import { fournisseursImportPoi } from '../testing/fournisseurs';

async function monter() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), ...fournisseursImportPoi()] });
  const etat = TestBed.inject(ImportPoiService);
  const http = TestBed.inject(HttpTestingController);
  etat.analyser([new File(['x'], 'poi-essai.csv')]);
  http.expectOne('/api/admin/import-poi/parse').flush(ANALYSE_POI_ESSAI);
  etat.choisirCategorie('lycee');
  const f = TestBed.createComponent(ColonnesComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, etat };
}

const ligne = (el: HTMLElement, nom: string) =>
  [...el.querySelectorAll<HTMLElement>('[data-colonne]')].find((l) => l.dataset['colonne'] === nom)!;
const cases = (l: HTMLElement) => [...l.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

describe('mg-import-colonnes — étape 03b « Colonnes a importer » (`ColumnSelectionStep.tsx`, lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('chaque colonne : nom, deux exemples, statut — les colonnes du mapping « → schema:<champ> » sans case, les libres « metadata » cochées', async () => {
    const { el } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('03b');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Colonnes a importer');
    expect(texte(el.querySelector('[data-note]'))).toBe(
      '// schema = toujours importe via champs dentsu.explore · cochez Importer pour metadata · Filtre = filtre carte',
    );
    expect([...el.querySelectorAll('[data-entetes] span')].map((s) => texte(s))).toEqual(['Colonne / exemples', 'Statut', 'Importer', 'Filtre']);
    const rendu = [...el.querySelectorAll<HTMLElement>('[data-colonne]')].map((l) => [
      texte(l.querySelector('[data-nom]')), texte(l.querySelector('[data-exemples]')), texte(l.querySelector('[data-statut]')),
      cases(l).length,
    ]);
    // `reference_panneau` → `code_postal` (suggestion de la route) : la ligne garde le DERNIER libellé posé, comme React.
    expect(rendu).toEqual([
      ['nom', '[ESSAI lot 6] POI 01 · [ESSAI lot 6] POI 02', '→ schema:nom', 0],
      ['adresse', 'Place de l’Hôtel de Ville · Place Bellecour', '→ schema:adresse', 0],
      ['code_postal', '75004 · 69002', '→ schema:reference', 0],
      ['ville', 'Paris · Lyon', '→ schema:ville', 0],
      ['latitude', '48.8566 · 45.7578', '→ schema:latitude', 0],
      ['longitude', '2.3522 · 4.8320', '→ schema:longitude', 0],
      ['capacite', '120 · 80', 'metadata', 2],
      ['statut', 'ouvert · ferme', 'metadata', 2],
    ]);
    expect(cases(ligne(el, 'capacite')).map((c) => [c.checked, c.disabled])).toEqual([[true, false], [false, false]]);
    // 2 libres importées + 6 colonnes du mapping (React compte l'ensemble des colonnes mappées).
    expect(texte(el.querySelector('[data-importees]'))).toBe('8 importees');
    expect(el.querySelector('[data-filtres]')).toBeNull();
    expect(texte(el.querySelector('[data-compte]'))).toBe('2/2 colonnes libres · 0 filtres');
  });

  it('filtre : « metadata + filtre », badge « 1 filtre » puis « 2 filtres » ; décocher Importer retire le filtre et désactive sa case', async () => {
    const { f, el, etat } = await monter();
    cases(ligne(el, 'statut'))[1].click();
    await f.whenStable();
    expect(texte(ligne(el, 'statut').querySelector('[data-statut]'))).toBe('metadata + filtre');
    expect(texte(el.querySelector('[data-filtres]'))).toBe('1 filtre');
    cases(ligne(el, 'capacite'))[1].click();
    await f.whenStable();
    expect(texte(el.querySelector('[data-filtres]'))).toBe('2 filtres');
    cases(ligne(el, 'statut'))[0].click();
    await f.whenStable();
    expect(etat.champsFiltres()).toEqual(['capacite']);
    expect(texte(ligne(el, 'statut').querySelector('[data-statut]'))).toBe('exclu');
    expect(cases(ligne(el, 'statut')).map((c) => [c.checked, c.disabled])).toEqual([[false, false], [false, true]]);
    expect(ligne(el, 'statut').classList.contains('exclue')).toBe(true);
    expect(texte(el.querySelector('[data-compte]'))).toBe('1/2 colonnes libres · 1 filtres');
    expect(texte(el.querySelector('[data-importees]'))).toBe('7 importees');
  });

  it('« Tout exclure », « Tout importer » (colonnes libres seulement), « Effacer filtres »', async () => {
    const { f, el, etat } = await monter();
    const bouton = (t: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-actions] button')].find((b) => texte(b) === t)!;
    expect([...el.querySelectorAll('[data-actions] button')].map((b) => texte(b))).toEqual(['Tout importer', 'Tout exclure', 'Effacer filtres']);
    cases(ligne(el, 'statut'))[1].click();
    bouton('Tout exclure').click();
    await f.whenStable();
    expect(etat.colonnesImportees()).toEqual([]);
    expect(etat.champsFiltres()).toEqual([]);
    expect(texte(el.querySelector('[data-compte]'))).toBe('0/2 colonnes libres · 0 filtres');
    bouton('Tout importer').click();
    await f.whenStable();
    expect(etat.colonnesImportees()).toEqual(['capacite', 'statut']);
    cases(ligne(el, 'capacite'))[1].click();
    bouton('Effacer filtres').click();
    await f.whenStable();
    expect(etat.champsFiltres()).toEqual([]);
  });

  it('une colonne retirée du mapping redevient libre — et déjà cochée, React cochant toutes les colonnes au dépôt', async () => {
    const { f, el, etat } = await monter();
    etat.associer('nom', '');
    await f.whenStable();
    expect(texte(ligne(el, 'nom').querySelector('[data-statut]'))).toBe('metadata');
    expect(cases(ligne(el, 'nom'))).toHaveLength(2);
    expect(texte(el.querySelector('[data-compte]'))).toBe('3/3 colonnes libres · 0 filtres');
  });
});

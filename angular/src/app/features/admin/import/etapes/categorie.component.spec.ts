import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi } from '../../commun/data/organisations-liste.api';
import { ImportPoiApi } from '../data/import-poi.api';
import { ImportPoiService } from '../etat/import-poi.service';
import { CategorieComponent } from './categorie.component';

const URL_CATEGORIES = '/api/admin/poi-categories';
const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), ImportPoiApi, CategoriesPoiApi, OrganisationsListeApi,
      NotificationsService, ImportPoiService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(CategorieComponent);
  await f.whenStable();
  return {
    f, el: f.nativeElement as HTMLElement, etat: TestBed.inject(ImportPoiService), http: TestBed.inject(HttpTestingController),
  };
}

describe('mg-import-categorie — étape 02 « Categorie POI » (`CategoryStep.tsx`, lot 6, T12)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('liste vide : option désactivée « -- Choisir une categorie -- » et « Chargement... » ; aucune requête de l’étape', async () => {
    const { el } = await monter();
    expect(texte(el.querySelector('[data-num]'))).toBe('02');
    expect(texte(el.querySelector('[data-titre]'))).toBe('Categorie POI');
    expect(texte(el.querySelector('label[for]'))).toBe('Categorie');
    const options = [...el.querySelectorAll('select option')] as HTMLOptionElement[];
    expect(options.map((o) => [o.value, texte(o), o.disabled])).toEqual([['', '-- Choisir une categorie --', true]]);
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement...');
  });

  it('catégories : « icône libellé » (ou le libellé seul) ; choisir met à jour l’état ; « Chargement... » disparaît', async () => {
    const { f, el, etat } = await monter();
    etat.categories.set([{ val: 'lycee', label: 'Tous les lycées', icone: '🎓' }, { val: 'autre', label: 'Autre', icone: '' }]);
    await f.whenStable();
    const select = el.querySelector('select')!;
    expect([...select.options].map((o) => texte(o))).toEqual(['-- Choisir une categorie --', '🎓 Tous les lycées', 'Autre']);
    expect(el.querySelector('[data-chargement]')).toBeNull();
    expect(select.classList.contains('vide')).toBe(true);
    select.value = 'autre';
    select.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(etat.categorie()).toBe('autre');
    expect(select.classList.contains('vide')).toBe(false);
  });

  it('création : volet « + Creer une nouvelle categorie » replié, exemple générique, « Creer » désactivé tant que le nom est vide, puis POST', async () => {
    const { f, el, etat, http } = await monter();
    const volet = el.querySelector<HTMLDetailsElement>('details[data-creation]')!;
    expect(volet.open).toBe(false);
    expect(texte(volet.querySelector('summary'))).toBe('+ Creer une nouvelle categorie');
    const champ = volet.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(champ.placeholder).toBe('Ex: cirfa, commerce, sante...');
    const bouton = volet.querySelector<HTMLButtonElement>('[data-creer]')!;
    expect(texte(bouton)).toBe('Creer');
    expect(bouton.disabled).toBe(true);
    champ.value = '   ';
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(bouton.disabled).toBe(true);
    champ.value = '[ESSAI lot 6]';
    champ.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(etat.nouvelleCategorie()).toBe('[ESSAI lot 6]');
    expect(bouton.disabled).toBe(false);
    bouton.click();
    await f.whenStable();
    expect(bouton.disabled).toBe(true);
    expect(bouton.querySelector('mg-icone')).not.toBeNull();
    const post = http.expectOne((r) => r.url === URL_CATEGORIES && r.method === 'POST');
    expect(post.request.body).toEqual({ categorie: '[ESSAI lot 6]' });
    post.flush({ success: true, categorie: 'essai_lot_6' });
    http.expectOne((r) => r.url === URL_CATEGORIES && r.method === 'GET')
      .flush({ success: true, categories: [{ categorie: 'essai_lot_6', label_fr: '[ESSAI lot 6]', icone: '📍' }] });
    await f.whenStable();
    expect(el.querySelector('select')!.value).toBe('essai_lot_6');
    expect(champ.value).toBe('');
  });
});

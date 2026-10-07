import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { CarreauxService } from '../../couches/carreaux.service';
import { CarreauxApi } from '../../data/carreaux.api';
import { IrisService } from '../../couches/iris.service';
import { IrisApi } from '../../data/iris.api';
import { NEVER } from 'rxjs';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { CARREAUX_INDICATEURS } from '../../logique/carreaux/catalogue';
import { PanneauCalquesComponent } from './panneau-calques.component';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarreauxApi, useValue: { urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '', bornes: () => NEVER, detail: () => NEVER } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const fixture = TestBed.createComponent(PanneauCalquesComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return {
    el, rendre,
    carreaux: TestBed.inject(CarreauxService),
    iris: TestBed.inject(IrisService),
    etat: TestBed.inject(EtatCarteService),
    titres: () => [...el.querySelectorAll('button[data-groupe]')].map((b) => b.querySelector('span')!.textContent!.trim()),
    groupe: (titre: string) => [...el.querySelectorAll<HTMLButtonElement>('button[data-groupe]')]
      .find((b) => b.textContent!.includes(titre))!,
  };
}

describe('PanneauCalquesComponent', () => {
  afterEach(() => localStorage.clear());

  it('les groupes dans l’ordre de React, « Campagne active » absent sans campagne, tous repliés', () => {
    const { el, titres } = monter();
    expect(titres()).toEqual(['Socio-démographie', 'POI et mobilité', 'Médias offline', 'Environnement', 'Mes analyses']);
    expect([...el.querySelectorAll('button[data-groupe]')].every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(el.textContent).toContain('Actifs (0)');
    expect(el.textContent).toContain('Aucun calque affiché');
  });

  it('les groupes ne sont pas mémorisés (comme React) : ni lus ni écrits, et un panneau rouvert repart replié', async () => {
    localStorage.setItem('magelian-filter-sections', JSON.stringify({ socioDemo: true, poi: true }));
    const lecture = vi.spyOn(Storage.prototype, 'getItem');
    const ecriture = vi.spyOn(Storage.prototype, 'setItem');
    const premier = monter();
    premier.groupe('Socio-démographie').click();
    premier.groupe('Environnement').click();
    await premier.rendre();
    expect(premier.groupe('Socio-démographie').getAttribute('aria-expanded')).toBe('true');
    // Le panneau se rouvre : un NOUVEAU composant, comme à chaque réouverture du rail.
    const second = TestBed.createComponent(PanneauCalquesComponent);
    second.detectChanges();
    const boutons = [...(second.nativeElement as HTMLElement).querySelectorAll('button[data-groupe]')];
    expect(boutons.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(lecture).not.toHaveBeenCalled();
    expect(ecriture).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('IRIS dans Socio-démographie, sous les carreaux : l’allumer évince les carreaux ; « Actifs » et le compte suivent', async () => {
    const { el, rendre, carreaux, iris, etat, groupe } = monter();
    groupe('Socio-démographie').click();
    await rendre();
    const entetes = [...el.querySelectorAll('button[data-entete-carreaux], button[data-entete-iris]')];
    expect(entetes.map((b) => b.hasAttribute('data-entete-iris'))).toEqual([false, true]);
    carreaux.basculer(true);
    await rendre();
    el.querySelector<HTMLButtonElement>('button[data-entete-iris]')!.click();
    await rendre();
    expect(carreaux.visible()).toBe(false);
    expect(iris.visible()).toBe(true);
    expect(etat.degradeActif()).toBe('iris');
    expect(el.textContent).toContain('Actifs (1)');
    expect(groupe('Socio-démographie').querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    el.querySelector<HTMLButtonElement>('[data-actif="iris"] button[title="Masquer IRIS"]')!.click();
    await rendre();
    expect(iris.visible()).toBe(false);
    expect(el.textContent).toContain('Actifs (0)');
  });

  it('allumer les carreaux : « Actifs (1) », compte 1 sur Socio-démographie, dégradé réclamé ; la croix les éteint', async () => {
    const { el, rendre, carreaux, etat, groupe } = monter();
    groupe('Socio-démographie').click();
    await rendre();
    el.querySelector<HTMLButtonElement>('button[data-entete-carreaux]')!.click();
    await rendre();
    expect(carreaux.visible()).toBe(true);
    expect(etat.degradeActif()).toBe('carreaux');
    expect(el.textContent).toContain('Actifs (1)');
    expect(groupe('Socio-démographie').querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    const actif = el.querySelector('[data-actif="carreaux"]')!;
    expect(actif.textContent).toContain('Carreaux Filosofi');
    actif.querySelector<HTMLButtonElement>('button[title="Masquer Carreaux Filosofi"]')!.click();
    await rendre();
    expect(carreaux.visible()).toBe(false);
    expect(etat.degradeActif()).toBeNull();
    expect(el.textContent).toContain('Actifs (0)');
  });

  it('section carreaux : réglages visibles seulement couche active ; indicateur, palette, opacité, relief', async () => {
    const { el, rendre, carreaux, groupe } = monter();
    groupe('Socio-démographie').click();
    await rendre();
    expect(el.querySelector('[data-reglages]')).toBeNull();
    carreaux.basculer(true);
    await rendre();
    const select = el.querySelector<HTMLSelectElement>('select[data-indicateur]')!;
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Population', 'Ménages', 'Revenus', 'Logements']);
    expect(select.querySelectorAll('option').length).toBe(CARREAUX_INDICATEURS.length);
    select.value = 'revenu_median';
    select.dispatchEvent(new Event('change'));
    expect(carreaux.indicateur()).toBe('revenu_median');
    el.querySelector<HTMLButtonElement>('button[data-palette="plasma"]')!.click();
    expect(carreaux.palette()).toBe('plasma');
    const opacite = el.querySelector<HTMLInputElement>('input[data-opacite]')!;
    opacite.value = '0.5';
    opacite.dispatchEvent(new Event('input'));
    await rendre();
    expect(carreaux.opacite()).toBe(0.5);
    expect(el.textContent).toContain('50%');
    expect(el.querySelector('input[data-hauteur]')).toBeNull();
    el.querySelector<HTMLButtonElement>('button[data-relief]')!.click();
    await rendre();
    expect(carreaux.relief()).toBe(true);
    expect(el.querySelector('button[data-relief]')!.textContent!.trim()).toBe('Relief 3D ✓');
    expect(el.textContent).toContain('×1.5');
  });
});

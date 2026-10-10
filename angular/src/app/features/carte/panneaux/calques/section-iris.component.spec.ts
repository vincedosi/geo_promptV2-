import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { NEVER } from 'rxjs';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { CarreauxService } from '../../couches/carreaux.service';
import { IrisService } from '../../couches/iris.service';
import { CarreauxApi } from '../../data/carreaux.api';
import { IrisApi } from '../../data/iris.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { IRIS_DB_COLUMNS } from '../../logique/iris-colonnes';
import { IRIS_PALETTES } from '../../logique/palettes-donnees-carte';
import { SectionIrisComponent } from './section-iris.component';
import { CaptureService } from '../../etat/capture.service';

function monter(zoom = 9) {
  const api = { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes: vi.fn(() => NEVER), detail: vi.fn(() => NEVER) };
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      provideZonelessChangeDetection(), IrisService, CarreauxService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: IrisApi, useValue: api },
      { provide: CarreauxApi, useValue: { urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.zoom = zoom;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(SectionIrisComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, carte, api, iris: TestBed.inject(IrisService), etat: TestBed.inject(EtatCarteService) };
}

describe('SectionIrisComponent', () => {
  it('en-tête « IRIS » : allume la couche (dégradé réclamé) et montre les réglages ; ● quand active', async () => {
    const { el, rendre, iris, etat } = monter();
    const entete = el.querySelector<HTMLButtonElement>('button[data-entete-iris]')!;
    expect(entete.textContent).toContain('IRIS');
    expect(entete.querySelector('[data-actif]')).toBeNull();
    expect(el.querySelector('[data-reglages]')).toBeNull();
    entete.click();
    await rendre();
    expect(iris.visible()).toBe(true);
    expect(etat.degradeActif()).toBe('iris');
    expect(entete.querySelector('[data-actif]')!.textContent).toBe('●');
    expect(el.querySelector('[data-reglages]')).not.toBeNull();
    expect(el.querySelector('button[data-bascule]')!.textContent).toContain('Couche IRIS');
  });

  it('indicateur : défaut pop_15_29, optgroups dans l’ordre d’apparition, booléens exclus ; changer = AUCUNE requête', async () => {
    const { el, rendre, iris, api } = monter();
    iris.basculer(true);
    await rendre();
    const select = el.querySelector<HTMLSelectElement>('select[data-indicateur]')!;
    expect(select.value).toBe('pop_15_29');
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label))
      .toEqual(['Population', 'Âge', 'Revenus', 'Diplômes', 'CSP', 'Emploi', 'Logement', 'Familles', 'Mobilité']);
    expect(select.querySelectorAll('option').length).toBe(IRIS_DB_COLUMNS.filter((c) => c.type !== 'boolean').length);
    const appels = api.bornes.mock.calls.length;
    select.value = 'rev_median';
    select.dispatchEvent(new Event('change'));
    await rendre();
    expect(iris.indicateur()).toBe('rev_median');
    expect(api.bornes.mock.calls.length).toBe(appels);
    expect(api.detail).not.toHaveBeenCalled();
  });

  it('vrais IRIS : décoché par défaut, « 49 k (+ communes) » ; coché « 16 k quartiers »', async () => {
    const { el, rendre, iris } = monter();
    iris.basculer(true);
    await rendre();
    const bouton = el.querySelector<HTMLButtonElement>('button[data-vrais-iris]')!;
    expect(iris.vraisSeulement()).toBe(false);
    expect(bouton.textContent).toContain('Vrais IRIS uniquement');
    expect(bouton.textContent).toContain('49 k (+ communes)');
    bouton.click();
    await rendre();
    expect(iris.vraisSeulement()).toBe(true);
    expect(bouton.textContent).toContain('16 k quartiers');
  });

  it('palier affiché à ce zoom : « Communes » + « zoomer pour les IRIS » à z8 ; « IRIS » seul à z9', async () => {
    const { el, rendre, iris, carte } = monter(8.6);
    iris.basculer(true);
    await rendre();
    expect(el.querySelector('[data-palier]')!.textContent).toContain('Affiché');
    expect(el.querySelector('[data-palier]')!.textContent).toContain('Communes');
    expect(el.querySelector('[data-palier]')!.textContent).toContain('zoomer pour les IRIS');
    carte.zoom = 9.2;
    carte.emettre('zoomend');
    await rendre();
    expect(el.querySelector('[data-palier]')!.textContent).toContain('IRIS');
    expect(el.querySelector('[data-palier]')!.textContent).not.toContain('zoomer');
  });

  it('sous le plancher : bandeau « Trop loin pour les IRIS » avec le zoom, et « Zoomer » remonte la caméra', async () => {
    const { el, rendre, iris, carte } = monter(9);
    iris.basculer(true);
    await rendre();
    expect(el.querySelector('[data-sous-plancher]')).toBeNull();
    carte.zoom = 3.24;
    carte.emettre('zoomend');
    await rendre();
    const bandeau = el.querySelector('[data-sous-plancher]')!;
    expect(bandeau.textContent).toContain('Trop loin pour les IRIS — lisibles à partir du zoom 4');
    expect(bandeau.textContent).toContain('(z3.2)');
    expect(el.querySelector('[data-palier]')).toBeNull();
    bandeau.querySelector<HTMLButtonElement>('button')!.click();
    expect(carte.animations.at(-1)).toEqual({ zoom: 4, duration: 800 });
  });

  it('palette, opacité (45 % par défaut), relief et réglette ×1.5', async () => {
    const { el, rendre, iris } = monter();
    iris.basculer(true);
    await rendre();
    expect(el.querySelectorAll('button[data-palette]').length).toBe(IRIS_PALETTES.length);
    expect(el.querySelector('button[data-palette="bleu"]')!.getAttribute('aria-pressed')).toBe('true');
    el.querySelector<HTMLButtonElement>('button[data-palette="chaleur"]')!.click();
    expect(iris.palette()).toBe('chaleur');
    expect(el.textContent).toContain('45%');
    const opacite = el.querySelector<HTMLInputElement>('input[data-opacite]')!;
    opacite.value = '0.8';
    opacite.dispatchEvent(new Event('input'));
    await rendre();
    expect(iris.opacite()).toBe(0.8);
    expect(el.textContent).toContain('80%');
    expect(el.querySelector('input[data-hauteur]')).toBeNull();
    el.querySelector<HTMLButtonElement>('button[data-relief]')!.click();
    await rendre();
    expect(iris.relief()).toBe(true);
    expect(el.querySelector('button[data-relief]')!.textContent!.trim()).toBe('Relief 3D ✓');
    expect(el.textContent).toContain('×1.5');
  });
});

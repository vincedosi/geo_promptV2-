import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxService } from '../couches/carreaux.service';
import { CarreauxApi } from '../data/carreaux.api';
import { IrisApi } from '../data/iris.api';
import { IrisService } from '../couches/iris.service';
import { Subject } from 'rxjs';
import type { CatalogueBornesIris } from '../logique/iris-echelle';
import { echelleDe } from '../logique/iris-echelle';
import { bornesInternes } from '../logique/carreaux/expressions';
import { formaterValeur, versValeurReelle } from '../logique/carreaux/bornes';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { CARREAUX_PALETTES } from '../logique/palettes-donnees-carte';
import type { DegradeId } from '../logique/degrades';
import { LegendeCarteComponent, degradeALegende } from './legende-carte.component';

function monter() {
  const bornes$: Subject<CatalogueBornesIris>[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarreauxApi, useValue: { urlTuiles: () => '' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '', detail: vi.fn(), bornes: () => { const f = new Subject<CatalogueBornesIris>(); bornes$.push(f); return f; } } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const fixture = TestBed.createComponent(LegendeCarteComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { fixture, el, rendre, bornes$, carreaux: TestBed.inject(CarreauxService), iris: TestBed.inject(IrisService) };
}

describe('LegendeCarteComponent', () => {
  it('aucune boîte sans dégradé, ni pour un dégradé qui n’a pas encore son bloc (jamais de « Légende » vide)', async () => {
    const { fixture, el, rendre } = monter();
    fixture.componentRef.setInput('degradeActif', null);
    await rendre();
    expect(el.querySelector('[data-legende]')).toBeNull();
    fixture.componentRef.setInput('degradeActif', 'score');
    await rendre();
    expect(el.querySelector('[data-legende]')).toBeNull();
    const tous: DegradeId[] = ['carreaux', 'iris', 'civic-indicateurs', 'civic-sante', 'meteo', 'campagne-impressions', 'score', 'diffusion', 'zones-risque'];
    expect(tous.filter((d) => degradeALegende(d))).toEqual(['carreaux', 'iris']);
  });

  it('carreaux : titre, unité normalisée, six paliers de la palette ; « ≥ » sur le dernier', async () => {
    const { fixture, el, rendre, carreaux } = monter();
    fixture.componentRef.setInput('degradeActif', 'carreaux');
    await rendre();
    const bloc = el.querySelector('[data-bloc="carreaux"]')!;
    expect(bloc.textContent).toContain('Carreaux Filosofi · pers./km²');
    const paliers = [...bloc.querySelectorAll<HTMLButtonElement>('button[data-palier]')];
    expect(paliers).toHaveLength(6);
    expect(paliers[5].textContent!.trim().startsWith('≥ ')).toBe(true);
    expect(paliers[0].textContent).toContain('–');
    carreaux.indicateur.set('revenu_median');
    await rendre();
    expect(bloc.textContent).toContain('€/hab');
    carreaux.palette.set('bleu');
    await rendre();
    const pastille = el.querySelector<HTMLElement>('button[data-palier="0"] span')!;
    expect(pastille.style.background).not.toBe('');
    expect(CARREAUX_PALETTES.find((p) => p.id === 'bleu')!.stops.length).toBe(6);
  });

  it('cliquer un palier le sélectionne, recliquer le désélectionne', async () => {
    const { fixture, el, rendre, carreaux } = monter();
    fixture.componentRef.setInput('degradeActif', 'carreaux');
    await rendre();
    el.querySelector<HTMLButtonElement>('button[data-palier="3"]')!.click();
    await rendre();
    expect(carreaux.seauSelectionne()).toBe(3);
    expect(el.querySelector('button[data-palier="3"]')!.getAttribute('aria-pressed')).toBe('true');
    el.querySelector<HTMLButtonElement>('button[data-palier="3"]')!.click();
    expect(carreaux.seauSelectionne()).toBeNull();
  });

  it('l’en-tête « Légende » replie et déplie le contenu', async () => {
    const { fixture, el, rendre } = monter();
    fixture.componentRef.setInput('degradeActif', 'carreaux');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-legende] > button')!.click();
    await rendre();
    expect(el.querySelector('[data-bloc="carreaux"]')).toBeNull();
    expect(el.querySelector('[data-legende] > button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('iris : « Chargement... » avant les bornes, puis titre + unité et six paliers « ≤ … », « a – b », « ≥ … »', async () => {
    const { fixture, el, rendre, bornes$, iris } = monter();
    iris.basculer(true);
    fixture.componentRef.setInput('degradeActif', 'iris');
    await rendre();
    const bloc = () => el.querySelector('[data-bloc="iris"]')!;
    expect(bloc().textContent).toContain('IRIS');
    expect(bloc().textContent).toContain('Chargement...');
    const b = { colonne: 'pop_15_29', classe: 'effectif' as const, log_min: 0.5, log_max: 4.2, val_min: 3, val_max: 15000 };
    bornes$[0].next({ pop_15_29: b, taux_chomage: { ...b, colonne: 'taux_chomage', classe: 'proportion' } });
    await rendre();
    expect(bloc().querySelector('div')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('IRIS · /km²');
    const f = bornesInternes(echelleDe(b), 6).map(versValeurReelle).map(formaterValeur);
    const lignes = [...bloc().querySelectorAll('[data-palier-iris]')].map((l) => l.textContent!.trim());
    expect(lignes).toEqual([`≤ ${f[0]}`, `${f[0]} – ${f[1]}`, `${f[1]} – ${f[2]}`, `${f[2]} – ${f[3]}`, `${f[3]} – ${f[4]}`, `≥ ${f[4]}`]);
    iris.indicateur.set('taux_chomage');
    await rendre();
    expect(bloc().querySelector('div')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('IRIS · %');
    iris.indicateur.set('nb_emplois');
    await rendre();
    expect(bloc().textContent).toContain('! Aucune donnée pour cet indicateur');
  });

  it('iris : bornes en échec → « ! Bornes indisponibles » (jamais « Aucune donnée », qui serait faux)', async () => {
    const { fixture, el, rendre, bornes$, iris } = monter();
    iris.basculer(true);
    fixture.componentRef.setInput('degradeActif', 'iris');
    await rendre();
    bornes$[0].error(new Error('500'));
    await rendre();
    expect(el.querySelector('[data-bloc="iris"]')!.textContent).toContain('! Bornes indisponibles');
  });
});

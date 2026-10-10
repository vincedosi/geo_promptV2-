import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxService } from '../couches/carreaux.service';
import { CarreauxApi } from '../data/carreaux.api';
import { IrisApi } from '../data/iris.api';
import { IrisService } from '../couches/iris.service';
import { PoisService } from '../couches/pois.service';
import { RadioService } from '../couches/radio.service';
import { TmjaService } from '../couches/tmja.service';
import { RadioApi } from '../data/radio.api';
import { CiviqueApi } from '../data/civique.api';
import { SanteService } from '../couches/sante.service';
import { CarteApi } from '../data/carte.api';
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
      provideZonelessChangeDetection(), CarreauxService, IrisService, PoisService, EtatCarteService, CouchesCarteService, AnnonceService,
      TmjaService, RadioService, SanteService,
      { provide: CiviqueApi, useValue: { zones: () => new Subject(), santeDepartement: () => new Subject(), santeCp: () => new Subject() } },
      { provide: CarteApi, useValue: {} },
      { provide: RadioApi, useValue: { optionsFiltre: () => new Subject(), emetteurs: () => new Subject() } },
      { provide: CarreauxApi, useValue: { urlTuiles: () => '' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '', detail: vi.fn(), bornes: () => { const f = new Subject<CatalogueBornesIris>(); bornes$.push(f); return f; } } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const fixture = TestBed.createComponent(LegendeCarteComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return {
    fixture, el, rendre, bornes$, carreaux: TestBed.inject(CarreauxService), iris: TestBed.inject(IrisService),
    pois: TestBed.inject(PoisService), etat: TestBed.inject(EtatCarteService),
    tmja: TestBed.inject(TmjaService), radio: TestBed.inject(RadioService), sante: TestBed.inject(SanteService),
  };
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
    expect(tous.filter((d) => degradeALegende(d))).toEqual(['carreaux', 'iris', 'civic-indicateurs', 'civic-sante']);
  });

  it('indicateurs civiques (T10) : titre, six teintes pondérées de React, trois repères', async () => {
    const { fixture, el, rendre } = monter();
    fixture.componentRef.setInput('degradeActif', 'civic-indicateurs');
    await rendre();
    const bloc = el.querySelector('[data-bloc="civique"]')!;
    expect(bloc.textContent).toContain('Indicateurs civiques');
    const paliers = [...bloc.querySelectorAll<HTMLElement>('[data-palier-civique]')];
    expect(paliers.map((p) => p.style.flexGrow)).toEqual(['0.5', '1', '1', '1', '1.2', '0.8']);
    expect(paliers[0].style.background).toBe('rgb(22, 163, 74)');
    expect([...bloc.querySelectorAll('span')].map((x) => x.textContent!.trim())).toEqual(['10% (forte particip.)', '30%', '60% (forte abst.)']);
  });

  it('santé environnementale (T10) : six niveaux en jetons, ceux sous le seuil estompés ; le titre suit le jeu', async () => {
    const { fixture, el, rendre, sante } = monter();
    sante.choisirJeu('pollen');
    sante.seuil.set(4);
    fixture.componentRef.setInput('degradeActif', 'civic-sante');
    await rendre();
    const bloc = el.querySelector('[data-bloc="sante"]')!;
    expect(bloc.textContent).toContain('Indice pollen');
    const niveaux = [...bloc.querySelectorAll<HTMLElement>('[data-niveau-sante]')];
    expect(niveaux.map((n) => n.textContent!.trim())).toEqual([
      '1 — très faible', '2 — faible', '3 — modéré', '4 — élevé', '5 — très élevé', '6 — extrêmement élevé',
    ]);
    expect(niveaux.map((n) => n.style.opacity)).toEqual(['0.3', '0.3', '0.3', '1', '1', '1']);
    expect(niveaux[0].querySelector('span')!.getAttribute('style')).toContain('var(--pollen-level-1)');
    sante.choisirJeu('atmo');
    await rendre();
    expect(el.querySelector('[data-bloc="sante"]')!.textContent).toContain('Indice ATMO');
    expect(el.querySelector('[data-bloc="sante"]')!.textContent).toContain('6 — extrêmement mauvais');
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

  it('« Analyse spatiale » : catégories des points affichés, triées, comptées, dans la couleur de leur épingle (T8)', async () => {
    const { fixture, el, rendre, pois } = monter();
    fixture.componentRef.setInput('degradeActif', null);
    pois.definirZone({
      ville: 'France', rayon_metres: null, rayon_poi_metres: null, coordonnees: { lat: 0, lng: 0 }, pois: [], nb_pois: 0,
      categories: { lycee: 241, college: 12 },
    });
    pois.reglerStyle('lycee', { color: '#ff4444' });
    await rendre();
    const bloc = el.querySelector('[data-bloc="analyse"]')!;
    expect(bloc.textContent).toContain('Analyse spatiale');
    expect([...bloc.querySelectorAll('[data-categorie]')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['college (12)', 'lycee (241)']);
    const point = bloc.querySelector('[data-categorie="lycee"] span') as HTMLElement;
    expect(point.style.background).toBe('rgb(255, 68, 68)');
  });

  it('« Figurés » : les types de POI choisis — la boîte s’ouvre sans dégradé, et se ferme sans rien', async () => {
    const { fixture, el, rendre, etat } = monter();
    fixture.componentRef.setInput('degradeActif', null);
    etat.poiSelectionnes.set(['lycee']);
    await rendre();
    expect(el.querySelector('[data-bloc="figures"]')!.textContent).toContain('lycee');
    etat.poiSelectionnes.set([]);
    await rendre();
    expect(el.querySelector('[data-legende]')).toBeNull();
  });

  it('ordre des blocs de React : Analyse, dégradé, Figurés', async () => {
    const { fixture, el, rendre, etat, pois } = monter();
    fixture.componentRef.setInput('degradeActif', 'carreaux');
    etat.poiSelectionnes.set(['lycee']);
    pois.definirZone({
      ville: 'F', rayon_metres: null, rayon_poi_metres: null, coordonnees: { lat: 0, lng: 0 }, pois: [], nb_pois: 0, categories: { lycee: 1 },
    });
    await rendre();
    expect([...el.querySelectorAll('[data-bloc]')].map((b) => b.getAttribute('data-bloc'))).toEqual(['analyse', 'carreaux', 'figures']);
  });

  it('« Figurés » TMJA (T9) : libellés de React, couleurs de la CARTE ; le palier faible estompé quand il est masqué', async () => {
    const { fixture, el, rendre, tmja } = monter();
    fixture.componentRef.setInput('degradeActif', null);
    tmja.afficher();
    await rendre();
    const lignes = [...el.querySelectorAll<HTMLElement>('[data-figure-tmja]')];
    expect(lignes.map((l) => l.textContent!.trim())).toEqual(['< 5 000 véh/j', '5 000 – 15 000 véh/j', '15 000 – 40 000 véh/j', '> 40 000 véh/j']);
    expect(lignes.map((l) => (l.querySelector('span') as HTMLElement).style.background))
      .toEqual(['rgb(66, 146, 198)', 'rgb(246, 213, 67)', 'rgb(249, 115, 22)', 'rgb(239, 68, 68)']);
    expect(lignes.map((l) => l.style.opacity)).toEqual(['0.35', '1', '1', '1']);
    tmja.masquerFaible.set(false);
    await rendre();
    expect(el.querySelector<HTMLElement>('[data-figure-tmja]')!.style.opacity).toBe('1');
    tmja.masquer();
    await rendre();
    expect(el.querySelector('[data-legende]')).toBeNull();
  });

  it('« Figurés » radio (T9) : « Émetteurs radio » dans la couleur de couverture choisie', async () => {
    const { fixture, el, rendre, radio } = monter();
    fixture.componentRef.setInput('degradeActif', null);
    radio.visible.set(true);
    radio.couleurCouverture.set('#ef4444');
    await rendre();
    const ligne = el.querySelector('[data-figure-radio]')!;
    expect(ligne.textContent!.trim()).toBe('Émetteurs radio');
    expect((ligne.querySelector('span') as HTMLElement).style.background).toBe('rgb(239, 68, 68)');
  });
});

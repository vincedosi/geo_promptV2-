import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { SitesRisqueApi } from '../../../risques/data/sites-risque.api';
import { PprtService } from '../../couches/pprt.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { CarteApi } from '../../data/carte.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import { naturesDesTypes } from '../../logique/natures-risque';
import { ecrireEtatUrl, ETAT_DEFAUT } from '../../../risques/logique/etat-url';
import { SectionRisqueComponent } from './section-risque.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), SelectionsCalquesService, RisqueCarteService, RisquesIndustrielsService, PprtService,
      CouchesCarteService, provideRouter([]),
      { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
      { provide: CarteApi, useValue: { pprt: () => NEVER } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
    ],
  });
  const fixture = TestBed.createComponent(SectionRisqueComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { fixture, el, rendre, r: TestBed.inject(RisqueCarteService), selections: TestBed.inject(SelectionsCalquesService) };
}

/** Espaces ordinaires réduits ; l'espace fine insécable de `fr-FR` (U+202F) est GARDÉE. */
const texte = (el: Element | null) => (el?.textContent ?? '').replace(/[ \n\t]+/g, ' ').trim();

describe('RisqueCarteService', () => {
  it('défauts de `use-risque-industriel.ts` : éteint, Seveso, aucun type, rayon 0, halo, PPRT éteint', () => {
    TestBed.configureTestingModule({ providers: [RisqueCarteService] });
    const r = TestBed.inject(RisqueCarteService);
    expect(r.actif()).toBe(false);
    expect(r.niveaux()).toEqual(['seveso_haut', 'seveso_bas']);
    expect(r.filtres()).toEqual({
      gravites: ['seveso_haut', 'seveso_bas'], typesRisque: [], inclureInactifs: false, rayonM: 0, afficherHalo: true,
    });
    expect(r.pprtActif()).toBe(false);
    expect(r.pprtTypes()).toEqual([]);
    expect(r.compte()).toBeNull();
    expect(r.natures()).toEqual([]);
  });

  it('naturesDesTypes : libellés du seed, et « Nature non précisée » pour non_precise', () => {
    expect(naturesDesTypes(['pollution'])).toEqual(['Déchets', 'Dangereux pour le milieu aquatique', 'Déchets (IED)']);
    expect(naturesDesTypes(['non_precise'])).toEqual(['Nature non précisée']);
  });
});

describe('SectionRisqueComponent', () => {
  it('intégrée à une ligne de ② : aucun en-tête interne, contenu rendu même section repliée', async () => {
    const { fixture, el, rendre, selections } = monter();
    fixture.componentRef.setInput('integre', true);
    selections.sections.update((s) => ({ ...s, risqueIndustriel: false }));
    await rendre();
    expect(el.querySelector('mg-entete-filtre')).toBeNull();
    expect(el.querySelector('[data-contenu-risque]')).not.toBeNull();
  });

  it('ouverte d’emblée (comme React) ; le PREMIER clic sur l’en-tête la replie (défaut React corrigé)', async () => {
    const { el, rendre } = monter();
    await rendre();
    expect(el.querySelector('[data-contenu-risque]')).not.toBeNull();
    (el.querySelector('mg-entete-filtre') as HTMLElement).click();
    await rendre();
    expect(el.querySelector('[data-contenu-risque]')).toBeNull();
    (el.querySelector('mg-entete-filtre') as HTMLElement).click();
    await rendre();
    expect(el.querySelector('[data-contenu-risque]')).not.toBeNull();
  });

  it('éteinte : seule la case, la carte PPRT, l’analyse ACTIVE (T13) et la provenance ; pas de zone calculée ni de réglages', async () => {
    const { el, rendre } = monter();
    await rendre();
    expect(el.querySelector('[data-carte-pprt]')).not.toBeNull();
    expect(el.querySelector('[data-carte-calculee]')).toBeNull();
    expect(el.querySelector('mg-repli-risque')).toBeNull();
    const analyser = el.querySelector('[data-analyser]') as HTMLButtonElement;
    expect(analyser.disabled).toBe(false);
    expect(analyser.hasAttribute('title')).toBe(false);
    expect(texte(analyser)).toBe('Analyser la population à risque →');
    expect(texte(el.querySelector('[data-provenance]'))).toBe("+ D'où viennent ces zones ?");
  });

  it('cocher « Afficher les sites classés » allume la couche ; compte « N sites dans la vue sur M », part PPRT, troncature', async () => {
    const { el, rendre, r } = monter();
    await rendre();
    const case_ = el.querySelector('[data-sites-classes]') as HTMLInputElement;
    case_.click();
    await rendre();
    expect(r.actif()).toBe(true);
    expect(texte(el.querySelector('mg-entete-filtre [data-compte]'))).toBe('2');
    r.compte.set({ rendus: 1259, total: 1327, avecPprt: 567 });
    await rendre();
    const bloc = texte(el.querySelector('[data-compte-risque]'));
    expect(bloc).toContain('1 259 sites dans la vue sur 1 327');
    expect(bloc).toContain('567 avec un périmètre réglementaire');
    expect(bloc).toContain('45 % couverts par un PPRT');
    expect(bloc).toContain('Liste tronquée');
    r.compte.set({ rendus: 1, total: 1, avecPprt: 0 });
    await rendre();
    expect(texte(el.querySelector('[data-compte-risque]'))).toContain('1 site dans la vue');
    expect(texte(el.querySelector('[data-compte-risque]'))).not.toContain('sur');
  });

  it('zone calculée : cocher → 500 m ; un rayon choisi est pressé ; décocher → 0', async () => {
    const { el, rendre, r } = monter();
    r.actif.set(true);
    await rendre();
    (el.querySelector('[data-carte-calculee] input[type=checkbox]') as HTMLInputElement).click();
    await rendre();
    expect(r.rayonM()).toBe(500);
    expect([...el.querySelectorAll('[data-rayon]')].map((b) => texte(b))).toEqual(['300 m', '500 m', '1 km', '2 km', '5 km']);
    (el.querySelector('[data-rayon="2000"]') as HTMLButtonElement).click();
    await rendre();
    expect(r.rayonM()).toBe(2000);
    expect(el.querySelector('[data-rayon="2000"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(texte(el.querySelector('[data-carte-calculee]'))).toContain('dessiné en tireté (2/2)');
    (el.querySelector('[data-carte-calculee] input[type=checkbox]') as HTMLInputElement).click();
    await rendre();
    expect(r.rayonM()).toBe(0);
  });

  it('PPRT : sous le plancher → bandeau « Zoomez au niveau 8 » ; sinon « N périmètres dans la vue » / « N affichés sur M »', async () => {
    const { el, rendre, r } = monter();
    await rendre();
    expect(texte(el.querySelector('[data-carte-pprt]'))).not.toContain('Nature du périmètre');
    (el.querySelector('[data-carte-pprt] input[type=checkbox]') as HTMLInputElement).click();
    await rendre();
    expect(r.pprtActif()).toBe(true);
    expect(texte(el.querySelector('[data-etat-pprt]'))).toBe('664 périmètres · 87 départements sur 88 — recensé le 19/09/2026');
    r.pprtEtat.set({ sousLePlancher: true, rendus: 0, total: 0 });
    await rendre();
    expect(texte(el.querySelector('[data-plancher-pprt]')))
      .toBe("Zoomez au niveau 8 pour voir les périmètres — plus loin, une zone mesure moins d'un pixel.");
    r.pprtEtat.set({ sousLePlancher: false, rendus: 126, total: 126 });
    await rendre();
    expect(el.querySelector('[data-plancher-pprt]')).toBeNull();
    expect(texte(el.querySelector('[data-etat-pprt]'))).toBe('126 périmètres dans la vue');
    r.pprtEtat.set({ sousLePlancher: false, rendus: 700, total: 812 });
    await rendre();
    expect(texte(el.querySelector('[data-etat-pprt]'))).toBe('700 affichés sur 812 — les plus petits sont coupés');
  });

  it('réglages : niveaux 2/6, recensement daté ; pastilles des types estompées hors sélection, en jetons', async () => {
    const { el, rendre, r } = monter();
    r.actif.set(true);
    await rendre();
    const replis = el.querySelectorAll('mg-repli-risque');
    expect(replis).toHaveLength(2);
    expect(texte(replis[0].querySelector('button'))).toBe('+Filtrer les sites2/6');
    (replis[0].querySelector('button') as HTMLButtonElement).click();
    await rendre();
    expect(texte(replis[0])).toContain('1 327 sites Seveso en France sur 99 152 installations classées — recensé le 19/09/2026.');
    r.typesRisque.set(['toxique']);
    await rendre();
    const toxique = el.querySelector('[data-pastille-type="toxique"]') as HTMLElement;
    const autres = el.querySelector('[data-pastille-type="autres"]') as HTMLElement;
    expect(toxique.style.opacity).toBe('1');
    expect(autres.style.opacity).toBe('0.35');
    expect((toxique.firstElementChild as HTMLElement).style.background).toBe('var(--risque-toxique)');
  });
});

/** La carte qui porte le panneau : la section y vit, le module est l'enfant `risques` de sa route. */
@Component({ selector: 'mg-hote-carte', imports: [SectionRisqueComponent], template: '<mg-section-risque />' })
class HoteCarte {}

@Component({ selector: 'mg-module', template: '' })
class Module {}

describe('SectionRisqueComponent — « Analyser la population à risque → » (T13, B4)', () => {
  it("Calques › « Toxique » coché, `?risque=etape%3Drayon` dans l'URL → `carte/risques`, état gardé, natures du type", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(), SelectionsCalquesService, RisqueCarteService, RisquesIndustrielsService, PprtService,
        CouchesCarteService,
        provideRouter([{ path: 'carte', component: HoteCarte, children: [{ path: 'risques', component: Module }] }]),
        { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
        { provide: CarteApi, useValue: { pprt: () => NEVER } },
        { provide: CouleursService, useValue: { palette: () => signal({}) } },
        { provide: FABRIQUE_POPUP, useValue: () => ({}) },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/carte?risque=etape%3Drayon');
    TestBed.inject(RisqueCarteService).typesRisque.set(['toxique']);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-analyser]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    const attendu = ecrireEtatUrl({ ...ETAT_DEFAUT, etape: 'rayon', natures: naturesDesTypes(['toxique']) });
    expect(TestBed.inject(Router).url).toBe(`/carte/risques?risque=${encodeURIComponent(attendu)}`);
    // `ecrireEtatUrl` écrit `natures` avant `etape` : l'ordre de React, que l'URL partagée doit garder.
    expect(attendu.endsWith('&etape=rayon')).toBe(true);
    expect(TestBed.inject(Router).url.startsWith('/carte/risques?risque=natures%3DToxicit')).toBe(true);
  });

  it('depuis `/carte?etape=donnees` : l’étape du parcours est gardée dans l’URL du module', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(), SelectionsCalquesService, RisqueCarteService, RisquesIndustrielsService, PprtService,
        CouchesCarteService,
        provideRouter([{ path: 'carte', component: HoteCarte, children: [{ path: 'risques', component: Module }] }]),
        { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
        { provide: CarteApi, useValue: { pprt: () => NEVER } },
        { provide: CouleursService, useValue: { palette: () => signal({}) } },
        { provide: FABRIQUE_POPUP, useValue: () => ({}) },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/carte?etape=donnees');
    await harness.fixture.whenStable();
    ((harness.fixture.nativeElement as HTMLElement).querySelector('[data-analyser]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    const url = TestBed.inject(Router).url;
    expect(url.startsWith('/carte/risques?')).toBe(true);
    expect(url).toContain('etape=donnees');
  });
});

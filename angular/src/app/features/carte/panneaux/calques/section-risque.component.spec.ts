import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { SitesRisqueApi } from '../../../risques/data/sites-risque.api';
import { PprtService } from '../../couches/pprt.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { CarteApi } from '../../data/carte.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { RisqueCarteService, naturesDesTypes } from '../../etat/risque-carte.service';
import { SectionRisqueComponent } from './section-risque.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), SelectionsCalquesService, RisqueCarteService, RisquesIndustrielsService, PprtService,
      CouchesCarteService,
      { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
      { provide: CarteApi, useValue: { pprt: () => NEVER } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
    ],
  });
  const fixture = TestBed.createComponent(SectionRisqueComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, r: TestBed.inject(RisqueCarteService) };
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

  it('éteinte : seule la case, la carte PPRT, l’analyse désactivée et la provenance ; pas de zone calculée ni de réglages', async () => {
    const { el, rendre } = monter();
    await rendre();
    expect(el.querySelector('[data-carte-pprt]')).not.toBeNull();
    expect(el.querySelector('[data-carte-calculee]')).toBeNull();
    expect(el.querySelector('mg-repli-risque')).toBeNull();
    const analyser = el.querySelector('[data-analyser]') as HTMLButtonElement;
    expect(analyser.disabled).toBe(true);
    expect(analyser.title).toBe('Disponible prochainement');
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

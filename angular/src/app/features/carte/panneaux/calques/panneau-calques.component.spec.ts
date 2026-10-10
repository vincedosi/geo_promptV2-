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
import { PoisService } from '../../couches/pois.service';
import { OohService } from '../../couches/ooh.service';
import { TransportService } from '../../couches/transport.service';
import { RadioService } from '../../couches/radio.service';
import { TmjaService } from '../../couches/tmja.service';
import { RadioApi } from '../../data/radio.api';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { CarteApi } from '../../data/carte.api';
import { CiviqueApi } from '../../data/civique.api';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import { SanteService } from '../../couches/sante.service';
import { MeteoService } from '../../couches/meteo.service';
import { MeteoApi } from '../../data/meteo.api';
import { ContoursZonesService } from '../../etat/contours-zones.service';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import type { MeteoZoneChunk } from '../../logique/meteo/types';
import { PprtService } from '../../couches/pprt.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import { SitesRisqueApi } from '../../../risques/data/sites-risque.api';
import { of } from 'rxjs';

const META_METEO = {
  variable: 'temperature_2m', unit: '°C', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement', totalZones: 96, batchesTotal: 1,
  cachedAt: null, stats: { min: 8, max: 16, mean: 12, p20: 0, p40: 0, p60: 0, p80: 0, unit: '°C' },
} as const;

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      PoisService, OohService, TransportService, CataloguePoiService, TmjaService, RadioService, IndicateursCiviquesService, SanteService,
      MeteoService, ContoursZonesService,
      { provide: MeteoApi, useValue: { donnees: () => of<MeteoZoneChunk>({ status: 'done', progress: 1, total: 1, data: {}, meta: META_METEO }) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
      {
        provide: CiviqueApi,
        useValue: { geojsonVariable: () => NEVER, zones: () => of({ type: 'FeatureCollection', features: [] }), santeDepartement: () => NEVER, santeCp: () => NEVER, santeCommune: () => NEVER },
      },
      RisqueCarteService, RisquesIndustrielsService, PprtService,
      { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
      { provide: CarteApi, useValue: { categories: () => of({ categories: ['lycee'] }), urlTuilesTmja: () => '' } },
      { provide: RadioApi, useValue: { optionsFiltre: () => NEVER, emetteurs: () => NEVER } },
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
    tmja: TestBed.inject(TmjaService),
    radio: TestBed.inject(RadioService),
    civique: TestBed.inject(IndicateursCiviquesService),
    sante: TestBed.inject(SanteService),
    meteo: TestBed.inject(MeteoService),
    risque: TestBed.inject(RisqueCarteService),
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

  it('POI et mobilité, Médias offline : les vraies sections (T8) ; badges et « Actifs » suivent les sélections', async () => {
    const { el, rendre, etat, groupe } = monter();
    groupe('POI et mobilité').click();
    await rendre();
    expect(el.querySelector('mg-section-poi')).not.toBeNull();
    expect(el.querySelector('mg-section-transport')).not.toBeNull();
    expect(el.querySelector('[data-provisoire]')?.textContent ?? '').not.toContain('POI');
    etat.poiSelectionnes.set(['lycee', 'college']);
    groupe('POI et mobilité').querySelector('span')!.click();
    await rendre();
    // Le contenu reste rendu le temps d'un geste ; les sélections de transport vivent dans le panneau.
    groupe('POI et mobilité').click();
    await rendre();
    (el.querySelector('mg-section-transport mg-entete-filtre') as HTMLElement).click();
    await rendre();
    (el.querySelector('[data-type="bus"]') as HTMLButtonElement).click();
    await rendre();
    expect(groupe('POI et mobilité').querySelector('[data-compte]')!.textContent!.trim()).toBe('3');
    // Replier puis rouvrir le groupe GARDE les types de transport (état du panneau, pas de la section).
    groupe('POI et mobilité').click();
    await rendre();
    groupe('POI et mobilité').click();
    await rendre();
    expect(el.querySelector('[data-type="bus"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('POI (2)');
    expect(el.textContent).toContain('Transport (1)');
    groupe('Médias offline').click();
    await rendre();
    expect(el.querySelector('mg-section-ooh')).not.toBeNull();
    (el.querySelector('mg-section-ooh mg-entete-filtre') as HTMLElement).click();
    await rendre();
    (el.querySelector('[data-tout]') as HTMLButtonElement).click();
    await rendre();
    expect(el.textContent).toContain('OOH (8 régies)');
    expect(groupe('Médias offline').querySelector('[data-compte]')!.textContent!.trim()).toBe('8');
    (el.querySelector('[data-actif="poi"] button') as HTMLButtonElement).click();
    await rendre();
    expect(etat.poiSelectionnes()).toEqual([]);
  });

  it('T9 : TMJA dans « POI et mobilité », radio dans « Médias offline » ; « Actifs » et comptes de groupe ; les croix éteignent', async () => {
    const { el, rendre, groupe, tmja, radio } = monter();
    groupe('POI et mobilité').click();
    groupe('Médias offline').click();
    await rendre();
    expect(el.querySelector('mg-section-tmja')).not.toBeNull();
    expect(el.querySelector('mg-section-radio')).not.toBeNull();
    tmja.afficher();
    radio.basculer();
    await rendre();
    expect(el.textContent).toContain('Actifs (2)');
    expect([...el.querySelectorAll('[data-actif]')].map((a) => a.getAttribute('data-actif'))).toEqual(['tmja', 'radio']);
    expect(groupe('POI et mobilité').textContent).toContain('1');
    expect(groupe('Médias offline').textContent).toContain('1');
    (el.querySelector('[data-actif="tmja"] button') as HTMLButtonElement).click();
    (el.querySelector('[data-actif="radio"] button') as HTMLButtonElement).click();
    await rendre();
    expect([tmja.visible(), radio.visible()]).toEqual([false, false]);
  });

  it('Environnement (T10) : indicateurs civiques et santé ; compte, « Actifs » et croix ; les deux s’évincent', async () => {
    const { el, rendre, groupe, civique, sante, etat } = monter();
    groupe('Environnement').click();
    await rendre();
    expect(el.querySelector('mg-section-civique')).not.toBeNull();
    expect(el.querySelector('mg-section-sante')).not.toBeNull();
    civique.choisir('abstention_pres_2022');
    await rendre();
    expect(groupe('Environnement').querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('[data-actif="civic-indicateurs"]')!.textContent).toContain('Indicateurs civiques');
    sante.choisirJeu('pollen');
    await rendre();
    expect(civique.variable()).toBeNull();
    expect(etat.degradeActif()).toBe('civic-sante');
    expect(el.querySelector('[data-actif="civic-indicateurs"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-actif="civic-sante"] button[title="Masquer Santé environnementale"]')!.click();
    await rendre();
    expect(sante.jeu()).toBeNull();
    expect(etat.degradeActif()).toBeNull();
    expect(el.textContent).toContain('Actifs (0)');
  });

  it('Environnement (T11) : la section météo ; appliquée → compte, « Actifs » « Météo » ; la croix rend le dégradé et vide', async () => {
    const { el, rendre, groupe, meteo, etat } = monter();
    groupe('Environnement').click();
    await rendre();
    expect(el.querySelector('mg-section-meteo')).not.toBeNull();
    meteo.appliquer({ variable: 'temperature_2m', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement' });
    await rendre();
    expect(etat.degradeActif()).toBe('meteo');
    expect(groupe('Environnement').querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('[data-actif="meteo"]')!.textContent).toContain('Météo');
    el.querySelector<HTMLButtonElement>('[data-actif="meteo"] button[title="Masquer Météo"]')!.click();
    await rendre();
    expect([meteo.visible(), etat.degradeActif()]).toEqual([false, null]);
    expect(el.textContent).toContain('Actifs (0)');
  });

  it('Environnement (T12) : la section risques EN TÊTE du groupe ; sites et PPRT comptés et listés SÉPARÉMENT', async () => {
    const { el, rendre, groupe, risque } = monter();
    groupe('Environnement').click();
    await rendre();
    const contenu = groupe('Environnement').parentElement!.querySelector('[data-contenu]')!;
    expect(contenu.firstElementChild!.tagName.toLowerCase()).toBe('mg-section-risque');
    risque.actif.set(true);
    risque.pprtActif.set(true);
    await rendre();
    expect(groupe('Environnement').querySelector('[data-compte]')!.textContent!.trim()).toBe('2');
    expect(el.querySelector('[data-actif="risque-industriel"]')!.textContent).toContain('Zones à risque industriel');
    expect(el.querySelector('[data-actif="pprt"]')!.textContent).toContain('Périmètre PPRT');
    el.querySelector<HTMLButtonElement>('[data-actif="pprt"] button')!.click();
    await rendre();
    expect(risque.pprtActif()).toBe(false);
    expect(risque.actif()).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-actif="risque-industriel"] button')!.click();
    await rendre();
    expect(risque.actif()).toBe(false);
    expect(el.textContent).toContain('Actifs (0)');
  });

  it('« Santé environnementale » s’ouvre d’elle-même au PREMIER IRIS sélectionné, une seule fois', async () => {
    const { el, rendre, groupe, iris } = monter();
    groupe('Environnement').click();
    await rendre();
    expect(el.querySelector('[data-couches-sante]')).toBeNull();
    (iris as unknown as { donnees: { set(v: unknown): void } }).donnees.set({ code_iris: '130550101', code_commune: '13055', nom_commune: 'Marseille' });
    await rendre();
    expect(el.querySelector('[data-couches-sante]')).not.toBeNull();
    (el.querySelector('mg-section-sante mg-entete-filtre') as HTMLElement).click();
    await rendre();
    expect(el.querySelector('[data-couches-sante]')).toBeNull();
    (iris as unknown as { donnees: { set(v: unknown): void } }).donnees.set({ code_iris: '130550102', code_commune: '13056' });
    await rendre();
    expect(el.querySelector('[data-couches-sante]')).toBeNull();
  });
});

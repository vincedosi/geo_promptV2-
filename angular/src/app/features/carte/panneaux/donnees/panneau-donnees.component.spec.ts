import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError, type Observable } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../../carte/fabrique-carte';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { SitesRisqueApi } from '../../../risques/data/sites-risque.api';
import { CarreauxService } from '../../couches/carreaux.service';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import { IrisService } from '../../couches/iris.service';
import { MeteoService } from '../../couches/meteo.service';
import { OohService } from '../../couches/ooh.service';
import { PoisService } from '../../couches/pois.service';
import { PprtService } from '../../couches/pprt.service';
import { RadioService } from '../../couches/radio.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { SanteService } from '../../couches/sante.service';
import { TmjaService } from '../../couches/tmja.service';
import { TransportService } from '../../couches/transport.service';
import { CarreauxApi } from '../../data/carreaux.api';
import { CarteApi, type CategoriePoi } from '../../data/carte.api';
import { CiviqueApi } from '../../data/civique.api';
import { IrisApi } from '../../data/iris.api';
import { MeteoApi } from '../../data/meteo.api';
import { RadioApi } from '../../data/radio.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CaptureService } from '../../etat/capture.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { ContoursZonesService } from '../../etat/contours-zones.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { DonneesAfficheesService } from '../../etat/donnees-affichees.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import type { MeteoZoneChunk } from '../../logique/meteo/types';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { PanneauDonneesComponent } from './panneau-donnees.component';

const META_METEO = {
  variable: 'temperature_2m', unit: '°C', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement', totalZones: 96, batchesTotal: 1,
  cachedAt: null, stats: { min: 8, max: 16, mean: 12, p20: 0, p40: 0, p60: 0, p80: 0, unit: '°C' },
} as const;

const CATEGORIES: CategoriePoi[] = [{ id: 'bmw', label: 'Concessions BMW', origine: 'espace' }, { id: 'lycee', label: 'Lycées', origine: 'commune' }];

interface Options {
  categories?: CategoriePoi[];
  /** La réponse de `GET /api/map/jeux-recommandes` : un tableau de clés, ou une erreur, ou un flux laissé ouvert. */
  reco?: Observable<{ cles?: string[] }>;
}

function monter(o: Options = {}) {
  // Chaque méthode d'API de couche est espionnée : le montage n'en appelle que deux (catalogue, sélection).
  const carteApi = {
    categories: vi.fn(() => of({ categories: o.categories ?? CATEGORIES })),
    jeuxRecommandes: vi.fn(() => o.reco ?? of({ cles: [] as string[] })),
    pois: vi.fn(() => NEVER), ooh: vi.fn(() => NEVER), transport: vi.fn(() => NEVER), pprt: vi.fn(() => NEVER),
    urlTuilesTmja: vi.fn(() => ''), poiNatures: vi.fn(() => NEVER), territoryMask: vi.fn(() => NEVER),
  };
  const tuiles = { carreaux: vi.fn(() => '/api/tiles/{z}/{x}/{y}?v=19'), iris: vi.fn(() => ''), bornes: vi.fn(() => NEVER), detail: vi.fn(() => NEVER) };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideRouter([]), CaptureService, CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      PoisService, OohService, TransportService, CataloguePoiService, TmjaService, RadioService, IndicateursCiviquesService, SanteService,
      MeteoService, ContoursZonesService, RisqueCarteService, RisquesIndustrielsService, PprtService, DonneesAfficheesService,
      OutilsCarteService, PileEchapService,
      { provide: MeteoApi, useValue: { donnees: () => of<MeteoZoneChunk>({ status: 'done', progress: 1, total: 1, data: {}, meta: META_METEO }) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
      {
        provide: CiviqueApi,
        useValue: { geojsonVariable: () => NEVER, zones: () => of({ type: 'FeatureCollection', features: [] }), santeDepartement: () => NEVER, santeCp: () => NEVER, santeCommune: () => NEVER },
      },
      { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
      { provide: CarteApi, useValue: carteApi },
      { provide: RadioApi, useValue: { optionsFiltre: () => NEVER, emetteurs: () => NEVER } },
      { provide: CarreauxApi, useValue: { urlTuiles: tuiles.carreaux } },
      { provide: IrisApi, useValue: { urlTuiles: tuiles.iris, bornes: tuiles.bornes, detail: tuiles.detail } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
    ],
  });
  const fixture = TestBed.createComponent(PanneauDonneesComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  const cles = (bloc: 'espace' | 'commun') => [...el.querySelectorAll(`[data-bloc="${bloc}"] mg-ligne-jeu`)].map((l) => l.getAttribute('data-jeu'));
  const deplier = async (cle: string) => {
    el.querySelector<HTMLButtonElement>(`[data-jeu="${cle}"] button[aria-expanded]`)!.click();
    await rendre();
  };
  return {
    el, rendre, cles, deplier, carteApi, tuiles,
    carreaux: TestBed.inject(CarreauxService),
    iris: TestBed.inject(IrisService),
    etat: TestBed.inject(EtatCarteService),
    tmja: TestBed.inject(TmjaService),
    civique: TestBed.inject(IndicateursCiviquesService),
    sante: TestBed.inject(SanteService),
    meteo: TestBed.inject(MeteoService),
    risque: TestBed.inject(RisqueCarteService),
    radio: TestBed.inject(RadioService),
    outils: TestBed.inject(OutilsCarteService),
  };
}

describe('PanneauDonneesComponent — le panneau ② « Données »', () => {
  afterEach(() => localStorage.clear());

  it('montage : le catalogue et la sélection lus UNE fois chacun ; aucun autre appel d’API de couche (la recommandation ne précharge rien)', async () => {
    const { rendre, carteApi, tuiles } = monter();
    await rendre();
    expect(carteApi.categories).toHaveBeenCalledTimes(1);
    expect(carteApi.categories).toHaveBeenCalledWith(false);
    expect(carteApi.jeuxRecommandes).toHaveBeenCalledTimes(1);
    for (const m of ['pois', 'ooh', 'transport', 'pprt', 'urlTuilesTmja', 'poiNatures', 'territoryMask'] as const) {
      expect(carteApi[m], m).not.toHaveBeenCalled();
    }
    for (const [nom, f] of Object.entries(tuiles)) expect(f, nom).not.toHaveBeenCalled();
  });

  it('sélection [IRIS, Lycées] : bloc espace = Concessions BMW ; bloc commun = IRIS puis Lycées ; « Plus de données communes (7) » fermé, puis 7 lignes', async () => {
    const { el, rendre, cles } = monter({ reco: of({ cles: ['iris:socio-demo', 'poi:lycee'] }) });
    await rendre();
    expect(cles('espace')).toEqual(['poi:bmw']);
    expect(cles('commun')).toEqual(['iris:socio-demo', 'poi:lycee']);
    expect(el.querySelector('[data-bloc="commun"] [data-precision]')!.textContent!.trim()).toBe('sélection recommandée');
    const repli = el.querySelector<HTMLButtonElement>('[data-repli-autres]')!;
    expect(repli.textContent!.replace(/\s+/g, ' ').trim()).toBe('▸ Plus de données communes (7)');
    expect(repli.getAttribute('aria-expanded')).toBe('false');
    repli.click();
    await rendre();
    expect(repli.textContent!.replace(/\s+/g, ' ').trim()).toBe('▾ Plus de données communes (7)');
    expect(cles('commun')).toHaveLength(9);
    expect(cles('commun').slice(2)).toEqual([
      'carreaux:filosofi', 'civique:indicateurs-cp', 'transport:arrets', 'tmja:comptages', 'risques:icpe-pprt', 'sante:air-pollen', 'meteo:zones',
    ]);
    // Ni OOH ni radio : ils vivent dans « Autres », hors du fil (T11b).
    expect(el.querySelector('[data-jeu="ooh:panneaux"], [data-jeu="radio:emetteurs"]')).toBeNull();
  });

  it('sélection vide : 9 lignes communes, aucun repli, « aucune sélection : tout est visible »', async () => {
    const { el, rendre, cles } = monter();
    await rendre();
    expect(cles('commun')).toHaveLength(9);
    expect(el.querySelector('[data-repli-autres]')).toBeNull();
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('aucune sélection : tout est visible');
  });

  it('lecture de la sélection en échec : 9 lignes et « Sélection recommandée indisponible : tout est visible. »', async () => {
    const { el, rendre, cles } = monter({ reco: throwError(() => new Error('500')) });
    await rendre();
    expect(cles('commun')).toHaveLength(9);
    expect(el.querySelector('[data-repli-autres]')).toBeNull();
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('Sélection recommandée indisponible : tout est visible.');
  });

  it('pendant la lecture de la sélection : « Lecture de la sélection… » à la place des lignes communes', async () => {
    const reponse = new Subject<{ cles?: string[] }>();
    const { el, rendre, cles } = monter({ reco: reponse });
    await rendre();
    expect(cles('commun')).toEqual([]);
    expect(el.querySelector('[data-bloc="commun"]')!.textContent).toContain('Lecture de la sélection…');
    reponse.next({ cles: [] });
    await rendre();
    expect(cles('commun')).toHaveLength(9);
    expect(el.querySelector('[data-bloc="commun"]')!.textContent).not.toContain('Lecture de la sélection…');
  });

  it('espace sans POI propre : « Cet espace n’a importé aucune donnée. » et le bouton qui ouvre « Mes zones »', async () => {
    const { el, rendre, cles, outils } = monter({ categories: [{ id: 'lycee', label: 'Lycées', origine: 'commune' }] });
    await rendre();
    expect(cles('espace')).toEqual([]);
    const bloc = el.querySelector('[data-bloc="espace"]')!;
    expect(bloc.querySelector('mg-entete-section')!.textContent).toContain("Données de l'espace");
    expect(bloc.textContent).toContain("Cet espace n'a importé aucune donnée.");
    const zones = bloc.querySelector('[data-zones-espace]')!;
    expect(zones.textContent).toContain("Zones de l'espace : boîte à outils, « Mes zones »");
    zones.querySelector<HTMLButtonElement>('button')!.click();
    expect(outils.outil()).toBe('zones');
  });

  it('les POI se cochent : BMW puis Lycées → [bmw, lycee] ; le bouton d’affichage apparaît ; décocher BMW → [lycee]', async () => {
    const { el, rendre, etat } = monter();
    await rendre();
    expect(el.querySelector('mg-actions-poi [data-afficher-poi]')).toBeNull();
    el.querySelector<HTMLInputElement>('[data-jeu="poi:bmw"] input[type="checkbox"]')!.click();
    await rendre();
    el.querySelector<HTMLInputElement>('[data-jeu="poi:lycee"] input[type="checkbox"]')!.click();
    await rendre();
    expect(etat.poiSelectionnes()).toEqual(['bmw', 'lycee']);
    expect(el.querySelector<HTMLInputElement>('[data-jeu="poi:bmw"] input')!.checked).toBe(true);
    expect(el.querySelector('[data-jeu="poi:bmw"] [data-affiche]')).not.toBeNull();
    expect(el.querySelector('mg-actions-poi [data-afficher-poi]')).not.toBeNull();
    el.querySelector<HTMLInputElement>('[data-jeu="poi:bmw"] input[type="checkbox"]')!.click();
    await rendre();
    expect(etat.poiSelectionnes()).toEqual(['lycee']);
    expect(el.querySelector<HTMLInputElement>('[data-jeu="poi:bmw"] input')!.checked).toBe(false);
  });

  it('un référentiel se déplie sur sa section intégrée (sans en-tête interne) ; la pastille suit la couche', async () => {
    const { el, rendre, deplier, tmja } = monter();
    await rendre();
    // Replié, rien n'est instancié : la section n'est créée qu'au dépliage.
    expect(el.querySelector('mg-section-tmja')).toBeNull();
    await deplier('tmja:comptages');
    expect(el.querySelector('[data-jeu="tmja:comptages"] mg-section-tmja')).not.toBeNull();
    expect(el.querySelector('mg-section-tmja mg-entete-filtre')).toBeNull();
    expect(el.querySelector('[data-jeu="tmja:comptages"] [data-affiche]')).toBeNull();
    tmja.visible.set(true);
    await rendre();
    expect(el.querySelector('[data-jeu="tmja:comptages"] [data-affiche]')).not.toBeNull();
    await deplier('tmja:comptages');
    expect(el.querySelector('mg-section-tmja')).toBeNull();
  });

  it('chaque référentiel déplie SA section (8, sans OOH ni radio)', async () => {
    const { el, rendre, deplier } = monter();
    await rendre();
    const attendu: Record<string, string> = {
      'iris:socio-demo': 'mg-section-iris', 'carreaux:filosofi': 'mg-section-carreaux', 'civique:indicateurs-cp': 'mg-section-civique',
      'transport:arrets': 'mg-section-transport', 'tmja:comptages': 'mg-section-tmja', 'risques:icpe-pprt': 'mg-section-risque',
      'sante:air-pollen': 'mg-section-sante', 'meteo:zones': 'mg-section-meteo',
    };
    for (const [cle, section] of Object.entries(attendu)) {
      await deplier(cle);
      expect(el.querySelector(`[data-jeu="${cle}"] ${section}`), cle).not.toBeNull();
    }
    expect(el.querySelector('mg-section-ooh, mg-section-radio')).toBeNull();
    // Les six sections `integre` ne rendent pas leur en-tête : la ligne porte déjà le nom.
    expect(el.querySelector('mg-entete-filtre')).toBeNull();
  });

  it('« Chercher un jeu » « meteo » : seule la ligne Météo reste, dans son bloc ; la vider rend tout', async () => {
    const { el, rendre, cles } = monter({ reco: of({ cles: ['iris:socio-demo', 'poi:lycee'] }) });
    await rendre();
    const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
    expect(champ.getAttribute('aria-label')).toBe('Chercher un jeu');
    champ.value = 'meteo';
    champ.dispatchEvent(new Event('input'));
    await rendre();
    expect(cles('espace')).toEqual([]);
    // Météo n'est pas recommandée : elle reste rangée dans « Plus de données communes », que la recherche déplie.
    expect(cles('commun')).toEqual(['meteo:zones']);
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('sélection recommandée');
    expect(el.querySelector('[data-bloc="espace"]')!.textContent).toContain("Aucun jeu de l'espace ne correspond.");
    champ.value = '';
    champ.dispatchEvent(new Event('input'));
    await rendre();
    expect(cles('espace')).toEqual(['poi:bmw']);
    expect(cles('commun')).toEqual(['iris:socio-demo', 'poi:lycee']);
  });

  it('« Santé environnementale » se déplie d’elle-même au PREMIER IRIS sélectionné, une seule fois', async () => {
    const { el, rendre, iris, deplier } = monter();
    await rendre();
    expect(el.querySelector('mg-section-sante')).toBeNull();
    (iris as unknown as { donnees: { set(v: unknown): void } }).donnees.set({ code_iris: '130550101', code_commune: '13055', nom_commune: 'Marseille' });
    await rendre();
    expect(el.querySelector('[data-jeu="sante:air-pollen"] mg-section-sante')).not.toBeNull();
    await deplier('sante:air-pollen');
    expect(el.querySelector('mg-section-sante')).toBeNull();
    (iris as unknown as { donnees: { set(v: unknown): void } }).donnees.set({ code_iris: '130550102', code_commune: '13056' });
    await rendre();
    expect(el.querySelector('mg-section-sante')).toBeNull();
  });

  describe('« Actifs (n) » — repris de panneau-calques', () => {
    it('vide : « Actifs (0) » et « Aucun calque affiché »', async () => {
      const { el, rendre } = monter();
      await rendre();
      expect(el.textContent).toContain('Actifs (0)');
      expect(el.textContent).toContain('Aucun calque affiché');
    });

    it('carreaux : « Carreaux Filosofi », la croix les éteint ; IRIS les évince', async () => {
      const { el, rendre, carreaux, iris, etat } = monter();
      await rendre();
      carreaux.basculer(true);
      await rendre();
      expect(el.textContent).toContain('Actifs (1)');
      expect(el.querySelector('[data-actif="carreaux"]')!.textContent).toContain('Carreaux Filosofi');
      expect(el.querySelector('[data-jeu="carreaux:filosofi"] [data-affiche]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-actif="carreaux"] button[title="Masquer Carreaux Filosofi"]')!.click();
      await rendre();
      expect(carreaux.visible()).toBe(false);
      expect(etat.degradeActif()).toBeNull();
      iris.basculer(true);
      await rendre();
      expect(el.querySelector('[data-jeu="iris:socio-demo"] [data-affiche]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-actif="iris"] button[title="Masquer IRIS"]')!.click();
      await rendre();
      expect(iris.visible()).toBe(false);
      expect(el.textContent).toContain('Actifs (0)');
    });

    it('POI, transport et TMJA ; la croix des POI vide la sélection', async () => {
      const { el, rendre, etat, tmja, deplier } = monter();
      await rendre();
      etat.poiSelectionnes.set(['lycee', 'college']);
      await deplier('transport:arrets');
      el.querySelector<HTMLButtonElement>('[data-type="bus"]')!.click();
      tmja.afficher();
      await rendre();
      expect([...el.querySelectorAll('[data-actif]')].map((a) => a.getAttribute('data-actif'))).toEqual(['poi', 'transport', 'tmja']);
      expect(el.textContent).toContain('POI (2)');
      expect(el.textContent).toContain('Transport (1)');
      expect(el.textContent).toContain('Flux routier (TMJA)');
      el.querySelector<HTMLButtonElement>('[data-actif="poi"] button')!.click();
      await rendre();
      expect(etat.poiSelectionnes()).toEqual([]);
      el.querySelector<HTMLButtonElement>('[data-actif="tmja"] button')!.click();
      await rendre();
      expect(tmja.visible()).toBe(false);
    });

    it('civique, santé, météo : libellés et croix ; les dégradés s’évincent', async () => {
      const { el, rendre, civique, sante, meteo, etat } = monter();
      await rendre();
      civique.choisir('abstention_pres_2022');
      await rendre();
      expect(el.querySelector('[data-actif="civic-indicateurs"]')!.textContent).toContain('Indicateurs civiques');
      expect(el.querySelector('[data-jeu="civique:indicateurs-cp"] [data-affiche]')).not.toBeNull();
      sante.choisirJeu('pollen');
      await rendre();
      expect(el.querySelector('[data-actif="civic-indicateurs"]')).toBeNull();
      expect(el.querySelector('[data-jeu="sante:air-pollen"] [data-affiche]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-actif="civic-sante"] button[title="Masquer Santé environnementale"]')!.click();
      await rendre();
      expect(sante.jeu()).toBeNull();
      meteo.appliquer({ variable: 'temperature_2m', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement' });
      await rendre();
      expect(el.querySelector('[data-actif="meteo"]')!.textContent).toContain('Météo');
      expect(el.querySelector('[data-jeu="meteo:zones"] [data-affiche]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-actif="meteo"] button[title="Masquer Météo"]')!.click();
      await rendre();
      expect([meteo.visible(), etat.degradeActif()]).toEqual([false, null]);
      expect(el.textContent).toContain('Actifs (0)');
    });

    it('risques : sites et PPRT listés SÉPARÉMENT, une seule pastille sur la ligne ICPE et PPRT', async () => {
      const { el, rendre, risque } = monter();
      await rendre();
      risque.pprtActif.set(true);
      await rendre();
      expect(el.querySelector('[data-jeu="risques:icpe-pprt"] [data-affiche]')).not.toBeNull();
      risque.actif.set(true);
      await rendre();
      expect(el.querySelector('[data-actif="risque-industriel"]')!.textContent).toContain('Zones à risque industriel');
      expect(el.querySelector('[data-actif="pprt"]')!.textContent).toContain('Périmètre PPRT');
      el.querySelector<HTMLButtonElement>('[data-actif="pprt"] button')!.click();
      await rendre();
      expect([risque.pprtActif(), risque.actif()]).toEqual([false, true]);
      el.querySelector<HTMLButtonElement>('[data-actif="risque-industriel"] button')!.click();
      await rendre();
      expect(risque.actif()).toBe(false);
      expect(el.querySelector('[data-jeu="risques:icpe-pprt"] [data-affiche]')).toBeNull();
    });

    it('la radio allumée n’est ni un calque actif de ② ni une ligne (T11b)', async () => {
      const { el, rendre, radio } = monter();
      await rendre();
      radio.basculer();
      await rendre();
      expect(el.querySelector('[data-actif="radio"]')).toBeNull();
      expect(el.textContent).toContain('Actifs (0)');
    });
  });
});

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
import { PoisService } from '../../couches/pois.service';
import { PprtService } from '../../couches/pprt.service';
import { RadioService } from '../../couches/radio.service';
import { RisquesIndustrielsService } from '../../couches/risques-industriels.service';
import { SanteService } from '../../couches/sante.service';
import { TmjaService } from '../../couches/tmja.service';
import { TransportService } from '../../couches/transport.service';
import { CarreauxApi } from '../../data/carreaux.api';
import { CarteApi, type CategoriePoi, type ZoneData } from '../../data/carte.api';
import { CiviqueApi } from '../../data/civique.api';
import { IrisApi } from '../../data/iris.api';
import { MeteoApi } from '../../data/meteo.api';
import { RadioApi } from '../../data/radio.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CaptureService } from '../../etat/capture.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { ContoursZonesService } from '../../etat/contours-zones.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { DonneesAfficheesService } from '../../etat/donnees-affichees.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { RisqueCarteService } from '../../etat/risque-carte.service';
import { CARREAUX_INDICATEURS } from '../../logique/carreaux/catalogue';
import { JEUX_REFERENTIELS } from '../../logique/jeux-carte';
import type { IndicateurRegistre } from '../../logique/analyses/score';
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
  /** Le catalogue d'indicateurs visibles (A-7) ; par défaut un flux laissé ouvert (catalogue pas encore arrivé). */
  indicateurs?: Observable<IndicateurRegistre[]>;
}

function monter(o: Options = {}) {
  // Chaque méthode d'API de couche est espionnée : le montage n'en appelle que deux (catalogue, sélection).
  const carteApi = {
    categories: vi.fn(() => of({ categories: o.categories ?? CATEGORIES })),
    jeuxRecommandes: vi.fn(() => o.reco ?? of({ cles: [] as string[] })),
    pois: vi.fn(() => NEVER), campagnesOoh: vi.fn(() => NEVER), campagneOoh: vi.fn(() => NEVER), transport: vi.fn(() => NEVER), pprt: vi.fn(() => NEVER),
    urlTuilesTmja: vi.fn(() => ''), poiNatures: vi.fn(() => NEVER), territoryMask: vi.fn(() => NEVER), ficheJeu: vi.fn(() => NEVER),
  };
  const catalogueIndicateurs = { charger: vi.fn(() => o.indicateurs ?? NEVER) };
  // La fiche santé d'une commune (`mg-fiche-sante`) : AUCUNE lecture sans geste sur la ligne santé (relecture T13, m1).
  const santeCommune = vi.fn(() => NEVER);
  const tuiles = { carreaux: vi.fn(() => '/api/tiles/{z}/{x}/{y}?v=19'), iris: vi.fn(() => ''), bornes: vi.fn(() => NEVER), detail: vi.fn(() => NEVER) };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideRouter([]), CaptureService, CarreauxService, IrisService, EtatCarteService, CouchesCarteService, AnnonceService,
      PoisService, TransportService, CataloguePoiService, TmjaService, RadioService, IndicateursCiviquesService, SanteService,
      MeteoService, ContoursZonesService, RisqueCarteService, RisquesIndustrielsService, PprtService, DonneesAfficheesService,
      OutilsCarteService, PileEchapService,
      { provide: MeteoApi, useValue: { donnees: () => of<MeteoZoneChunk>({ status: 'done', progress: 1, total: 1, data: {}, meta: META_METEO }) } },
      { provide: FABRIQUE_POPUP, useValue: () => ({}) },
      {
        provide: CiviqueApi,
        useValue: { geojsonVariable: () => NEVER, zones: () => of({ type: 'FeatureCollection', features: [] }), santeDepartement: () => NEVER, santeCp: () => NEVER, santeCommune: santeCommune },
      },
      { provide: SitesRisqueApi, useValue: { carte: () => NEVER, exposition: () => NEVER } },
      { provide: CarteApi, useValue: carteApi },
      { provide: RadioApi, useValue: { optionsFiltre: () => NEVER, emetteurs: () => NEVER } },
      { provide: CarreauxApi, useValue: { urlTuiles: tuiles.carreaux } },
      { provide: IrisApi, useValue: { urlTuiles: tuiles.iris, bornes: tuiles.bornes, detail: tuiles.detail } },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } },
      { provide: CatalogueIndicateursService, useValue: catalogueIndicateurs },
    ],
  });
  const fixture = TestBed.createComponent(PanneauDonneesComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  const cles = (bloc: 'espace' | 'commun') => [...el.querySelectorAll(`[data-bloc="${bloc}"] mg-ligne-jeu`)].map((l) => l.getAttribute('data-jeu'));
  const deplier = async (cle: string) => {
    el.querySelector<HTMLButtonElement>(`[data-jeu="${cle}"] button[aria-expanded]:not([data-bouton-fiche])`)!.click();
    await rendre();
  };
  return {
    el, rendre, cles, deplier, carteApi, tuiles, santeCommune, catalogueIndicateurs,
    pois: TestBed.inject(PoisService),
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
    for (const m of ['pois', 'campagnesOoh', 'campagneOoh', 'transport', 'pprt', 'urlTuilesTmja', 'poiNatures', 'territoryMask'] as const) {
      expect(carteApi[m], m).not.toHaveBeenCalled();
    }
    for (const [nom, f] of Object.entries(tuiles)) expect(f, nom).not.toHaveBeenCalled();
  });

  describe('A-7 : « Indicateurs au code postal » suit les droits de l’espace', () => {
    const CIVIQUE = 'civique:indicateurs-cp';
    const abstention = (origine: 'espace' | 'commune'): IndicateurRegistre =>
      ({ indicator_code: 'abstention_pres_2022', label: 'Abstention', famille: null, origine });

    it('le catalogue d’indicateurs est demandé UNE fois au service de la page ; tant qu’il n’est pas arrivé, la ligne reste', async () => {
      const { rendre, cles, catalogueIndicateurs, carteApi } = monter();
      await rendre();
      expect(catalogueIndicateurs.charger).toHaveBeenCalledTimes(1);
      expect(cles('commun')).toContain(CIVIQUE);
      expect(carteApi.ficheJeu).not.toHaveBeenCalled();
    });

    it('aucun indicateur visible : la ligne disparaît', async () => {
      const { rendre, cles } = monter({ indicateurs: of([]) });
      await rendre();
      expect(cles('commun')).not.toContain(CIVIQUE);
      expect(cles('espace')).not.toContain(CIVIQUE);
    });

    it('catalogue en échec : la ligne reste (rien ne clignote)', async () => {
      const { rendre, cles } = monter({ indicateurs: throwError(() => new Error('boum')) });
      await rendre();
      expect(cles('commun')).toContain(CIVIQUE);
    });

    it('indicateur propre à l’espace : la ligne se range dans « Données de l’espace »', async () => {
      const { rendre, cles } = monter({ indicateurs: of([abstention('espace')]) });
      await rendre();
      expect(cles('espace')).toEqual(['poi:bmw', CIVIQUE]);
      expect(cles('commun')).not.toContain(CIVIQUE);
    });

    it('indicateur commun : la ligne reste dans les données communes', async () => {
      const { rendre, cles } = monter({ indicateurs: of([abstention('commune')]) });
      await rendre();
      expect(cles('commun')).toContain(CIVIQUE);
    });
  });

  it('sélection [IRIS, Lycées] : bloc espace = Concessions BMW ; bloc commun = IRIS puis « POI communs (1) » ; « Plus de données communes (7) » fermé, puis 7 lignes', async () => {
    const { el, rendre, cles } = monter({ reco: of({ cles: ['iris:socio-demo', 'poi:lycee'] }) });
    await rendre();
    expect(cles('espace')).toEqual(['poi:bmw']);
    // Lycées est rangé dans le sous-groupe « POI communs », fermé (retours du 26/10, T6).
    expect(cles('commun')).toEqual(['iris:socio-demo']);
    expect(el.querySelector('[data-poi-communs="recommandes"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('▸ POI communs (1)');
    expect(el.querySelector('[data-bloc="commun"] [data-precision]')!.textContent!.trim()).toBe('Sélection recommandée');
    const repli = el.querySelector<HTMLButtonElement>('[data-repli-autres]')!;
    expect(repli.textContent!.replace(/\s+/g, ' ').trim()).toBe('▸ Plus de données communes (7)');
    expect(repli.getAttribute('aria-expanded')).toBe('false');
    repli.click();
    await rendre();
    expect(repli.textContent!.replace(/\s+/g, ' ').trim()).toBe('▾ Plus de données communes (7)');
    expect(cles('commun')).toHaveLength(8);
    // Aucun POI commun dans le repli : pas de sous-groupe vide.
    expect(el.querySelector('[data-poi-communs="autres"]')).toBeNull();
    expect(cles('commun').slice(1)).toEqual([
      'carreaux:filosofi', 'civique:indicateurs-cp', 'transport:arrets', 'tmja:comptages', 'risques:icpe-pprt', 'sante:air-pollen', 'meteo:zones',
    ]);
    // Ni OOH ni radio : ils vivent dans « Autres », hors du fil (T11b).
    expect(el.querySelector('[data-jeu="ooh:panneaux"], [data-jeu="radio:emetteurs"]')).toBeNull();
  });

  it('sélection vide : 8 référentiels visibles et « POI communs (1) » fermé, aucun repli, « Aucune sélection : aucun jeu n’est mis en avant »', async () => {
    const { el, rendre, cles } = monter();
    await rendre();
    expect(cles('commun')).toHaveLength(8);
    expect(el.querySelector('[data-poi-communs="recommandes"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-repli-autres]')).toBeNull();
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('Aucune sélection : aucun jeu n’est mis en avant');
  });

  it('lecture de la sélection en échec : 8 référentiels, « POI communs (1) » et « Sélection recommandée indisponible : aucun jeu n’est mis en avant. »', async () => {
    const { el, rendre, cles } = monter({ reco: throwError(() => new Error('500')) });
    await rendre();
    expect(cles('commun')).toHaveLength(8);
    expect(el.querySelector('[data-poi-communs="recommandes"]')).not.toBeNull();
    expect(el.querySelector('[data-repli-autres]')).toBeNull();
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('Sélection recommandée indisponible : aucun jeu n’est mis en avant.');
  });

  it('pendant la lecture de la sélection : « Lecture de la sélection… » à la place des lignes communes', async () => {
    const reponse = new Subject<{ cles?: string[] }>();
    const { el, rendre, cles } = monter({ reco: reponse });
    await rendre();
    expect(cles('commun')).toEqual([]);
    expect(el.querySelector('[data-bloc="commun"]')!.textContent).toContain('Lecture de la sélection…');
    reponse.next({ cles: [] });
    await rendre();
    expect(cles('commun')).toHaveLength(8);
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
    const ouvrir = zones.querySelector<HTMLButtonElement>('button[data-ouvrir-mes-zones]')!;
    // NEUTRE, comme « Ouvrir « Mes zones » » de ③ (revue finale lots 1-2) : ni bord ni texte teal — seul le focus l'est.
    expect(ouvrir.classList).toContain('border-default');
    expect(ouvrir.classList).toContain('text-secondary');
    expect(ouvrir.className.replace('focus-visible:outline-[var(--brand-teal-50)]', '')).not.toMatch(/teal/);
    ouvrir.click();
    expect(outils.outil()).toBe('zones');
  });

  it('les POI se cochent : BMW puis Lycées → [bmw, lycee] ; le bouton d’affichage apparaît ; décocher BMW → [lycee]', async () => {
    const { el, rendre, etat } = monter();
    await rendre();
    expect(el.querySelector('mg-actions-poi [data-afficher-poi]')).toBeNull();
    el.querySelector<HTMLInputElement>('[data-jeu="poi:bmw"] input[type="checkbox"]')!.click();
    await rendre();
    // Lycées est un POI commun : on ouvre son sous-groupe pour atteindre la case (retours du 26/10, T6).
    el.querySelector<HTMLButtonElement>('[data-poi-communs="recommandes"]')!.click();
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

  it('chaque clé de JEUX_REFERENTIELS (le registre, pas une liste recopiée) déplie un [data-reglages] NON VIDE — le @switch du panneau ne peut pas en oublier une (F3)', async () => {
    const { el, rendre, deplier } = monter();
    await rendre();
    expect(JEUX_REFERENTIELS.length).toBeGreaterThan(0);
    for (const { cle } of JEUX_REFERENTIELS) {
      await deplier(cle);
      // Le premier `[data-reglages]` de la ligne est celui de `mg-ligne-jeu` (celui des carreaux, plus profond, vient après).
      const reglages = el.querySelector(`[data-jeu="${cle}"] [data-reglages]`);
      expect(reglages, cle).not.toBeNull();
      expect(reglages!.childElementCount, `${cle} : aucun @case dans le @switch de panneau-donnees`).toBeGreaterThan(0);
    }
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
    expect(el.querySelector('[data-precision]')!.textContent!.trim()).toBe('Sélection recommandée');
    expect(el.querySelector('[data-bloc="espace"]')!.textContent).toContain("Aucun jeu de l'espace ne correspond.");
    champ.value = '';
    champ.dispatchEvent(new Event('input'));
    await rendre();
    expect(cles('espace')).toEqual(['poi:bmw']);
    expect(cles('commun')).toEqual(['iris:socio-demo']);
  });

  it('premier IRIS sélectionné : la ligne santé est SIGNALÉE, pas dépliée — aucune lecture de fiche sans geste ; le dépliage la lit et éteint le signal', async () => {
    const { el, rendre, iris, deplier, santeCommune } = monter();
    await rendre();
    const donnees = (iris as unknown as { donnees: { set(v: unknown): void } }).donnees;
    expect(el.querySelector('[data-jeu="sante:air-pollen"] [data-indice]')).toBeNull();
    donnees.set({ code_iris: '130550101', code_commune: '13055', nom_commune: 'Marseille' });
    await rendre();
    expect(el.querySelector('mg-section-sante')).toBeNull();
    expect(santeCommune).not.toHaveBeenCalled();
    expect(el.querySelector('[data-jeu="sante:air-pollen"] [data-indice]')!.textContent).toContain('Marseille');
    // Une autre commune ne lit toujours rien.
    donnees.set({ code_iris: '130560101', code_commune: '13056', nom_commune: 'Martigues' });
    await rendre();
    expect(santeCommune).not.toHaveBeenCalled();
    // Le geste : déplier la ligne lit la fiche de la commune courante, et le signal s'éteint.
    await deplier('sante:air-pollen');
    expect(el.querySelector('[data-jeu="sante:air-pollen"] mg-section-sante')).not.toBeNull();
    expect(santeCommune).toHaveBeenCalledTimes(1);
    expect(santeCommune).toHaveBeenCalledWith('13056');
    expect(el.querySelector('[data-jeu="sante:air-pollen"] [data-indice]')).toBeNull();
  });

  it('réglages des carreaux (I-1, repris de panneau-calques) : visibles couche active seulement ; indicateur, palette, opacité, relief', async () => {
    const { el, rendre, carreaux, deplier } = monter();
    await rendre();
    await deplier('carreaux:filosofi');
    expect(el.querySelector('mg-section-carreaux [data-reglages]')).toBeNull();
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
    expect(el.querySelector('mg-section-carreaux')!.textContent).toContain('50%');
    expect(el.querySelector('input[data-hauteur]')).toBeNull();
    el.querySelector<HTMLButtonElement>('button[data-relief]')!.click();
    await rendre();
    expect(carreaux.relief()).toBe(true);
    expect(el.querySelector('button[data-relief]')!.textContent!.trim()).toBe('Relief 3D ✓');
    expect(el.querySelector('mg-section-carreaux')!.textContent).toContain('×1.5');
  });

  it('les types de transport choisis survivent au repli de leur ligne (I-1, repris de panneau-calques) ; la pastille suit les arrêts SUR la carte (R1)', async () => {
    const { el, rendre, deplier, pois } = monter();
    await rendre();
    await deplier('transport:arrets');
    el.querySelector<HTMLButtonElement>('[data-type="bus"]')!.click();
    await rendre();
    expect(el.querySelector('[data-type="bus"]')!.getAttribute('aria-pressed')).toBe('true');
    await deplier('transport:arrets');
    expect(el.querySelector('mg-section-transport')).toBeNull();
    await deplier('transport:arrets');
    expect(el.querySelector('[data-type="bus"]')!.getAttribute('aria-pressed')).toBe('true');
    // Des types choisis ne chargent rien : pas de pastille tant qu'aucun arrêt n'est peint.
    expect(el.querySelector('[data-jeu="transport:arrets"] [data-affiche]')).toBeNull();
    pois.definirZone({ categorie_poi: 'arret_transport', pois: [], nb_pois: 0, categories: {} } as unknown as ZoneData);
    await rendre();
    expect(el.querySelector('[data-jeu="transport:arrets"] [data-affiche]')).not.toBeNull();
  });

  it('recherche sans jeu commun : « Aucun jeu commun ne correspond. », pas de repli vide (m3)', async () => {
    const { el, rendre } = monter({ reco: of({ cles: ['iris:socio-demo'] }) });
    await rendre();
    const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
    champ.value = 'bmw';
    champ.dispatchEvent(new Event('input'));
    await rendre();
    expect(el.querySelector('[data-bloc="commun"]')!.textContent).toContain('Aucun jeu commun ne correspond.');
    expect(el.querySelector('[data-repli-autres]')).toBeNull();
    expect(el.querySelector('[data-poi-communs]')).toBeNull();
  });

  describe('sous-groupe « POI communs » (retours du 26/10, T6)', () => {
    // Le catalogue de démonstration : trois POI de source commune, aucun propre à l'espace.
    const DEMO: CategoriePoi[] = [
      { id: 'lycee', label: 'Lycées', origine: 'commune' }, { id: 'cirfa', label: 'CIRFA', origine: 'commune' },
      { id: 'bmw', label: 'Concessions BMW', origine: 'commune' },
    ];
    const texte = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();
    const chercher = async (el: HTMLElement, rendre: () => Promise<void>, q: string) => {
      const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
      champ.value = q;
      champ.dispatchEvent(new Event('input'));
      await rendre();
    };

    it('« Données communes » : les référentiels, puis « POI communs (3) » fermé ; un clic l’ouvre sur les trois cases', async () => {
      const { el, rendre, cles } = monter({ categories: DEMO });
      await rendre();
      expect(cles('commun')).toEqual(JEUX_REFERENTIELS.map((j) => j.cle));
      const sg = el.querySelector<HTMLButtonElement>('[data-bloc="commun"] [data-poi-communs="recommandes"]')!;
      expect(texte(sg)).toBe('▸ POI communs (3)');
      expect(sg.getAttribute('aria-expanded')).toBe('false');
      // Après le dernier référentiel : rien d'autre que le sous-groupe ne suit les lignes de référentiel.
      const derniere = el.querySelector(`[data-jeu="${JEUX_REFERENTIELS.at(-1)!.cle}"]`)!;
      expect(derniere.compareDocumentPosition(sg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      sg.click();
      await rendre();
      expect(texte(sg)).toBe('▾ POI communs (3)');
      expect(sg.getAttribute('aria-expanded')).toBe('true');
      expect(cles('commun').slice(JEUX_REFERENTIELS.length)).toEqual(['poi:lycee', 'poi:cirfa', 'poi:bmw']);
      for (const c of ['lycee', 'cirfa', 'bmw']) expect(el.querySelector(`[data-jeu="poi:${c}"] input[type="checkbox"]`), c).not.toBeNull();
      sg.click();
      await rendre();
      expect(el.querySelector('[data-jeu="poi:lycee"]')).toBeNull();
    });

    it('une case cochée garde le sous-groupe ouvert au rendu suivant', async () => {
      const { el, rendre, etat } = monter({ categories: DEMO });
      await rendre();
      etat.poiSelectionnes.set(['cirfa']);
      await rendre();
      expect(el.querySelector('[data-poi-communs="recommandes"]')!.getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector<HTMLInputElement>('[data-jeu="poi:cirfa"] input')!.checked).toBe(true);
    });

    it('ouvert de force par une case cochée, le bouton est aria-disabled et son clic ne bascule rien en douce (T8, m-3)', async () => {
      const { el, rendre, etat } = monter({ categories: DEMO });
      await rendre();
      etat.poiSelectionnes.set(['cirfa']);
      await rendre();
      const sg = el.querySelector<HTMLButtonElement>('[data-poi-communs="recommandes"]')!;
      expect(sg.getAttribute('aria-disabled')).toBe('true');
      sg.click();
      await rendre();
      etat.poiSelectionnes.set([]);
      await rendre();
      const apres = el.querySelector('[data-poi-communs="recommandes"]')!;
      expect(apres.getAttribute('aria-expanded')).toBe('false');
      expect(apres.hasAttribute('aria-disabled')).toBe(false);
    });

    it('la recherche « lyc » ouvre le sous-groupe et n’y montre que les lycées ; vidée, il se referme', async () => {
      const { el, rendre, cles } = monter({ categories: DEMO });
      await rendre();
      await chercher(el, rendre, 'lyc');
      const sg = el.querySelector('[data-poi-communs="recommandes"]')!;
      expect(sg.getAttribute('aria-expanded')).toBe('true');
      expect(texte(sg)).toBe('▾ POI communs (1)');
      expect(cles('commun')).toEqual(['poi:lycee']);
      await chercher(el, rendre, '');
      expect(el.querySelector('[data-poi-communs="recommandes"]')!.getAttribute('aria-expanded')).toBe('false');
    });

    it('dans « Plus de données communes », même règle : son propre sous-groupe, fermé, que la recherche ouvre', async () => {
      const { el, rendre, cles } = monter({ categories: DEMO, reco: of({ cles: ['iris:socio-demo', 'poi:cirfa'] }) });
      await rendre();
      expect(texte(el.querySelector('[data-poi-communs="recommandes"]')!)).toBe('▸ POI communs (1)');
      el.querySelector<HTMLButtonElement>('[data-repli-autres]')!.click();
      await rendre();
      const sg = el.querySelector<HTMLButtonElement>('[data-poi-communs="autres"]')!;
      expect(texte(sg)).toBe('▸ POI communs (2)');
      expect(sg.getAttribute('aria-expanded')).toBe('false');
      expect(cles('commun')).not.toContain('poi:lycee');
      sg.click();
      await rendre();
      expect(cles('commun').slice(-2)).toEqual(['poi:lycee', 'poi:bmw']);
      // L'un s'ouvre sans l'autre : un état par bloc.
      expect(el.querySelector('[data-poi-communs="recommandes"]')!.getAttribute('aria-expanded')).toBe('false');
      sg.click();
      await rendre();
      await chercher(el, rendre, 'bmw');
      expect(el.querySelector('[data-poi-communs="autres"]')!.getAttribute('aria-expanded')).toBe('true');
      expect(cles('commun')).toEqual(['poi:bmw']);
    });

    it('un bloc sans POI commun n’a pas de sous-groupe', async () => {
      const { el, rendre } = monter({ categories: [{ id: 'bmw', label: 'Concessions BMW', origine: 'espace' }] });
      await rendre();
      expect(el.querySelector('[data-poi-communs]')).toBeNull();
    });
  });

  it('« Chercher un jeu » reste collé en haut de la zone qui défile ; « Actifs » défile avec le reste (R4)', async () => {
    const { el, rendre } = monter();
    await rendre();
    const bandeau = el.querySelector('input[data-recherche]')!.parentElement!;
    expect(bandeau.classList).toContain('sticky');
    expect(bandeau.classList).toContain('top-0');
    expect(bandeau.classList).toContain('bg-surface');
    expect(el.querySelector('[data-actifs]')!.classList).not.toContain('sticky');
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
      iris.basculer(true);
      await rendre();
      expect([carreaux.visible(), iris.visible(), etat.degradeActif()]).toEqual([false, true, 'iris']);
      expect(el.querySelector('[data-jeu="carreaux:filosofi"] [data-affiche]')).toBeNull();
      iris.basculer(false);
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

  describe('tiroirs exclusifs (retours du 26/10, T7)', () => {
    it('déplier un référentiel replie l’autre', async () => {
      const { el, rendre, deplier } = monter();
      await rendre();
      await deplier('tmja:comptages');
      await deplier('meteo:zones');
      expect(el.querySelector('mg-section-tmja')).toBeNull();
      expect(el.querySelector('[data-jeu="meteo:zones"] mg-section-meteo')).not.toBeNull();
      expect(el.querySelectorAll('[data-jeu] button[aria-expanded="true"]').length).toBe(1);
    });

    it('rouvrir la ligne santé sur la même commune ne relit rien ; un filtre changé, tiroirs repliés, ne lit rien non plus', async () => {
      const { el, rendre, iris, deplier, santeCommune, carteApi, etat } = monter();
      santeCommune.mockImplementation(() => of({ data: { code_insee: '13056', commune: 'Martigues', air: null, pollen: null, source: 'test' } }) as never);
      await rendre();
      (iris as unknown as { donnees: { set(v: unknown): void } }).donnees.set({ code_iris: '130560101', code_commune: '13056', nom_commune: 'Martigues' });
      await rendre();
      await deplier('sante:air-pollen');
      expect(santeCommune).toHaveBeenCalledTimes(1);
      await deplier('tmja:comptages');
      expect(el.querySelector('mg-section-sante')).toBeNull();
      await deplier('sante:air-pollen');
      expect(el.querySelector('[data-jeu="sante:air-pollen"] mg-section-sante')).not.toBeNull();
      expect(santeCommune).toHaveBeenCalledTimes(1);
      await deplier('sante:air-pollen');
      const appels = Object.values(carteApi).reduce((n, f) => n + f.mock.calls.length, 0);
      etat.filtre.set({ type: 'departement', code: '13', label: '13 — Bouches-du-Rhône' });
      await rendre();
      expect(Object.values(carteApi).reduce((n, f) => n + f.mock.calls.length, 0)).toBe(appels);
      expect(santeCommune).toHaveBeenCalledTimes(1);
    });
  });
});

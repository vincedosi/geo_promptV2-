import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { SourcesAdminApi } from '../data/sources-admin.api';
import type { StatsTransport } from '../data/panneaux.types';
import { TransportComponent } from './transport.component';

const URL = '/api/admin/transport-stats';

/** La réponse RÉELLE du 17/10 (scoring non calculé : 0 panneau couvert), tronquée à deux villes. */
const REEL: StatsTransport = {
  success: true,
  arrets: { total: 285015, by_source: { gtfs_consolidated_france: 285015 } },
  flux: { total: 1100, by_source: { tmja_rrn_national: 1100, osm_highway_proxy: 0 } },
  panneaux: { total: 1253, avec_transport: 0, avec_flux: 0 },
  villes: [
    { ville: 'INCONNUE', nb_panneaux: 215, avec_transport: 0, transport_moyen: 0, avec_flux: 0, flux_moyen: 0, score_moyen: 0 },
    { ville: 'Paris', nb_panneaux: 51, avec_transport: 0, transport_moyen: 0, avec_flux: 0, flux_moyen: 0, score_moyen: 0 },
  ],
};

/** Scoring calculé : couvertures 95 % (transport) et 75 % (flux), pour le tableau repliable et les teintes. */
const SCORE: StatsTransport = {
  ...REEL,
  panneaux: { total: 1000, avec_transport: 950, avec_flux: 750 },
  villes: [
    { ville: 'Paris', nb_panneaux: 10, avec_transport: 10, transport_moyen: 61.5, avec_flux: 5, flux_moyen: 12.3, score_moyen: 48.2 },
    { ville: 'Lyon', nb_panneaux: 4, avec_transport: 1, transport_moyen: 3, avec_flux: 0, flux_moyen: 0, score_moyen: 1.1 },
  ],
};

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const espaces = (s: string) => s.replace(/\s/g, ' ');

describe('TransportComponent — arrêts, flux routier, scoring des panneaux par ville (lot 6, T19)', () => {
  let f: ComponentFixture<TransportComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } }],
    });
    f = TestBed.createComponent(TransportComponent);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());
  const stable = () => f.whenStable();
  const bouton = (sel: string) => el.querySelector<HTMLButtonElement>(sel)!;

  it('création : UNE lecture, « Chargement des statistiques transport... » d’ici là', async () => {
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement des statistiques transport...');
    http.expectOne(URL).flush(REEL);
    await stable();
    expect(el.querySelector('[data-chargement]')).toBeNull();
  });

  it('réponse réelle : cartes Arrêts et Flux aux textes de React, « Scoring OOH non calculé », AUCUN bouton de tableau', async () => {
    http.expectOne(URL).flush(REEL);
    await stable();
    const arrets = el.querySelector('[data-bloc="arrets"]')!;
    expect(texte(arrets.querySelector('[data-titre]'))).toBe('Arrêts de transport en commun');
    expect([...arrets.querySelectorAll('[data-ligne]')].map((l) => espaces(texte(l)))).toEqual([
      'Source: GTFS consolidé France — transport.data.gouv.fr',
      'Dataset: gtfs_consolidated_france — 285 015 arrêts',
    ]);
    expect(espaces(texte(arrets.querySelector('[data-total]')))).toBe('285 015');
    expect(texte(arrets.querySelector('[data-unite]'))).toBe('arrêts physiques');
    expect(texte(arrets.querySelector('[data-non-calcule]'))).toBe('Scoring OOH non calculé');
    const flux = el.querySelector('[data-bloc="flux"]')!;
    expect(texte(flux.querySelector('[data-titre]'))).toBe('Flux routier (TMJA)');
    expect([...flux.querySelectorAll('[data-ligne]')].map((l) => espaces(texte(l)))).toEqual([
      'CEREMA (réel): 1 100 sections',
      'OSM proxy: 0 sections',
    ]);
    expect(espaces(texte(flux.querySelector('[data-total]')))).toBe('1 100');
    expect(texte(flux.querySelector('[data-unite]'))).toBe('sections routières');
    // « masqué si scoring non calculé » (React l. 140).
    expect(el.querySelector('[data-basculer]')).toBeNull();
  });

  it('tableau repliable : déplié et replié SANS requête ; colonnes, pourcentages et teintes de React', async () => {
    http.expectOne(URL).flush(SCORE);
    await stable();
    expect(texte(el.querySelector('[data-bloc="arrets"] [data-couverture]'))).toBe('95% panneaux couverts');
    expect(espaces(texte(el.querySelector('[data-bloc="arrets"] [data-ratio]')))).toBe('(950 / 1 000)');
    expect(el.querySelector('[data-bloc="arrets"] [data-couverture]')!.getAttribute('data-niveau')).toBe('bon');
    expect(el.querySelector('[data-bloc="flux"] [data-couverture]')!.getAttribute('data-niveau')).toBe('moyen');
    expect(el.querySelector('[data-tableau]')).toBeNull();
    expect(texte(bouton('[data-basculer]'))).toBe('▼ Détails par ville (top 30)');
    bouton('[data-basculer]').click();
    await stable();
    http.expectNone(URL);
    expect(texte(bouton('[data-basculer]'))).toBe('▲ Masquer');
    expect([...el.querySelectorAll('[data-tableau] th')].map(texte)).toEqual(
      ['Ville', 'Panneaux', 'Transport %', 'Moy. transport', 'Flux %', 'Moy. flux', 'Score total'],
    );
    expect([...el.querySelectorAll('[data-tableau] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(texte))).toEqual([
      ['Paris', '10', '100%', '61.5', '50%', '12.3', '48.2'],
      ['Lyon', '4', '25%', '3', '0%', '0', '1.1'],
    ]);
    bouton('[data-basculer]').click();
    await stable();
    expect(el.querySelector('[data-tableau]')).toBeNull();
    http.expectNone(URL);
  });

  it('« Actualiser » : UNE requête de plus, le tableau reste dans son état', async () => {
    http.expectOne(URL).flush(SCORE);
    await stable();
    bouton('[data-basculer]').click();
    await stable();
    expect(texte(bouton('[data-actualiser]'))).toBe('Actualiser');
    bouton('[data-actualiser]').click();
    await stable();
    http.expectOne(URL).flush(SCORE);
    await stable();
    expect(el.querySelector('[data-tableau]')).not.toBeNull();
  });

  it('échec (500, ou `success: false`) : « Aucune donnée. » et « Charger », qui relit une fois', async () => {
    http.expectOne(URL).flush({ error: 'Lecture des panneaux impossible.' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune donnée. Charger');
    bouton('[data-vide] button').click();
    await stable();
    http.expectOne(URL).flush({ success: false, error: 'x' });
    await stable();
    expect(el.querySelector('[data-vide]')).not.toBeNull();
  });
});

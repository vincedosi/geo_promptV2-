import { CaptureService } from '../../etat/capture.service';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { PoisService } from '../../couches/pois.service';
import { BatailleService } from '../../couches/bataille.service';
import { IsochronesApi } from '../../data/isochrones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { BatailleV1Service } from '../../etat/bataille-v1.service';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import type { FiltreActif } from '../../logique/filtre';
import { PanneauAnalyseComponent } from './panneau-analyse.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { ScoreService } from '../../couches/score.service';
import { AnalysesApi } from '../../data/analyses.api';
import { ZonesCustomApi } from '../../data/zones-custom.api';

const DEPT_13: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const FRANCE: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };

async function monter(o: { filtre?: FiltreActif | null; pois?: string[] } = {}) {
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      EtatCarteService, AnnonceService, CouchesCarteService, BatailleService, IsochronesApi,
      ContexteBatailleService, BatailleV1Service, BatailleV2Service,
      // Score composite et corrélation (T18) : présents dans le panneau, sans requête tant qu'ils restent fermés.
      AnalysesApi, ZonesCustomApi,
      { provide: ScoreService, useValue: { afficher: vi.fn(), eteindre: vi.fn() } },
      { provide: AuthService, useValue: { lireProfil: () => Promise.resolve(null) } },
      { provide: PoisService, useValue: { definirZone: vi.fn() } },
      { provide: ReferentielGeoService, useValue: { regions: signal([]), charger: vi.fn() } },
    ],
  });
  const etat = TestBed.inject(EtatCarteService);
  etat.filtre.set(o.filtre ?? null);
  etat.poiSelectionnes.set(o.pois ?? ['cirfa']);
  const fixture = TestBed.createComponent(PanneauAnalyseComponent);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  const cliquer = async (sel: string) => {
    const b = el.querySelector<HTMLButtonElement>(sel);
    expect(b, `bouton introuvable : ${sel}`).not.toBeNull();
    b!.click();
    await fixture.whenStable();
  };
  return { fixture, el, etat, http: TestBed.inject(HttpTestingController), cliquer };
}

/** Ouvre l'accordéon puis l'outil voulu. */
async function ouvrirOutil(m: Awaited<ReturnType<typeof monter>>, outil: 'mg-outil-isochrones' | 'mg-outil-bataille-v2') {
  await m.cliquer('[data-accordeon="spatiale"]');
  await m.cliquer(`${outil} [data-entete-outil]`);
}

describe('PanneauAnalyseComponent (PanneauAnalyse.tsx, T17)', () => {
  it('accordéon « Analyse spatiale » fermé par défaut ; ouvert sans POI : l’encart d’accueil, sans Voronoï', async () => {
    const m = await monter({ pois: [] });
    expect(m.el.textContent).toContain('Analyse spatiale');
    expect(m.el.querySelector('[data-intro-vide]')).toBeNull();
    await m.cliquer('[data-accordeon="spatiale"]');
    expect(m.el.querySelector('[data-intro-vide]')!.textContent).toContain('Isochrones routiers');
    expect(m.el.textContent).not.toContain('Voronoï géométrique');
  });

  it('deux types de POI : « Trop de types sélectionnés », aucun outil', async () => {
    const m = await monter({ pois: ['cirfa', 'lycee'] });
    await m.cliquer('[data-accordeon="spatiale"]');
    expect(m.el.querySelector('[data-intro-trop]')!.textContent).toContain('Retirez 1 type.');
    expect(m.el.querySelector('mg-outil-isochrones')).toBeNull();
  });

  it('un type : mode de transport, Bataille V2 puis Isochrones routiers ; aucun outil Voronoï', async () => {
    const m = await monter({ filtre: DEPT_13 });
    await m.cliquer('[data-accordeon="spatiale"]');
    expect([...m.el.querySelectorAll('[data-mode]')].map((b) => b.textContent!.trim())).toEqual(['Pied', 'Velo', 'Voiture']);
    expect(m.el.querySelector('[data-mode="drive"]')!.getAttribute('aria-pressed')).toBe('true');
    const outils = [...m.el.querySelectorAll('mg-outil-bataille-v2, mg-outil-isochrones')].map((e) => e.tagName.toLowerCase());
    expect(outils).toEqual(['mg-outil-bataille-v2', 'mg-outil-isochrones']);
    expect(m.el.textContent).not.toContain('Voronoï géométrique');
  });

  it('exclusion mutuelle : ouvrir un outil ferme l’autre', async () => {
    const m = await monter({ filtre: DEPT_13 });
    await ouvrirOutil(m, 'mg-outil-bataille-v2');
    expect(m.el.querySelector('mg-outil-bataille-v2 [data-corps-outil]')).not.toBeNull();
    await m.cliquer('mg-outil-isochrones [data-entete-outil]');
    expect(m.el.querySelector('mg-outil-bataille-v2 [data-corps-outil]')).toBeNull();
    expect(m.el.querySelector('mg-outil-isochrones [data-corps-outil]')).not.toBeNull();
  });

  it('sans filtre : « Choisissez un périmètre… », ZÉRO requête, pour les deux batailles', async () => {
    const m = await monter({ filtre: null });
    await ouvrirOutil(m, 'mg-outil-isochrones');
    await m.cliquer('mg-outil-isochrones [data-lancer]');
    expect(m.el.querySelector('[data-garde]')!.textContent!.trim()).toBe('! Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    await m.cliquer('mg-outil-isochrones [data-verifier-cache]');
    await m.cliquer('mg-outil-bataille-v2 [data-entete-outil]');
    await m.cliquer('mg-outil-bataille-v2 [data-lancer]');
    await m.cliquer('mg-outil-bataille-v2 [data-verifier-cache]');
    m.http.verify();
  });

  it('filtre France : refus qui NOMME l’outil, zéro requête ; le message suit l’outil tenté', async () => {
    const m = await monter({ filtre: FRANCE });
    await ouvrirOutil(m, 'mg-outil-isochrones');
    await m.cliquer('mg-outil-isochrones [data-lancer]');
    expect(m.el.querySelector('[data-garde]')!.textContent).toContain(
      'La bataille isochrone ne peut pas être calculé sur la France entière — choisissez une région ou un département.',
    );
    await m.cliquer('mg-outil-bataille-v2 [data-entete-outil]');
    await m.cliquer('mg-outil-bataille-v2 [data-lancer]');
    expect(m.el.querySelector('[data-garde]')!.textContent).toContain('La bataille isochrone V2 ne peut pas');
    m.http.verify();
  });

  it('le message de garde s’efface dès qu’un filtre est posé', async () => {
    const m = await monter({ filtre: null });
    await ouvrirOutil(m, 'mg-outil-isochrones');
    await m.cliquer('mg-outil-isochrones [data-lancer]');
    expect(m.el.querySelector('[data-garde]')).not.toBeNull();
    m.etat.filtre.set(DEPT_13);
    await m.fixture.whenStable();
    expect(m.el.querySelector('[data-garde]')).toBeNull();
  });

  it('filtre département 13 : la bataille V1 part avec le territoire dérivé', async () => {
    const m = await monter({ filtre: DEPT_13 });
    await ouvrirOutil(m, 'mg-outil-isochrones');
    await m.cliquer('mg-outil-isochrones [data-lancer]');
    const req = m.http.expectOne('/api/isochrone-battle');
    expect(req.request.body).toMatchObject({ category: 'cirfa', mode: 'drive', durations: [10, 30], filtre_depts: ['13'], filtre_regions: null, filtre_ville: null });
    expect(m.el.querySelector('[data-garde]')).toBeNull();
  });

  it('filtre département 13 : la vérification du cache V2 part avec le territoire dérivé', async () => {
    const m = await monter({ filtre: DEPT_13 });
    await ouvrirOutil(m, 'mg-outil-bataille-v2');
    await m.cliquer('mg-outil-bataille-v2 [data-verifier-cache]');
    expect(m.http.expectOne('/api/isochrone-cache-check').request.body).toMatchObject({ paliers: [10, 20, 30, 40, 50, 60, 90], filtre_depts: ['13'] });
  });
});

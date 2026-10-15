import { CaptureService } from '../../etat/capture.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { ApercuClusteringService } from '../../couches/apercu-clustering.service';
import { ClustersService } from '../../couches/clusters.service';
import { CarteApi } from '../../data/carte.api';
import { ClusteringApi } from '../../data/clustering.api';
import { PileEchapService } from '../../etat/pile-echap.service';
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
import { ScoreService } from '../../couches/score.service';
import { AnalysesApi } from '../../data/analyses.api';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';

const DEPT_13: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const FRANCE: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };

async function monter(o: { filtre?: FiltreActif | null; pois?: string[]; role?: string | null; auth?: unknown } = {}) {
  TestBed.configureTestingModule({
    providers: [CaptureService,
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      EtatCarteService, AnnonceService, CouchesCarteService, BatailleService, IsochronesApi,
      ContexteBatailleService, BatailleV1Service, BatailleV2Service, ClusteringApi, ClustersService, PileEchapService,
      // Score composite et corrélation (T18) : présents dans le panneau, sans requête tant qu'ils restent fermés.
      AnalysesApi, ZonesCustomApi, ZonesApi,
      // L'assistant de clustering (T20) : son aperçu sur la carte, neutralisé (aucune carte ici).
      CarteApi, { provide: ApercuClusteringService, useValue: { afficher: vi.fn(), effacer: vi.fn() } },
      { provide: ScoreService, useValue: { afficher: vi.fn(), eteindre: vi.fn() } },
      { provide: PoisService, useValue: { definirZone: vi.fn() } },
      { provide: ReferentielGeoService, useValue: { regions: signal([]), charger: vi.fn() } },
      { provide: AuthService, useValue: o.auth ?? { session: signal({ user: { id: 'u-1' } }), lireProfil: async () => ({ role: o.role ?? 'client', nom: null, organisation: 'org-1' }) } },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, '#123456'])) } },
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

  it('filtre code postal ou zone : les deux batailles sont REFUSÉES, zéro requête (défaut React corrigé, registre ligne 71)', async () => {
    const m = await monter({ filtre: { type: 'cp', code: '13001', label: '13001' } });
    await ouvrirOutil(m, 'mg-outil-isochrones');
    await m.cliquer('mg-outil-isochrones [data-lancer]');
    expect(m.el.querySelector('[data-garde]')!.textContent!.trim()).toBe(
      '! La bataille isochrone ne sait pas encore se borner à un code postal — choisissez une commune, un département ou une région.',
    );
    await m.cliquer('mg-outil-isochrones [data-verifier-cache]');
    await m.cliquer('mg-outil-bataille-v2 [data-entete-outil]');
    await m.cliquer('mg-outil-bataille-v2 [data-lancer]');
    await m.cliquer('mg-outil-bataille-v2 [data-verifier-cache]');
    m.http.verify();

    m.etat.filtre.set({ type: 'zone', code: 'z-1', label: 'Ma zone' });
    await m.fixture.whenStable();
    await m.cliquer('mg-outil-bataille-v2 [data-lancer]');
    expect(m.el.querySelector('[data-garde]')!.textContent).toContain('ne sait pas encore se borner à une zone enregistrée');
    m.http.verify();

    // Un filtre que la bataille transmet lève le refus.
    m.etat.filtre.set(DEPT_13);
    await m.fixture.whenStable();
    expect(m.el.querySelector('[data-garde]')).toBeNull();
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

describe('PanneauAnalyseComponent — clustering (T19)', () => {
  /** Ouvre la section, puis le panneau de clusters (« + Nouveau clustering »), et clique « Charger les clusters ». */
  async function charger(m: Awaited<ReturnType<typeof monter>>) {
    await m.cliquer('[data-accordeon="clustering"]');
    m.http.expectOne('/api/poi-clusters/models').flush({ models: [] });
    await m.fixture.whenStable();
    await m.cliquer('[data-nouveau]');
    await m.cliquer('[data-charger]');
  }

  it('réservé au super admin : la section n’existe pas pour un client', async () => {
    const m = await monter({ role: 'client' });
    expect(m.el.querySelector('mg-section-clustering')).toBeNull();
    const admin = await monterAdmin();
    expect(admin.el.querySelector('mg-section-clustering')).not.toBeNull();
  });

  it('« Charger les clusters » sans périmètre : « Choisissez un périmètre… », aucune requête de clusters', async () => {
    const m = await monterAdmin({ filtre: null });
    await charger(m);
    expect(m.el.querySelector('[data-garde]')!.textContent!.trim()).toBe('! Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    m.http.expectNone('/api/poi-clusters?duration=60');
  });

  it('« Charger les clusters » sur la France entière : la relecture d’un modèle n’est PAS refusée (garde générique, comme React)', async () => {
    const m = await monterAdmin({ filtre: FRANCE });
    await charger(m);
    m.http.expectOne('/api/poi-clusters?duration=60');
    expect(m.el.querySelector('[data-garde]')).toBeNull();
  });

  it('le rôle suit la SESSION : un changement de compte (super admin → client) retire la section sans remonter le panneau', async () => {
    const session = signal<{ user: { id: string } } | null>({ user: { id: 'admin' } });
    const roles: Record<string, string> = { admin: 'super_admin', autre: 'client' };
    const m = await monter({ auth: { session, lireProfil: async () => ({ role: roles[session()!.user.id], nom: null, organisation: 'org-1' }) } });
    await m.fixture.whenStable();
    expect(m.el.querySelector('mg-section-clustering')).not.toBeNull();
    session.set({ user: { id: 'autre' } });
    await m.fixture.whenStable();
    await m.fixture.whenStable();
    expect(m.el.querySelector('mg-section-clustering')).toBeNull();
  });

  async function monterAdmin(o: { filtre?: FiltreActif | null } = {}) {
    TestBed.resetTestingModule();
    const m = await monter({ ...o, role: 'super_admin' });
    await m.fixture.whenStable();
    return m;
  }
});

describe('PanneauAnalyseComponent — assistant de clustering (T20)', () => {
  /** Ouvre l'assistant, coche « bmw », passe le périmètre (aucune région), et clique « Lancer » à l'étape 3. */
  async function lancerAssistant(m: Awaited<ReturnType<typeof monter>>) {
    await m.cliquer('[data-accordeon="clustering"]');
    m.http.expectOne('/api/poi-clusters/models').flush({ models: [] });
    await m.fixture.whenStable();
    await m.cliquer('[data-nouveau]');
    await m.cliquer('[data-assistant]');
    m.http.expectOne('/api/poi-clusters/poi-types').flush({ types: [{ type: 'bmw', total: 177, clustered: 0, has_clusters: false }] });
    await m.fixture.whenStable();
    await m.cliquer('[data-type-poi="bmw"]');
    await m.cliquer('[data-suivant]');
    await m.cliquer('[data-suivant]');
    m.http.expectOne((r) => r.url === '/api/poi-clusters/count').flush({ count: 177 });
    await m.fixture.whenStable();
    await m.cliquer('[data-lancer]');
  }

  async function monterAdmin(filtre: FiltreActif | null) {
    const m = await monter({ filtre, role: 'super_admin' });
    await m.fixture.whenStable();
    return m;
  }

  it('filtre « France entière » : refus NOMMÉ, affiché dans l’assistant et en tête du panneau — zéro POST', async () => {
    const m = await monterAdmin(FRANCE);
    await lancerAssistant(m);
    const refus = '! Le clustering ne peut pas être calculé sur la France entière — choisissez une région ou un département.';
    expect(m.el.querySelector('[data-erreur-lancement]')!.textContent!.trim()).toBe(refus);
    expect(m.el.querySelector('[data-garde]')!.textContent!.trim()).toBe(refus);
    m.http.expectNone('/api/poi-clusters/run');
  });

  it('sans filtre : « Choisissez un périmètre… », zéro POST', async () => {
    const m = await monterAdmin(null);
    await lancerAssistant(m);
    expect(m.el.querySelector('[data-erreur-lancement]')!.textContent!.trim()).toBe('! Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    m.http.expectNone('/api/poi-clusters/run');
  });

  it('filtre département : le POST part, au corps de React, et l’assistant passe à l’étape 4', async () => {
    const m = await monterAdmin(DEPT_13);
    await lancerAssistant(m);
    const req = m.http.expectOne('/api/poi-clusters/run');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      poi_types: ['bmw'], geo_filter: { metropolitaine: true, regions: [], depts: [] },
      params: { duration: 60, transport: 'drive', dry_run: false }, features: null,
    });
    req.flush({ job_id: 'job-1' }, { status: 201, statusText: 'Created' });
    m.http.expectOne('/api/poi-clusters/run?job_id=job-1').flush({ status: 'pending' });
    await m.fixture.whenStable();
    expect(m.el.textContent).toContain('4 / 4 — Exécution');
    expect(m.el.querySelector('[data-garde]')).toBeNull();
    m.fixture.destroy();
  });
});

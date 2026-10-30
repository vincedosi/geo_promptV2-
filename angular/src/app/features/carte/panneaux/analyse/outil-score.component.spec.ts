import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfigService } from '../../../../core/config/config.service';
import { BatailleService } from '../../couches/bataille.service';
import { ClustersService } from '../../couches/clusters.service';
import { PoisService } from '../../couches/pois.service';
import { ScoreService } from '../../couches/score.service';
import { AnalysesApi } from '../../data/analyses.api';
import { ClusteringApi } from '../../data/clustering.api';
import { IsochronesApi } from '../../data/isochrones.api';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { BatailleV2Service } from '../../etat/bataille-v2.service';
import { CaptureService } from '../../etat/capture.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ZoneAnalyseeService } from '../../etat/zone-analysee.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import type { FiltreActif } from '../../logique/filtre';
import { PanneauAnalyseComponent } from './panneau-analyse.component';
import { fournisseursCouvertureFactices } from '../../testing/couverture-factice';

const DEPT_13: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const FRANCE: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
const CATALOGUE = [
  { indicator_code: 'rev_median', label: 'Revenu médian', famille: 'Revenus', unit: '€' },
  { indicator_code: 'part_15_29', label: 'Part des 15-29 ans', famille: 'Âge', unit: '%' },
];
const RESULTAT_13 = {
  scores: [{ code: '13001', score: 82.5, n_indicateurs: 2 }, { code: '13002', score: 64, n_indicateurs: 2 }, { code: '13003', score: 71, n_indicateurs: 1 }],
  indicateurs: [
    { code: 'rev_median', label: 'Revenu médian', calcule_le: '2026-09-13T10:00:00Z' },
    { code: 'part_15_29', label: 'Part des 15-29 ans', calcule_le: null },
  ],
  perimetre: { n_codes_postaux: 127, n_scores: 127, n_complets: 120 },
};

async function monter(filtre: FiltreActif | null) {
  const score = { afficher: vi.fn(), eteindre: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), ...fournisseursCouvertureFactices(),
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      // Fourni par la page carte : la couverture y lit `revisionZones` (preuve T9, D-1).
      { provide: OutilsCarteService, useValue: { revisionZones: signal(0) } },
      EtatCarteService, AnnonceService, CouchesCarteService, CaptureService, BatailleService, IsochronesApi, AnalysesApi, ZonesCustomApi, ZonesApi,
      // Fourni par la PAGE carte (lot 3, X4) : le test tient le rôle de la page.
      CatalogueIndicateursService,
      ContexteBatailleService, BatailleV2Service,
      { provide: ScoreService, useValue: score },
      { provide: AuthService, useValue: { session: signal(null), lireProfil: () => Promise.resolve({ organisation: 'org-1' }) } },
      // Le clustering (T19) : section absente pour ce compte (aucune session de super admin).
      { provide: ClustersService, useValue: { charger: vi.fn() } },
      // Le job de l'assistant de clustering (T20), fourni par le panneau : jamais lancé ici.
      { provide: ClusteringApi, useValue: {} },
      { provide: PoisService, useValue: { definirZone: vi.fn() } },
      { provide: ReferentielGeoService, useValue: { regions: signal([]), charger: vi.fn() } },
    ],
  });
  TestBed.inject(EtatCarteService).filtre.set(filtre);
  const fixture = TestBed.createComponent(PanneauAnalyseComponent);
  const el = fixture.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const rendre = () => fixture.whenStable();
  const cliquer = async (sel: string) => {
    const b = el.querySelector<HTMLButtonElement>(sel);
    expect(b, `introuvable : ${sel}`).not.toBeNull();
    b!.click();
    await rendre();
  };
  const choisir = async (sel: string, valeur: string) => {
    const s = el.querySelector<HTMLSelectElement>(sel)!;
    s.value = valeur;
    s.dispatchEvent(new Event('change'));
    await rendre();
  };
  /** Ouvre l'outil, sert le catalogue, ajoute rev_median et part_15_29. */
  const preparer = async () => {
    await rendre();
    await cliquer('mg-outil-score [data-entete-outil]');
    http.expectOne((r) => r.url.endsWith('/api/cibles/indicators')).flush({ indicators: CATALOGUE });
    await rendre();
    await choisir('mg-outil-score [data-ajouter]', 'rev_median');
    await choisir('mg-outil-score [data-ajouter]', 'part_15_29');
  };
  const zone = TestBed.inject(ZoneAnalyseeService).zoneId as WritableSignal<string | null>;
  return { el, http, score, zone, rendre, cliquer, choisir, preparer, etat: TestBed.inject(EtatCarteService) };
}

describe('Outil « Score composite » (ScoreCompositeTool.tsx, T18)', () => {
  it('fermé : aucune requête ; ouvert : le catalogue UNE fois, même après repli et réouverture', async () => {
    const m = await monter(DEPT_13);
    await m.rendre();
    m.http.verify();
    await m.preparer();
    expect([...m.el.querySelectorAll('mg-outil-score [data-indicateur]')].map((e) => e.getAttribute('data-indicateur'))).toEqual(['rev_median', 'part_15_29']);
    expect(m.el.querySelector('mg-outil-score')!.textContent).toContain('Indicateurs (2/6)');
    await m.cliquer('mg-outil-score [data-entete-outil]');
    await m.cliquer('mg-outil-score [data-entete-outil]');
    m.http.verify();
  });

  it('département 13, deux indicateurs : corps exact, couche peinte, résumé « scorés sur » et partiels', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    const req = m.http.expectOne((r) => r.url.endsWith('/api/analyses/score'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'croissant' }],
      perimetre: { type: 'departement', code: '13' },
      enregistrer: false,
      nom: 'Score composite — Bouches-du-Rhône',
    });
    expect(m.el.querySelector('mg-outil-score [data-calculer]')!.textContent!.trim()).toBe('Calcul…');
    req.flush(RESULTAT_13);
    await m.rendre();
    expect(m.score.afficher).toHaveBeenCalledWith({
      scores: RESULTAT_13.scores, libelle: 'Revenu médian × Part des 15-29 ans', nIndicateurs: 2,
    });
    const resume = m.el.querySelector('mg-outil-score [data-resume]')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(resume).toBe('127 codes postaux scorés sur 127 7 partiels (indicateur manquant sur ces CP)');
    expect([...m.el.querySelectorAll('mg-outil-score [data-dates] > div')].map((d) => d.textContent!.trim()))
      .toEqual(['Revenu médian · 13/09/2026', 'Part des 15-29 ans · —']);
    // Seuil par défaut 70 : 82,5 et 71.
    expect(m.el.querySelector('mg-outil-score [data-retenus]')!.textContent!.trim()).toBe('2 codes postaux retenus');
    m.http.verify();
  });

  it('« Enregistrer dans Mes analyses » coché : `enregistrer: true`', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-enregistrer]');
    await m.cliquer('mg-outil-score [data-calculer]');
    expect(m.http.expectOne((r) => r.url.endsWith('/api/analyses/score')).request.body.enregistrer).toBe(true);
  });

  it('filtre France : ADMIS (seul outil national), périmètre `france` envoyé', async () => {
    const m = await monter(FRANCE);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    expect(m.el.querySelector('[data-garde]')).toBeNull();
    expect(m.http.expectOne((r) => r.url.endsWith('/api/analyses/score')).request.body.perimetre).toEqual({ type: 'france', code: 'france' });
  });

  it('sans filtre : le message de garde du panneau, aucune requête de calcul', async () => {
    const m = await monter(null);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    expect(m.el.querySelector('[data-garde]')!.textContent!.trim()).toBe('! Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
    m.http.verify();
  });

  it('un réglage modifié PÉRIME le résultat : résumé retiré, score éteint', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    m.http.expectOne((r) => r.url.endsWith('/api/analyses/score')).flush(RESULTAT_13);
    await m.rendre();
    m.score.eteindre.mockClear();
    await m.cliquer('mg-outil-score [data-indicateur="part_15_29"] [data-pastille="decroissant"]');
    expect(m.el.querySelector('mg-outil-score [data-resume]')).toBeNull();
    expect(m.score.eteindre).toHaveBeenCalledTimes(1);
  });

  it('erreur de la route : son message, en rouge', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    m.http.expectOne((r) => r.url.endsWith('/api/analyses/score'))
      .flush({ error: 'Périmètre vide : aucun code postal à scorer.' }, { status: 400, statusText: 'Bad Request' });
    await m.rendre();
    expect(m.el.querySelector('mg-outil-score [data-erreur]')!.textContent!.trim()).toBe('Périmètre vide : aucun code postal à scorer.');
  });

  it('« Créer la zone » : route source puis sauvegarde, message « Zone créée — N codes postaux. »', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    m.http.expectOne((r) => r.url.endsWith('/api/analyses/score')).flush(RESULTAT_13);
    await m.rendre();
    await m.cliquer('mg-outil-score [data-creer-zone]');
    const source = m.http.expectOne((r) => r.url.endsWith('/api/custom-geo/source/score'));
    expect(source.request.body).toEqual({
      indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'croissant' }],
      codes_postaux: ['13001', '13002', '13003'],
      seuil: 70,
    });
    const geometrie = { type: 'MultiPolygon', coordinates: [] };
    source.flush({ geometry: geometrie, count: 2, codes: ['13001', '13003'], scale: 'cp' });
    // Lot 3 : POST /api/zones avec la recette figée `capture` (source `score`) et sa géométrie ; ③ finitions (T5,
    // V-6) : la recette garde sa provenance (indicateurs, maille, seuil).
    const save = m.http.expectOne((r) => r.url.endsWith('/api/zones'));
    expect(save.request.body).toEqual({
      nom: 'Score ≥ 70 — Revenu médian × Part des 15-29 ans',
      recette: {
        v: 1, type: 'capture', source_type: 'score',
        parametres: {
          indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'croissant' }],
          maille: 'cp', seuil_score: 70,
        },
      },
      geometrie,
    });
    save.flush({ zone_id: 'z1', count_cp: 2 });
    await m.rendre();
    expect(m.el.querySelector('mg-outil-score [data-message-zone]')!.textContent!.trim()).toBe('Zone créée — 2 codes postaux.');
  });

  it('« Créer la zone » refusée : « Sélection trop large (N CP). Remontez le seuil. »', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    m.http.expectOne((r) => r.url.endsWith('/api/analyses/score')).flush(RESULTAT_13);
    await m.rendre();
    await m.cliquer('mg-outil-score [data-creer-zone]');
    m.http.expectOne((r) => r.url.endsWith('/api/custom-geo/source/score'))
      .flush({ error: 'selection_too_large', count: 1834, max: 1500 }, { status: 400, statusText: 'Bad Request' });
    await m.rendre();
    expect(m.el.querySelector('mg-outil-score [data-message-zone]')!.textContent!.trim()).toBe('Sélection trop large (1 834 CP). Remontez le seuil.');
    m.http.verify();
  });

  it('un réglage modifié PENDANT le calcul l’annule : l’ancien résultat ne revient pas (revue 1)', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    await m.cliquer('mg-outil-score [data-calculer]');
    const req = m.http.expectOne((r) => r.url.endsWith('/api/analyses/score'));
    await m.cliquer('mg-outil-score [data-indicateur="part_15_29"] [data-pastille="decroissant"]');
    expect(req.cancelled).toBe(true);
    expect(m.el.querySelector('mg-outil-score [data-calculer]')!.textContent!.trim()).toBe('Calculer le score');
    expect(m.el.querySelector('mg-outil-score [data-resume]')).toBeNull();
    expect(m.score.afficher).not.toHaveBeenCalled();
  });

  it('sans zone analysée : aucune bascule « Sur : »', async () => {
    const m = await monter(DEPT_13);
    await m.preparer();
    expect(m.el.querySelector('mg-outil-score mg-choix-sur-zone')).toBeNull();
  });

  it('zone analysée : « Sur » = la zone par défaut, sans filtre de ① ; la bascule rend le périmètre de ①', async () => {
    const m = await monter(null);
    m.zone.set('z-1');
    await m.preparer();
    const pressed = (v: string) => m.el.querySelector(`mg-outil-score [data-pastille="${v}"]`)!.getAttribute('aria-pressed');
    expect([pressed('zone'), pressed('filtre')]).toEqual(['true', 'false']);
    expect(m.el.querySelector('mg-outil-score')!.textContent).not.toContain('filtre actif');
    await m.cliquer('mg-outil-score [data-calculer]');
    expect(m.el.querySelector('[data-garde]')).toBeNull();
    const req = m.http.expectOne((r) => r.url.endsWith('/api/analyses/score'));
    expect(req.request.body.perimetre).toEqual({ type: 'zone', code: 'z-1' });
    req.flush(RESULTAT_13);
    await m.rendre();
    // Revenir au périmètre de ① retire le résultat de la zone ; sans filtre posé, la garde parle.
    await m.cliquer('mg-outil-score [data-pastille="filtre"]');
    expect(m.el.querySelector('mg-outil-score [data-resume]')).toBeNull();
    expect(m.el.querySelector('mg-outil-score')!.textContent).toContain('filtre actif');
    await m.cliquer('mg-outil-score [data-calculer]');
    expect(m.el.querySelector('[data-garde]')).not.toBeNull();
    m.http.expectNone((r) => r.url.endsWith('/api/analyses/score'));
  });
});

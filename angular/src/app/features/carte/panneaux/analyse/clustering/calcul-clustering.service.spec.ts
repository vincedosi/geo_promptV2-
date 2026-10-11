import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CorpsLancementClustering } from '../../../logique/clustering/assistant';
import { CalculClusteringService } from './calcul-clustering.service';
import { MODELES, fournisseursClustering } from './testing/clustering-factice';

const CORPS: CorpsLancementClustering = {
  poi_types: ['bmw'], geo_filter: { metropolitaine: true, regions: ['32'], depts: ['59', '62'] },
  params: { duration: 15, transport: 'drive', dry_run: false }, features: null,
};
const SONDAGE = '/api/poi-clusters/run?job_id=job-1234567890';

function monter() {
  TestBed.configureTestingModule({ providers: [...fournisseursClustering(), provideHttpClientTesting()] });
  return { calcul: TestBed.inject(CalculClusteringService), http: TestBed.inject(HttpTestingController) };
}

/** Lance, et rend le job créé (201). */
function lancer(m: ReturnType<typeof monter>) {
  m.calcul.lancer(CORPS);
  const req = m.http.expectOne('/api/poi-clusters/run');
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toEqual(CORPS);
  req.flush({ job_id: 'job-1234567890' }, { status: 201, statusText: 'Created' });
}

describe('CalculClusteringService (ClusteringWizard.tsx:176-250)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sondage pending → running → done : un tic toutes les 3 s, arrêt au statut final, liste des modèles relue', () => {
    const m = monter();
    lancer(m);
    expect(m.calcul.jobId()).toBe('job-1234567890');
    m.http.expectOne(SONDAGE).flush({ status: 'pending', log_tail: null });
    expect(m.calcul.statut()).toBe('pending');
    vi.advanceTimersByTime(2999);
    m.http.expectNone(SONDAGE);
    vi.advanceTimersByTime(1);
    m.http.expectOne(SONDAGE).flush({ status: 'running', log_tail: '[1/6] BMW Lille — 15min — ORS en cours…' });
    expect(m.calcul.journal()).toContain('BMW Lille');
    expect(m.calcul.termine()).toBe(false);
    vi.advanceTimersByTime(3000);
    m.http.expectOne(SONDAGE).flush({ status: 'done', log_tail: '=== RÉSUMÉ cache-isochrones ===' });
    expect(m.calcul.termine()).toBe(true);
    m.http.expectOne('/api/poi-clusters/models').flush({ models: MODELES });
    vi.advanceTimersByTime(30000);
    m.http.expectNone(SONDAGE);
    m.http.verify();
  });

  it('failed : arrêt, sans relire les modèles', () => {
    const m = monter();
    lancer(m);
    m.http.expectOne(SONDAGE).flush({ status: 'failed', log_tail: 'Traceback' });
    expect(m.calcul.termine()).toBe(true);
    m.http.expectNone('/api/poi-clusters/models');
    vi.advanceTimersByTime(9000);
    m.http.expectNone(SONDAGE);
  });

  it('un tic en échec réseau n’arrête rien : le suivant relit', () => {
    const m = monter();
    lancer(m);
    m.http.expectOne(SONDAGE).flush(null, { status: 502, statusText: 'Bad Gateway' });
    vi.advanceTimersByTime(3000);
    m.http.expectOne(SONDAGE).flush({ status: 'running' });
    expect(m.calcul.statut()).toBe('running');
  });

  it('503 « script absent » : le message de la route, tel quel ; aucun sondage', () => {
    const m = monter();
    m.calcul.lancer(CORPS);
    m.http.expectOne('/api/poi-clusters/run').flush(
      { error: 'Moteur de clustering indisponible : le script Python est absent de ce deploiement.' }, { status: 503, statusText: 'Service Unavailable' },
    );
    expect(m.calcul.erreur()).toBe('Moteur de clustering indisponible : le script Python est absent de ce deploiement.');
    expect(m.calcul.lancement()).toBe(false);
    expect(m.calcul.jobId()).toBeNull();
    vi.advanceTimersByTime(9000);
    m.http.expectNone(SONDAGE);
  });

  it('réinitialisé en cours de sondage (assistant détruit) : plus AUCUN sondage, requête en vol annulée', () => {
    const m = monter();
    lancer(m);
    const enVol = m.http.expectOne(SONDAGE);
    m.calcul.reinitialiser();
    expect(enVol.cancelled).toBe(true);
    expect(m.calcul.jobId()).toBeNull();
    vi.advanceTimersByTime(30000);
    m.http.expectNone(SONDAGE);
  });
});

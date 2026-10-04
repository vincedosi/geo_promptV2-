import { HttpErrorResponse, HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { ConfigService } from '../../../core/config/config.service';
import { SimulationApi } from '../data/simulation.api';
import { ETAT_DEFAUT, type EtatRisque } from '../logique/etat-url';
import type { ReponseSimulation } from '../logique/simulation/payload';
import { EtatRisqueService } from './etat-risque.service';
import { MESSAGES_SIMULATION, SimulationService, messageSimulation } from './simulation.service';

const URL_A = '/api/zones/jeux/A/simulation';

/** Une réponse minimale porteuse d'une simulation : `construireVue` rend une vue, `courbeAlignement` des points. */
function reponse(statut: 'v1' | 'v2' = 'v1'): ReponseSimulation {
  return {
    simulation: {
      id: 's', campaign_id: 'c', statut, date_debut: '2026-09-24', jours: 4, jour_recalage: 3,
      params: {} as never, lignes_v1: 10, lignes_v2: 0, created_at: '',
      extraction_v1: { id: 'e1', version: 1 }, extraction_v2: statut === 'v2' ? { id: 'e2', version: 2 } : null,
    },
    entrees: [{
      code_postal: '13001', code_canonique: '13001', cluster_id: 'z', retenu: true, multiplicateur: 1,
      pop_en_zone: 100, pop_totale: 200, part_en_zone: 50, surface_km2: 1, membre: false, x: 5, y: 43,
    }],
    zones: [{ id: 'z', rang: 1, nom: 'Bassin', niveau: 'haut', n_sites: 2, pop_exposee: 100, bbox: null }],
    agregats: {
      par_cp: [{ cp: '13001', v: 1, imps: 1000, utiles: 500, spend: 4 }],
      par_zone_jour: [{ jour: 1, cid: 'z', imps: 500, utiles: 250, spend: 2 }, { jour: 2, cid: 'z', imps: 500, utiles: 250, spend: 2 }],
      par_jour: [{ jour: 1, imps: 500, utiles: 250, spend: 2, en_zone: 500 }, { jour: 2, imps: 500, utiles: 250, spend: 2, en_zone: 500 }],
      par_partenaire: [{ partenaire: 'Partenaire A', v: 1, imps: 1000, spend: 4, en_zone: 1000, utiles: 500 }],
    },
  };
}

/** Laisse filer les promesses. */
const vider = () => new Promise((r) => setTimeout(r, 0));

function creer(jeu: string | null = 'A') {
  const etat = signal<EtatRisque>({ ...ETAT_DEFAUT, jeu });
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), SimulationApi, ChargementService, SimulationService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: EtatRisqueService, useValue: { etat } },
    ],
  });
  const service = TestBed.inject(SimulationService);
  const http = TestBed.inject(HttpTestingController);
  const chargement = TestBed.inject(ChargementService);
  TestBed.tick();
  return { service, http, etat, chargement };
}

/** Ouvre ⑤ et répond à la lecture. */
async function ouvrir(c: ReturnType<typeof creer>, rep: ReponseSimulation = reponse()) {
  c.service.activer();
  TestBed.tick();
  c.http.expectOne(URL_A).flush(rep);
  await vider();
}

describe('SimulationService', () => {

  it('rien ne se charge avant la première visite de ⑤ : zéro requête, état « vide »', async () => {
    const { service, http, etat } = creer();
    etat.set({ ...ETAT_DEFAUT, jeu: 'B' });
    TestBed.tick();
    await vider();
    http.expectNone(() => true);
    expect(service.etat()).toBe('vide');
    expect(service.vue()).toBeNull();
    expect(service.courbe()).toEqual([]);
  });

  it('activer lit la simulation UNE fois ; revenir (ré-activer) ne relit rien', async () => {
    const c = creer();
    c.service.activer();
    TestBed.tick();
    expect(c.service.etat()).toBe('chargement');
    expect(c.chargement.etat().actif).toBe(true);
    c.http.expectOne(URL_A).flush(reponse());
    await vider();
    expect(c.service.etat()).toBe('pret');
    expect(c.service.vue()?.indicateurs.impressions).toBe(1000);
    expect(c.service.courbe().map((p) => p.jour)).toEqual([1, 2]);
    TestBed.tick();
    expect(c.chargement.etat().actif).toBe(false);
    c.service.activer();
    TestBed.tick();
    c.http.expectNone(URL_A);
  });

  it('une réponse d’un autre jeu est périmée : rien n’est rendu, puis la simulation du nouveau jeu est lue', async () => {
    const c = creer();
    await ouvrir(c);
    expect(c.service.reponse()).not.toBeNull();
    c.etat.set({ ...ETAT_DEFAUT, jeu: 'B' });
    TestBed.tick();
    expect(c.service.reponse()).toBeNull();
    expect(c.service.vue()).toBeNull();
    c.http.expectOne('/api/zones/jeux/B/simulation').flush({ simulation: null });
    await vider();
    expect(c.service.reponse()).toEqual({ simulation: null });
  });

  it('sans jeu : état « vide », aucune requête', async () => {
    const c = creer(null);
    c.service.activer();
    TestBed.tick();
    await vider();
    c.http.expectNone(() => true);
    expect(c.service.etat()).toBe('vide');
  });

  it('une lecture refusée rend le message de la route, en état « echec »', async () => {
    const c = creer();
    c.service.activer();
    TestBed.tick();
    c.http.expectOne(URL_A).flush({ error: 'Jeu introuvable.' }, { status: 404, statusText: 'Not Found' });
    await vider();
    expect(c.service.etat()).toBe('echec');
    expect(c.service.erreur()).toBe('Jeu introuvable.');
  });

  it('simuler : progression 0 → 50 → 100 au fil du flux, puis null et relecture ; la période passe sur v1', async () => {
    const c = creer();
    await ouvrir(c);
    c.service.periode.set('tout');
    const fini = c.service.simuler(1, { budget: 30_000 });
    expect(c.service.progression()).toEqual({ message: MESSAGES_SIMULATION.preparation, pourcentage: null });
    const req = c.http.expectOne((r) => r.method === 'POST' && r.url === URL_A);
    expect(req.request.body).toEqual({ version: 1, params: { budget: 30_000 } });
    const ins = (faites: number, pourcentage: number) =>
      JSON.stringify({ etape: 'insertion', message: 'Insertion', faites, total: 100, pourcentage });
    const l1 = JSON.stringify({ etape: 'preparation', message: 'Lecture du plan' });
    const vus: unknown[] = [];
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${l1}\n${ins(0, 0)}\n` });
    vus.push(c.service.progression());
    req.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: `${l1}\n${ins(0, 0)}\n${ins(50, 50)}\n` });
    vus.push(c.service.progression());
    req.event({ type: HttpEventType.DownloadProgress, loaded: 3, partialText: `${l1}\n${ins(0, 0)}\n${ins(50, 50)}\n${ins(100, 100)}\n` });
    vus.push(c.service.progression());
    expect(vus).toEqual([
      { message: 'Insertion', pourcentage: 0, faites: 0, total: 100 },
      { message: 'Insertion', pourcentage: 50, faites: 50, total: 100 },
      { message: 'Insertion', pourcentage: 100, faites: 100, total: 100 },
    ]);
    req.flush(`${l1}\n${ins(0, 0)}\n${ins(50, 50)}\n${ins(100, 100)}\n${JSON.stringify({ etape: 'termine', message: 'Fini', simulation_id: 's', lignes: 100, duree_ms: 5 })}`);
    await vider();
    expect(c.service.progression()).toBeNull();
    // La relecture : le flux fini, l'écran lit ce qui a été écrit.
    c.http.expectOne((r) => r.method === 'GET' && r.url === URL_A).flush(reponse());
    await fini;
    expect(c.service.periode()).toBe('v1');
    expect(c.service.etat()).toBe('pret');
    expect(c.service.erreur()).toBeNull();
  });

  it('preparation / generation : progression INDÉTERMINÉE ; la piste « simulation » porte le message du geste', async () => {
    const c = creer();
    await ouvrir(c);
    void c.service.recaler();
    TestBed.tick();
    expect(c.chargement.etat()).toMatchObject({ actif: true });
    const req = c.http.expectOne(`${URL_A}/recaler`);
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: `${JSON.stringify({ etape: 'generation', message: 'Génération', lignes: 10 })}\n` });
    expect(c.service.progression()).toEqual({ message: 'Génération', pourcentage: null });
    TestBed.tick();
    expect(c.chargement.etat().texte).toBe('Génération');
    req.flush('');
    await vider();
  });

  it('un flux terminé sur { etape: "erreur" } : erreur = son message, état « echec », aucune relecture', async () => {
    const c = creer();
    await ouvrir(c);
    const fini = c.service.simuler(1, {});
    c.http.expectOne((r) => r.method === 'POST').flush(`${JSON.stringify({ etape: 'erreur', message: 'Extraction introuvable.' })}\n`);
    await fini;
    expect(c.service.erreur()).toBe('Extraction introuvable.');
    expect(c.service.etat()).toBe('echec');
    expect(c.service.progression()).toBeNull();
    c.http.expectNone((r) => r.method === 'GET');
  });

  it('un flux qui s’arrête sans événement final est un ÉCHEC : « Le flux s’est interrompu avant la fin. »', async () => {
    const c = creer();
    await ouvrir(c);
    const fini = c.service.recaler();
    c.http.expectOne(`${URL_A}/recaler`).flush('');
    await fini;
    expect(c.service.erreur()).toBe(MESSAGES_SIMULATION.interrompu);
    expect(c.service.etat()).toBe('echec');
    expect(c.service.periode()).toBe('tout');
  });

  it('un POST refusé (409, corps en TEXTE) rend le champ `error` de la route', async () => {
    const c = creer();
    await ouvrir(c);
    const fini = c.service.recaler();
    c.http.expectOne(`${URL_A}/recaler`).flush(JSON.stringify({ error: 'Simulation déjà recalée.' }), { status: 409, statusText: 'Conflict' });
    await fini;
    expect(c.service.erreur()).toBe('Simulation déjà recalée.');
  });

  it('purger : progression indéterminée, DELETE puis relecture ; un refus garde l’état et dit « Purge impossible. »', async () => {
    const c = creer();
    await ouvrir(c);
    let fini = c.service.purger();
    expect(c.service.progression()).toEqual({ message: MESSAGES_SIMULATION.purgeEnCours, pourcentage: null });
    c.http.expectOne((r) => r.method === 'DELETE').flush({ ok: true });
    await vider();
    c.http.expectOne((r) => r.method === 'GET').flush({ simulation: null });
    await fini;
    expect(c.service.progression()).toBeNull();
    expect(c.service.vue()).toBeNull();

    fini = c.service.purger();
    c.http.expectOne((r) => r.method === 'DELETE').flush('x', { status: 500, statusText: 'Erreur' });
    await fini;
    expect(c.service.erreur()).toBe(MESSAGES_SIMULATION.purge);
    expect(c.service.etat()).toBe('pret');
  });

  it('messageSimulation : JSON objet, JSON en texte, texte illisible, statut 0', () => {
    const e = (error: unknown, status = 400) => new HttpErrorResponse({ error, status });
    expect(messageSimulation(e({ error: 'A' }), 'd')).toBe('A');
    expect(messageSimulation(e('{"error":"B"}'), 'd')).toBe('B');
    expect(messageSimulation(e('<html>'), 'd')).toBe('d');
    expect(messageSimulation(e(null, 0), 'd')).toBe('d');
    expect(messageSimulation(new Error('x'), 'd')).toBe('d');
  });
});

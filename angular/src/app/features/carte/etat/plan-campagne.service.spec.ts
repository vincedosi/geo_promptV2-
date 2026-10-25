import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { PlanApi } from '../data/plan.api';
import { DEFAULT_PROG_DRAFT } from '../logique/plan/brouillon';
import {
  DELAI_AUTOSAVE_MS, MESSAGE_CAMPAGNE_INTROUVABLE, MESSAGE_RESERVE_ADMIN, PlanCampagneService, messageErreurCampagnes,
} from './plan-campagne.service';

const C1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const C2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const S1 = '16fd2706-8baf-433b-82eb-8c7fada847da';
const B1 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const J1 = '6ba7b811-9dad-41d1-80b4-00c04fd430c8';

const campagne = (id: string, name: string) => ({
  campaign: { id, name, advertiser: 'Annonceur', product: null, date_start: '2026-11-01', date_end: null, organization_id: 'o', is_demo: true },
});
const canaux = { catalog: [], connectedProviders: [], is_demo: true, selected: { dsps: ['dv360'], socials: [], ad_server: null, budgets: { dv360: 1000 } } };
const strategie = { id: S1, campaign_id: C1, status: 'active', objective_code: 'maximize_impressions', execution_mode: 'suggest',
  start_date: '2026-11-02', end_date: '2026-11-30', total_budget: 1000, forecast_cpm: 4, kpi_target: null, in_zone_weights: {} };

@Component({ selector: 'mg-hote-plan', template: '<router-outlet />', providers: [PlanCampagneService], imports: [RouterOutlet] })
class Hote { readonly plan = inject(PlanCampagneService); }

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'carte', component: Hote }]),
      provideHttpClient(), provideHttpClientTesting(), PlanApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const hote = await harness.navigateByUrl(url, Hote);
  const stable = async () => { await attendre(); await harness.fixture.whenStable(); };
  await stable();
  return { hote, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router), stable };
}

type Ouvert = Awaited<ReturnType<typeof ouvrir>>;

/** Répond à la SEULE requête en vol (le préremplissage est séquentiel), puis laisse la suivante partir. */
async function repondre(o: Ouvert, url: string, corps: object, status = 200) {
  const enVol = o.http.match(() => true);
  expect(enVol.map((r) => r.request.urlWithParams)).toEqual([url]);
  if (status === 200) enVol[0].flush(corps);
  else enVol[0].flush(corps, { status, statusText: 'Erreur' });
  await o.stable();
}

/** Le préremplissage complet de C1 : stratégie existante, brouillon serveur `drafts`, canaux stockés. */
async function preremplirC1(o: Ouvert, drafts: object[] = []) {
  await repondre(o, `/api/admin/campaigns/${C1}?page=1`, campagne(C1, 'Rentrée'));
  await repondre(o, `/api/bidding/strategies?campaign_id=${C1}`, { strategies: [{ id: S1, name: 's', campaign_id: C1, status: 'active', created_at: '' }] });
  await repondre(o, `/api/bidding/strategies/${S1}`, { strategy: strategie });
  await repondre(o, `/api/bidding/strategies/drafts?campaign_id=${C1}`, { drafts });
  await repondre(o, `/api/campaigns/${C1}/channels`, canaux);
}

afterEach(() => vi.useRealTimers());

describe('PlanCampagneService — la campagne dans l’URL', () => {
  it('sans ?campagne= : rien de lu, brouillon par défaut', async () => {
    const o = await ouvrir('/carte');
    expect(o.hote.plan.campagne()).toBeNull();
    expect(o.hote.plan.brouillon()).toEqual(DEFAULT_PROG_DRAFT);
    o.http.verify();
  });

  it('?campagne= : préremplissage SÉQUENTIEL campagne → stratégie → brouillon → canaux, une requête à la fois', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    expect(o.hote.plan.prerempli()).toBe(false);
    await preremplirC1(o);
    const b = o.hote.plan.brouillon();
    expect(b).toMatchObject({
      name: 'Rentrée', advertiser: 'Annonceur', startDate: '2026-11-02', endDate: '2026-11-30', forecastCpm: 4, executionMode: 'suggest',
      channels: { dsps: ['dv360'], socials: [], ad_server: null }, channelBudgets: { dv360: 1000 },
    });
    expect(o.hote.plan.strategieExistante()).toEqual({ id: S1, statut: 'active' });
    expect(o.hote.plan.prerempli()).toBe(true);
    expect(o.hote.plan.restaure()).toBeNull();
    o.http.verify();
  });

  it('une valeur illisible est retirée de l’URL ; choisirCampagne l’écrit', async () => {
    const o = await ouvrir('/carte?campagne=pas-un-uuid');
    expect(o.hote.plan.campagne()).toBeNull();
    expect(o.router.url).toBe('/carte');
    o.hote.plan.choisirCampagne(C1);
    await o.stable();
    expect(o.router.url).toBe(`/carte?campagne=${C1}`);
    o.http.expectOne(`/api/admin/campaigns/${C1}?page=1`);
  });

  it('campagne introuvable (404) : message, paramètre retiré, rien d’autre de lu', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await repondre(o, `/api/admin/campaigns/${C1}?page=1`, { error: 'Campagne introuvable' }, 404);
    expect(o.hote.plan.erreur()).toBe(MESSAGE_CAMPAGNE_INTROUVABLE);
    expect(o.hote.plan.campagne()).toBeNull();
    expect(o.router.url).toBe('/carte');
    o.http.verify();
  });

  it('campagne d’un autre espace (canaux en 404, checkCampaignAccess) : même message, paramètre retiré', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await repondre(o, `/api/admin/campaigns/${C1}?page=1`, campagne(C1, 'Ailleurs'));
    await repondre(o, `/api/bidding/strategies?campaign_id=${C1}`, { strategies: [] });
    await repondre(o, `/api/bidding/strategies/drafts?campaign_id=${C1}`, { drafts: [] });
    await repondre(o, `/api/campaigns/${C1}/channels`, { error: 'campaign_not_found' }, 404);
    expect(o.hote.plan.erreur()).toBe(MESSAGE_CAMPAGNE_INTROUVABLE);
    expect(o.router.url).toBe('/carte');
  });
});

describe('PlanCampagneService — changement de campagne en cours de lecture', () => {
  it('la lecture de A est annulée, sa réponse tardive ne s’écrit jamais dans B', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await repondre(o, `/api/admin/campaigns/${C1}?page=1`, campagne(C1, 'A'));
    const strategiesDeA = o.http.expectOne(`/api/bidding/strategies?campaign_id=${C1}`);
    await o.router.navigateByUrl(`/carte?campagne=${C2}`);
    await o.stable();
    expect(strategiesDeA.cancelled).toBe(true);
    expect(o.hote.plan.brouillon().name).toBe('');
    await repondre(o, `/api/admin/campaigns/${C2}?page=1`, campagne(C2, 'B'));
    expect(o.hote.plan.campagne()).toBe(C2);
    expect(o.hote.plan.brouillon().name).toBe('B');
  });
});

describe('PlanCampagneService — brouillon serveur et autosave', () => {
  const restaure = {
    id: B1, campaign_id: C1, current_step: 3, last_saved_at: '2026-10-25T10:00:00Z', expires_at: null, created_at: '',
    draft_data: { v: 1, draft: {
      ...DEFAULT_PROG_DRAFT, name: '', forecastCpm: 9, startDate: '2026-12-01', pressure: 2.8, objective: 'maximize_clicks',
      cibles: [{ id: 'z', name: 'Zone', sourceType: 'custom' }], pacing: 'back_loaded', channelLinks: { dv360: { advertiser_id: '1' } },
    } },
  };

  it('le brouillon PRIME sur la stratégie ; l’identité n’en complète que les champs vides ; étape restaurée', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await preremplirC1(o, [restaure]);
    expect(o.hote.plan.brouillon()).toMatchObject({ name: 'Rentrée', forecastCpm: 9, startDate: '2026-12-01', executionMode: 'auto' });
    expect(o.hote.plan.restaure()).toEqual({ savedAt: '2026-10-25T10:00:00Z' });
    expect(o.hote.plan.etape()).toBe(3);
  });

  it('l’autosave n’écrit rien pendant ni à la fin du préremplissage ; un geste écrit UNE fois après le délai', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    o.hote.plan.modifier((d) => ({ ...d, name: 'Trop tôt' }));
    await preremplirC1(o);
    vi.useFakeTimers();
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS * 2);
    o.http.expectNone('/api/bidding/strategies/drafts');

    o.hote.plan.modifier((d) => ({ ...d, product: 'P1' }));
    o.hote.plan.modifier((d) => ({ ...d, product: 'P2' }));
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS - 1);
    o.http.expectNone('/api/bidding/strategies/drafts');
    vi.advanceTimersByTime(1);
    const req = o.http.expectOne('/api/bidding/strategies/drafts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ campaign_id: C1, current_step: 1, draft_data: { v: 1, draft: { product: 'P2' } } });
    req.flush({ draft: { id: B1, current_step: 1, last_saved_at: '2026-10-25T11:00:00Z' } });
    expect(o.hote.plan.sauveLe()).toBe('2026-10-25T11:00:00Z');
  });

  it('les champs hors V1 d’un brouillon React repartent tels quels à l’aller-retour', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await preremplirC1(o, [restaure]);
    vi.useFakeTimers();
    o.hote.plan.modifier((d) => ({ ...d, cpmPrevus: { dv360: 4.5 } }));
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS);
    const envoye = o.http.expectOne('/api/bidding/strategies/drafts').request.body.draft_data.draft;
    expect(envoye).toMatchObject({
      pressure: 2.8, objective: 'maximize_clicks', pacing: 'back_loaded', cibles: [{ id: 'z', name: 'Zone', sourceType: 'custom' }],
      channelLinks: { dv360: { advertiser_id: '1' } }, cpmPrevus: { dv360: 4.5 },
    });
  });

  it('repartirDeZero : le brouillon serveur est supprimé, le défaut repart avec l’identité, rien n’est ressauvé', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await preremplirC1(o, [restaure]);
    vi.useFakeTimers();
    o.hote.plan.repartirDeZero();
    expect(o.http.expectOne(`/api/bidding/strategies/drafts/${B1}`).request.method).toBe('DELETE');
    expect(o.hote.plan.brouillon()).toEqual({ ...DEFAULT_PROG_DRAFT, name: 'Rentrée', advertiser: 'Annonceur', startDate: '2026-11-01' });
    expect(o.hote.plan.restaure()).toBeNull();
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS * 2);
    o.http.expectNone('/api/bidding/strategies/drafts');
  });

  it('changer de campagne arrête une sauvegarde programmée', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await preremplirC1(o);
    vi.useFakeTimers();
    o.hote.plan.modifier((d) => ({ ...d, name: 'X' }));
    o.hote.plan.choisirCampagne(C2);
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS * 2);
    o.http.expectNone('/api/bidding/strategies/drafts');
  });
});

describe('PlanCampagneService — relecture 1', () => {
  it.each([401, 403])('%i sur la campagne (réservée au super_admin) : préremplissage TERMINÉ, message, paramètre gardé, aucune écriture', async (status) => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await repondre(o, `/api/admin/campaigns/${C1}?page=1`, { error: 'Accès réservé' }, status);
    expect(o.hote.plan.prerempli()).toBe(true);
    expect(o.hote.plan.accesRefuse()).toBe(true);
    expect(o.hote.plan.erreur()).toBe(MESSAGE_RESERVE_ADMIN);
    expect(o.hote.plan.campagne()).toBe(C1);
    expect(o.router.url).toBe(`/carte?campagne=${C1}`);
    vi.useFakeTimers();
    o.hote.plan.modifier((d) => ({ ...d, name: 'X' }));
    o.hote.plan.definirEtape(3);
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS * 2);
    o.http.verify();
  });

  it('repartirDeZero pendant une sauvegarde en vol : l’identifiant n’est pas repris, la ligne recréée est supprimée', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await preremplirC1(o);
    vi.useFakeTimers();
    o.hote.plan.modifier((d) => ({ ...d, name: 'X' }));
    vi.advanceTimersByTime(DELAI_AUTOSAVE_MS);
    const enVol = o.http.expectOne('/api/bidding/strategies/drafts');
    o.hote.plan.repartirDeZero();
    // Aucun identifiant connu encore : rien à supprimer avant le retour de la sauvegarde.
    o.http.expectNone(`/api/bidding/strategies/drafts/${B1}`);
    enVol.flush({ draft: { id: B1, current_step: 1, last_saved_at: '2026-10-25T11:00:00Z' } });
    expect(o.http.expectOne(`/api/bidding/strategies/drafts/${B1}`).request.method).toBe('DELETE');
    expect(o.hote.plan.sauveLe()).toBeNull();
    // Un second « Repartir de zéro » ne connaît aucun brouillon : la sauvegarde rejetée n'a pas reposé son identifiant.
    o.hote.plan.repartirDeZero();
    o.http.expectNone(`/api/bidding/strategies/drafts/${B1}`);
  });

  it('repartirDeZero pendant la lecture du brouillon serveur : il n’est pas restauré par-dessus', async () => {
    const o = await ouvrir(`/carte?campagne=${C1}`);
    await repondre(o, `/api/admin/campaigns/${C1}?page=1`, campagne(C1, 'Rentrée'));
    await repondre(o, `/api/bidding/strategies?campaign_id=${C1}`, { strategies: [] });
    o.hote.plan.repartirDeZero();
    await repondre(o, `/api/bidding/strategies/drafts?campaign_id=${C1}`, { drafts: [{
      id: B1, campaign_id: C1, current_step: 4, last_saved_at: '2026-10-25T10:00:00Z', expires_at: null, created_at: '',
      draft_data: { v: 1, draft: { ...DEFAULT_PROG_DRAFT, name: 'Jeté', forecastCpm: 9 } },
    }] });
    await repondre(o, `/api/campaigns/${C1}/channels`, canaux);
    expect(o.hote.plan.brouillon()).toMatchObject({ name: 'Rentrée', forecastCpm: null });
    expect(o.hote.plan.restaure()).toBeNull();
    expect(o.hote.plan.etape()).toBe(1);
    expect(o.hote.plan.prerempli()).toBe(true);
  });
});

describe('PlanCampagneService — CP d’une extraction', () => {
  it('lus une fois par (jeu, version, plateforme), gardés à travers un changement de campagne', async () => {
    const o = await ouvrir('/carte');
    o.hote.plan.chargerCp(J1, 2, 'dv360');
    o.hote.plan.chargerCp(J1, 2, 'dv360');
    const r = { cp: [{ code_postal: '13001', multiplicateur: 1 }], total: 1 };
    o.http.expectOne(`/api/zones/jeux/${J1}/extractions/2/cp?plateforme=dv360`).flush(r);
    expect(o.hote.plan.cpDe(J1, 2, 'dv360')).toEqual(r);
    expect(o.hote.plan.cpDe(J1, 2)).toBeNull();
    o.hote.plan.chargerCp(J1, 2, 'dv360');
    o.http.expectNone(`/api/zones/jeux/${J1}/extractions/2/cp?plateforme=dv360`);

    o.hote.plan.chargerCp(J1, 2);
    o.http.expectOne(`/api/zones/jeux/${J1}/extractions/2/cp`).flush({ error: 'Ce jeu de zones n’a pas de version 2.' }, { status: 404, statusText: 'x' });
    expect(o.hote.plan.erreurCp(J1, 2)).toBe('Ce jeu de zones n’a pas de version 2.');
  });
});

describe('PlanCampagneService — créer une campagne (hall et sélecteur, T3)', () => {
  it('« Nouvelle campagne » : POST sans nom, puis la coquille est OUVERTE (URL et préremplissage)', async () => {
    const o = await ouvrir('/carte');
    let creee: { id: string; name: string } | null = null;
    o.hote.plan.creerCampagne().subscribe((c) => { creee = c; });
    const req = o.http.expectOne('/api/admin/campaigns');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ campaign: { id: C1, name: 'Nouvelle campagne — 25/10/2026' } });
    await o.stable();
    expect(creee).toEqual({ id: C1, name: 'Nouvelle campagne — 25/10/2026' });
    expect(o.hote.plan.campagne()).toBe(C1);
    expect(o.router.url).toContain(`campagne=${C1}`);
    o.http.expectOne(`/api/admin/campaigns/${C1}?page=1`);
  });

  it('messageErreurCampagnes : 401/403 → réservé aux administrateurs ; le reste → le message de l’API', () => {
    const e = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });
    expect(messageErreurCampagnes(e(403))).toBe(MESSAGE_RESERVE_ADMIN);
    expect(messageErreurCampagnes(e(401))).toBe(MESSAGE_RESERVE_ADMIN);
    expect(messageErreurCampagnes(e(500, { error: 'Base indisponible' }))).toBe('Base indisponible');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { PlanApi } from './plan.api';

const C = '0f8fad5b-d9cb-469f-a165-70867728950e';
const J = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const X = '16fd2706-8baf-433b-82eb-8c7fada847da';
const BASE = 'https://hote.example/distant';

function preparer(apiBaseUrl = BASE) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), PlanApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl } } }],
  });
  return { api: TestBed.inject(PlanApi), http: TestBed.inject(HttpTestingController) };
}

/** Appelle, vérifie la méthode, l'adresse et le corps, rend la réponse. */
function attendre(http: HttpTestingController, methode: string, url: string, corps?: unknown) {
  const req = http.expectOne(url);
  expect(req.request.method).toBe(methode);
  if (corps !== undefined) expect(req.request.body).toEqual(corps);
  req.flush({});
}

describe('PlanApi — adresses sur HttpBaseService.baseUrl, jamais écrites en dur', () => {
  it('campagnes : liste, création (nom facultatif), détail ?page=1, identité, suppression, organisations', () => {
    const { api, http } = preparer();
    api.campagnes().subscribe();
    attendre(http, 'GET', `${BASE}/api/admin/campaigns`);
    api.creerCampagne().subscribe();
    attendre(http, 'POST', `${BASE}/api/admin/campaigns`, {});
    api.creerCampagne('Rentrée').subscribe();
    attendre(http, 'POST', `${BASE}/api/admin/campaigns`, { name: 'Rentrée' });
    api.campagne(C).subscribe();
    attendre(http, 'GET', `${BASE}/api/admin/campaigns/${C}?page=1`);
    api.modifierCampagne(C, { name: 'N', advertiser: '', product: null }).subscribe();
    attendre(http, 'PATCH', `${BASE}/api/admin/campaigns/${C}`, { name: 'N', advertiser: '', product: null });
    api.supprimerCampagne('a/b').subscribe();
    attendre(http, 'DELETE', `${BASE}/api/admin/campaigns/a%2Fb`);
    api.organisationsCampagne(C).subscribe();
    attendre(http, 'GET', `${BASE}/api/admin/campaigns/${C}/organizations`);
    http.verify();
  });

  it('canaux : GET et PUT /api/campaigns/<id>/channels, CPM prévus compris', () => {
    const { api, http } = preparer('');
    api.canaux(C).subscribe();
    attendre(http, 'GET', `/api/campaigns/${C}/channels`);
    const corps = { dsps: ['dv360'], socials: [], ad_server: null, budgets: { dv360: 1000 }, cpm_prevus: { dv360: 4.5 } };
    api.ecrireCanaux(C, corps).subscribe();
    attendre(http, 'PUT', `/api/campaigns/${C}/channels`, corps);
    http.verify();
  });

  it('stratégie : liste, lecture, PATCH partiel', () => {
    const { api, http } = preparer();
    api.strategies(C).subscribe();
    attendre(http, 'GET', `${BASE}/api/bidding/strategies?campaign_id=${C}`);
    api.strategie(J).subscribe();
    attendre(http, 'GET', `${BASE}/api/bidding/strategies/${J}`);
    api.modifierStrategie(J, { total_budget: 1500, kpi_target: 450000 }).subscribe();
    attendre(http, 'PATCH', `${BASE}/api/bidding/strategies/${J}`, { total_budget: 1500, kpi_target: 450000 });
    http.verify();
  });

  it('brouillons : liste par campagne, upsert, lecture, suppression', () => {
    const { api, http } = preparer();
    api.brouillons(C).subscribe();
    attendre(http, 'GET', `${BASE}/api/bidding/strategies/drafts?campaign_id=${C}`);
    const corps = { campaign_id: C, current_step: 2, draft_data: { v: 1, draft: {} } };
    api.sauverBrouillon(corps).subscribe();
    attendre(http, 'POST', `${BASE}/api/bidding/strategies/drafts`, corps);
    api.brouillon(X).subscribe();
    attendre(http, 'GET', `${BASE}/api/bidding/strategies/drafts/${X}`);
    api.supprimerBrouillon(X).subscribe();
    attendre(http, 'DELETE', `${BASE}/api/bidding/strategies/drafts/${X}`);
    http.verify();
  });

  it('DV360 : la cascade par paramètres ; un identifiant de campagne DV360 sans annonceur n’est pas envoyé', () => {
    const { api, http } = preparer();
    api.ressourcesDv360(C).subscribe();
    attendre(http, 'GET', `${BASE}/api/dsp/dv360/resources?campaignId=${C}`);
    api.ressourcesDv360(C, '12', '34').subscribe();
    attendre(http, 'GET', `${BASE}/api/dsp/dv360/resources?campaignId=${C}&advertiserId=12&dv360CampaignId=34`);
    api.ressourcesDv360(C, undefined, '34').subscribe();
    attendre(http, 'GET', `${BASE}/api/dsp/dv360/resources?campaignId=${C}`);
    http.verify();
  });

  it('mode démo : lecture et bascule', () => {
    const { api, http } = preparer();
    api.modeDemo().subscribe();
    attendre(http, 'GET', `${BASE}/api/user/demo-mode`);
    api.basculerModeDemo(true).subscribe();
    attendre(http, 'POST', `${BASE}/api/user/demo-mode`, { on: true });
    http.verify();
  });

  it('T1 : rattacher une extraction, lire ses CP (par plateforme si demandé)', () => {
    const { api, http } = preparer();
    api.rattacher(J, { campagne: C, extraction: X }).subscribe();
    attendre(http, 'POST', `${BASE}/api/zones/jeux/${J}/rattacher`, { campagne: C, extraction: X });
    api.cpExtraction(J, 2).subscribe();
    attendre(http, 'GET', `${BASE}/api/zones/jeux/${J}/extractions/2/cp`);
    api.cpExtraction(J, 2, 'dv360').subscribe();
    attendre(http, 'GET', `${BASE}/api/zones/jeux/${J}/extractions/2/cp?plateforme=dv360`);
    http.verify();
  });
});

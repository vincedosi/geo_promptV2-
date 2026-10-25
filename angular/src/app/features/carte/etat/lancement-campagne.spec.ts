import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { type Campagne, PlanApi, type PlanRattache } from '../data/plan.api';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from '../logique/plan/brouillon';
import { previsions, totauxPrevus } from '../logique/plan/impressions';
import { type DemandeLancement, EchecLancement, type EntreesLancement, etatLancement, lancerCampagne, messageLancement } from './lancement-campagne';

const C = '0f8fad5b-d9cb-469f-a165-70867728950e';
const J = '16fd2706-8baf-433b-82eb-8c7fada847da';
const X = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const S = '6ba7b811-9dad-41d1-80b4-00c04fd430c8';

const DETAIL: Campagne = { id: C, name: 'Rentrée', advertiser: null, product: null, date_start: null, date_end: null, organization_id: 'o', is_demo: true };
const PRET: ProgDraft = {
  ...DEFAULT_PROG_DRAFT,
  name: 'Rentrée 2026', advertiser: 'Marque',
  jeuZones: { id: J, nom: 'Lyon', version: 2, extraction: { id: X, version: 3 } },
  channels: { dsps: ['dv360'], socials: ['meta'], ad_server: null },
  channelBudgets: { dv360: 10000, meta: 3000, ttd: 50 },
  cpmPrevus: { dv360: 4, meta: 6 },
  channelLinks: { dv360: { advertiser_id: '1' } },
  startDate: '2026-11-01', endDate: '2026-11-30',
};

function entrees(d: ProgDraft = PRET, o: Partial<EntreesLancement> = {}): EntreesLancement {
  const p = previsions([...d.channels.dsps, ...d.channels.socials], d.channelBudgets, d.cpmPrevus ?? {});
  return { campagne: C, detail: DETAIL, brouillon: d, previsions: p, totaux: totauxPrevus(p), liaisonsConfirmees: true, libelle: (c) => c.toUpperCase(), ...o };
}

describe('etatLancement — la validité de React restreinte au chemin extraction (T6, A-10)', () => {
  it('prêt : la demande porte EXACTEMENT les totaux affichés (kpi_target, forecast_cpm pondéré, total_budget)', () => {
    const e = entrees();
    const { demande } = etatLancement(e);
    expect(demande).not.toBeNull();
    expect(demande!.strategie).toEqual({
      total_budget: e.totaux.budget, forecast_cpm: e.totaux.cpmMoyen, kpi_target: e.totaux.impressions,
      start_date: '2026-11-01', end_date: '2026-11-30',
    });
    // 10 000 ÷ 4 × 1 000 + 3 000 ÷ 6 × 1 000 = 3 000 000 ; 13 000 ÷ 3 000 000 × 1 000 = 4,33.
    expect(demande!.strategie).toMatchObject({ total_budget: 13000, kpi_target: 3000000, forecast_cpm: 4.33 });
    expect(demande!.identite).toEqual({ name: 'Rentrée 2026', advertiser: 'Marque' });
    // Budgets et CPM élagués à la sélection (ttd n'est plus cochée).
    expect(demande!.canaux).toEqual({ dsps: ['dv360'], socials: ['meta'], ad_server: null, budgets: { dv360: 10000, meta: 3000 }, cpm_prevus: { dv360: 4, meta: 6 }, links: { dv360: { advertiser_id: '1' } } });
    expect(demande).toMatchObject({ campagne: C, jeu: J, extraction: X });
  });

  it('CPM manquant : lancement bloqué, la plateforme nommée', () => {
    const r = etatLancement(entrees({ ...PRET, cpmPrevus: { dv360: 4 } }));
    expect(r.demande).toBeNull();
    expect(r.motifs).toEqual(['CPM prévu manquant : META']);
  });

  it('chaque motif de blocage est dit, dans l’ordre de l’écran', () => {
    const d = { ...DEFAULT_PROG_DRAFT, channels: { dsps: ['dv360'], socials: [], ad_server: null } };
    const r = etatLancement(entrees(d, { detail: { ...DETAIL, name: '' }, liaisonsConfirmees: false }));
    expect(r.motifs).toEqual([
      'Choisis une extraction en section Cible.', 'Nom de la campagne manquant.', 'Budget manquant : DV360',
      'CPM prévu manquant : DV360', 'Période incomplète.', 'Confirme les liaisons en section Plateformes et budget.',
    ]);
    expect(etatLancement(entrees({ ...PRET, endDate: '2026-10-01' })).motifs).toEqual(['La fin de la période précède son début.']);
    expect(etatLancement(entrees({ ...PRET, channels: { dsps: [], socials: [], ad_server: null } })).motifs).toEqual(['Choisis au moins un DSP ou un réseau.']);
  });

  it('plus de 9 999 999 999 impressions (kpi_target numeric(14,4)) : bloqué (relecture 3, M1)', () => {
    const r = etatLancement(entrees({ ...PRET, channelBudgets: { dv360: 10_000_000, meta: 3000 }, cpmPrevus: { dv360: 0.5, meta: 6 } }));
    expect(r.motifs).toEqual(['Plus de 9 999 999 999 impressions prévues : vérifie budgets et CPM.']);
  });

  it('identité inchangée : pas de PATCH de campagne', () => {
    const d = { ...PRET, name: 'Rentrée', advertiser: '' };
    expect(etatLancement(entrees(d)).demande!.identite).toBeNull();
  });
});

describe('lancerCampagne — un seul chemin, séquentiel (T6, A-9, E2)', () => {
  const rattache: PlanRattache = {
    jeu: J, version: 2, strategie: S, codes_postaux: 1234, mode_plan: 'pondere', part_plan_en_zone: 77.9, taux_utile: 80.04,
    n_retenus: 1000, anciennes_archivees: true, extraction: X, extraction_version: 3,
  };

  function monter() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PlanApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } }],
    });
    return { api: TestBed.inject(PlanApi), http: TestBed.inject(HttpTestingController) };
  }
  const demande = (): DemandeLancement => etatLancement(entrees()).demande!;

  it('PATCH identité → rattacher → PATCH stratégie → PUT canaux, une requête à la fois', () => {
    const { api, http } = monter();
    const d = demande();
    let fini: PlanRattache | null = null;
    lancerCampagne(api, d).subscribe((r) => { fini = r; });
    const ordre: string[] = [];
    const repondre = (corps: object) => {
      const enVol = http.match(() => true);
      expect(enVol).toHaveLength(1);
      ordre.push(`${enVol[0].request.method} ${enVol[0].request.url}`);
      const req = enVol[0];
      req.flush(corps);
      return req.request.body as unknown;
    };
    expect(repondre({ success: true })).toEqual({ name: 'Rentrée 2026', advertiser: 'Marque' });
    expect(repondre(rattache)).toEqual({ campagne: C, extraction: X });
    // E2 : les valeurs envoyées sont EXACTEMENT les totaux affichés.
    expect(repondre({ strategy: {} })).toEqual({ total_budget: 13000, forecast_cpm: 4.33, kpi_target: 3000000, start_date: '2026-11-01', end_date: '2026-11-30' });
    expect(repondre({ ok: true })).toEqual(d.canaux);
    expect(ordre).toEqual([
      `PATCH /api/admin/campaigns/${C}`, `POST /api/zones/jeux/${J}/rattacher`, `PATCH /api/bidding/strategies/${S}`, `PUT /api/campaigns/${C}/channels`,
    ]);
    expect(fini).toEqual(rattache);
    http.verify();
  });

  it('échec de rattacher : ni PATCH de stratégie ni PUT de canaux ; l’erreur porte le message de la route', () => {
    const { api, http } = monter();
    let erreur: unknown = null;
    lancerCampagne(api, { ...demande(), identite: null }).subscribe({ error: (e: unknown) => { erreur = e; } });
    http.expectOne(`/api/zones/jeux/${J}/rattacher`).flush({ error: 'Ce jeu de zones ne couvre aucun code postal.' }, { status: 409, statusText: 'Conflict' });
    http.verify();
    expect(erreur).toBeInstanceOf(EchecLancement);
    expect(erreur).toMatchObject({ titre: 'Rattachement impossible', message: 'Ce jeu de zones ne couvre aucun code postal.' });
  });

  it('échec du PATCH de stratégie : pas de PUT ; « Budget et période non enregistrés » (relecture 3, M6)', () => {
    const { api, http } = monter();
    let erreur: unknown = null;
    lancerCampagne(api, { ...demande(), identite: null }).subscribe({ error: (e: unknown) => { erreur = e; } });
    http.expectOne(`/api/zones/jeux/${J}/rattacher`).flush(rattache);
    http.expectOne(`/api/bidding/strategies/${S}`).flush({ error: 'numeric field overflow' }, { status: 500, statusText: 'Erreur' });
    http.verify();
    expect(erreur).toMatchObject({ titre: 'Budget et période non enregistrés', message: 'numeric field overflow' });
  });

  it('échec du PUT des canaux : « Plateformes non enregistrées » (relecture 3, M6)', () => {
    const { api, http } = monter();
    let erreur: unknown = null;
    lancerCampagne(api, { ...demande(), identite: null }).subscribe({ error: (e: unknown) => { erreur = e; } });
    http.expectOne(`/api/zones/jeux/${J}/rattacher`).flush(rattache);
    http.expectOne(`/api/bidding/strategies/${S}`).flush({ strategy: {} });
    http.expectOne(`/api/campaigns/${C}/channels`).flush({ error: 'Canal inconnu : x' }, { status: 400, statusText: 'Erreur' });
    http.verify();
    expect(erreur).toMatchObject({ titre: 'Plateformes non enregistrées', message: 'Canal inconnu : x' });
  });

  it('échec du PATCH d’identité : rien d’autre ne part', () => {
    const { api, http } = monter();
    let erreur: unknown = null;
    lancerCampagne(api, demande()).subscribe({ error: (e: unknown) => { erreur = e; } });
    http.expectOne(`/api/admin/campaigns/${C}`).flush({ error: 'Nom déjà pris.' }, { status: 409, statusText: 'Conflict' });
    http.verify();
    expect(erreur).toMatchObject({ titre: 'Renommage impossible', message: 'Nom déjà pris.' });
  });
});

describe('messageLancement', () => {
  const r = { codes_postaux: 1234, part_plan_en_zone: 77.94, taux_utile: 80.04 } as PlanRattache;
  it('N codes postaux · X % du plan en zone · Y % d’utile · Z impressions prévues', () => {
    expect(messageLancement(r, 3000000).replace(/\s/g, ' ')).toBe('1 234 codes postaux · 78 % du plan en zone · 80,0 % d’utile · 3 000 000 impressions prévues');
  });
  it('0 CP (aucune plateforme au CP) : dit, sans « 0 codes postaux »', () => {
    expect(messageLancement({ ...r, codes_postaux: 0 }, 500000).replace(/\s/g, ' '))
      .toBe('Aucune plateforme n’achète au code postal : plan sans répartition par CP · 500 000 impressions prévues');
  });
});

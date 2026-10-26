import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ActivationApi, type CorpsPoussee, type LigneFlux, type Prevol } from '../data/activation.api';
import { type ExtractionJeu, JeuxApi } from '../data/jeux.api';
import { ActivationCampagneService, messagePoussee } from './activation-campagne.service';
import { PlanCampagneService } from './plan-campagne.service';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Le plan de la page, réduit aux signaux que ⑦ lit ; `valider` simule la fin du préremplissage (espace vérifié). */
function fauxPlan() {
  const campagne = signal<string | null>(null);
  const prerempli = signal(false);
  const detail = signal<{ id: string } | null>(null);
  const extraction = signal<ExtractionJeu | null>(null);
  const brouillon = signal<{ jeuZones: { id: string; extraction: { id: string; version: number } | null } | null }>({ jeuZones: null });
  return {
    campagne, prerempli, detail, extraction, brouillon,
    accesRefuse: signal(false),
    strategieExistante: signal<{ id: string } | null>(null),
    canaux: signal<{ selected: { dsps: string[]; socials: string[] } } | null>({ selected: { dsps: ['dv360'], socials: [] } }),
    retenirExtractions: vi.fn(),
    ouvrir(id: string | null) { campagne.set(id); prerempli.set(false); detail.set(null); },
    valider(id: string) { detail.set({ id }); prerempli.set(true); },
  };
}

/** L'API de ⑦ : chaque appel rend un `Subject` que le test pilote. */
function fausseApi() {
  const appels: { nom: string; c: string; s: Subject<unknown>; corps?: unknown }[] = [];
  const appel = (nom: string) => (c: string, corps?: unknown) => {
    const s = new Subject<unknown>();
    appels.push({ nom, c, s, corps });
    return s;
  };
  return { appels, prevol: appel('prevol'), historique: appel('historique'), pousser: appel('pousser'), annuler: appel('annuler'), publier: appel('publier') };
}

const prevol = (activable = true): Prevol => ({
  strategie: { id: 's1', nom: 'p', statut: 'active', scope: 'custom_zone', zone_id: null, cpm_previsionnel: null, budget: null },
  version_publiee: 1, zones_modifiees: [], n_codes_postaux: 10, canaux_connectes: [], mode_dv360: 'simule', n_cp_dv360: 10,
  extraction: null, motifs: [], blocages: [], activable,
});

function preparer() {
  const plan = fauxPlan();
  const api = fausseApi();
  const plateformes = new Subject<{ plateformes: [] }>();
  const jeux = { plateformes: vi.fn(() => plateformes), extractions: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ActivationCampagneService,
      { provide: PlanCampagneService, useValue: plan },
      { provide: ActivationApi, useValue: api },
      { provide: JeuxApi, useValue: jeux },
    ],
  });
  const svc = TestBed.inject(ActivationCampagneService);
  const tick = () => TestBed.tick();
  /** Répond au dernier appel `nom` de la campagne `c`, puis le termine. */
  const repondre = (nom: string, c: string, v: unknown) => {
    const a = [...api.appels].reverse().find((x) => x.nom === nom && x.c === c);
    if (!a) throw new Error(`aucun appel ${nom} pour ${c}`);
    a.s.next(v);
    a.s.complete();
    tick();
  };
  /** Valide A et termine la lecture complète (pré-vol, historique, registre). */
  const lireA = (p = prevol()) => {
    plan.ouvrir(A); plan.valider(A); tick();
    repondre('prevol', A, p);
    repondre('historique', A, { lots: [] });
    plateformes.next({ plateformes: [] }); plateformes.complete(); tick();
  };
  return { svc, plan, api, jeux, tick, repondre, lireA };
}

describe('ActivationCampagneService — aucune lecture avant l’espace validé (piège n° 3)', () => {
  it('?campagne= posé mais préremplissage en cours : aucun appel', () => {
    const { plan, api, tick } = preparer();
    plan.ouvrir(A); tick();
    expect(api.appels).toEqual([]);
  });

  it('campagne d’un autre espace (le plan la referme sans la valider) : jamais de pré-vol', () => {
    const { plan, api, tick } = preparer();
    plan.ouvrir(A); tick();
    plan.ouvrir(null); tick();
    expect(api.appels.filter((a) => a.nom === 'prevol')).toEqual([]);
  });

  it('accès refusé : rien n’est lu', () => {
    const { plan, api, tick } = preparer();
    plan.ouvrir(A); plan.accesRefuse.set(true); plan.valider(A); tick();
    expect(api.appels).toEqual([]);
  });

  it('validée : pré-vol PUIS historique PUIS registre, une requête à la fois', () => {
    const { svc, plan, api, jeux, tick, repondre } = preparer();
    plan.ouvrir(A); plan.valider(A); tick();
    expect(api.appels.map((a) => a.nom)).toEqual(['prevol']);
    expect(svc.chargement()).toBe(true);
    repondre('prevol', A, prevol());
    expect(api.appels.map((a) => a.nom)).toEqual(['prevol', 'historique']);
    repondre('historique', A, { lots: [{ id: 'l', canal: 'dv360', statut: 'termine', lance_le: '2026-10-26T09:00:00Z' }] });
    expect(jeux.plateformes).toHaveBeenCalledTimes(1);
    expect(svc.prevol()?.activable).toBe(true);
    expect(svc.renseignee()).toBe(true);
  });

  it('les versions du jeu du plan LANCÉ (pré-vol) sont lues, retenues, et font les cartes', () => {
    const { svc, plan, jeux, tick, repondre } = preparer();
    const ext = new Subject<{ extractions: ExtractionJeu[] }>();
    jeux.extractions.mockReturnValue(ext);
    // Le brouillon de ⑥ a changé de jeu depuis le lancement : ⑦ suit le plan lancé.
    plan.brouillon.set({ jeuZones: { id: 'autre', extraction: { id: 'x9', version: 9 } } });
    plan.ouvrir(A); plan.valider(A); tick();
    repondre('prevol', A, { ...prevol(), extraction: { zone_set_id: 'j1', version: 1 } });
    repondre('historique', A, { lots: [] });
    (jeux.plateformes.mock.results[0].value as Subject<unknown>).next({ plateformes: [] });
    (jeux.plateformes.mock.results[0].value as Subject<unknown>).complete();
    expect(jeux.extractions).toHaveBeenCalledWith('j1');
    const x1 = { id: 'x1', version: 1, plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null, n_unites: 63, taux_utile: 95 }] } as unknown as ExtractionJeu;
    ext.next({ extractions: [x1] }); ext.complete(); tick();
    expect(plan.retenirExtractions).toHaveBeenCalledWith('j1', [x1]);
    expect(svc.cartes()[0].nature).toBe('63 CP — conversion de la zone (95 % d’utile)');
  });

  it('une stratégie posée en ⑥ sur la campagne ouverte (lancement) : le pré-vol est relu', () => {
    const { plan, api, tick, lireA } = preparer();
    lireA();
    plan.strategieExistante.set({ id: 's2' }); tick();
    expect(api.appels.filter((a) => a.nom === 'prevol')).toHaveLength(2);
  });
});

describe('ActivationCampagneService — relance en ⑥ (relecture 2)', () => {
  const version = (v: number) => ({
    id: `x${v}`, version: v, plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null, n_unites: 63, taux_utile: 95 }],
  }) as unknown as ExtractionJeu;

  /** A lancée sur J v1, versions de J lues = [v1]. */
  function lanceeSurV1() {
    const b = preparer();
    const lots = [new Subject<unknown>(), new Subject<unknown>()];
    b.jeux.extractions.mockReturnValueOnce(lots[0]).mockReturnValueOnce(lots[1]);
    b.plan.ouvrir(A); b.plan.valider(A); b.tick();
    b.repondre('prevol', A, { ...prevol(), extraction: { zone_set_id: 'j1', version: 1 } });
    b.repondre('historique', A, { lots: [] });
    const reg = b.jeux.plateformes.mock.results[0].value as Subject<unknown>;
    reg.next({ plateformes: [] }); reg.complete();
    lots[0].next({ extractions: [version(1)] }); lots[0].complete(); b.tick();
    return { ...b, lots };
  }

  it('I-1 — relance sur J v2 : la liste de J est RELUE, cartes remplies, motif « jamais publié » et carte DV360 au CP (bouton Publier)', () => {
    const { svc, plan, jeux, tick, repondre, lots } = lanceeSurV1();
    expect(svc.cartes()[0].maille).toBe('cp');
    plan.strategieExistante.set({ id: 's2' }); tick();
    repondre('prevol', A, {
      ...prevol(false), version_publiee: null, extraction: { zone_set_id: 'j1', version: 2 },
      motifs: [{ code: 'jamais_publiee', message: 'La stratégie n’a jamais été publiée — publiez-la pour figer le périmètre poussé.' }],
    });
    repondre('historique', A, { lots: [] });
    expect(jeux.extractions).toHaveBeenCalledTimes(2);
    lots[1].next({ extractions: [version(2), version(1)] }); lots[1].complete(); tick();
    const [dv] = svc.cartes();
    expect(dv).toMatchObject({ maille: 'cp', nature: '63 CP — conversion de la zone (95 % d’utile)' });
    expect(dv.motifs).toEqual(['Le plan n’a jamais été publié — publiez-le pour figer le périmètre poussé.']);
  });

  it('même version déjà lue : la liste n’est pas relue', () => {
    const { plan, jeux, tick, repondre } = lanceeSurV1();
    plan.strategieExistante.set({ id: 's2' }); tick();
    repondre('prevol', A, { ...prevol(), extraction: { zone_set_id: 'j1', version: 1 } });
    repondre('historique', A, { lots: [] });
    expect(jeux.extractions).toHaveBeenCalledTimes(1);
  });

  it('I-2 — relance sans DV360 : les cartes suivent les canaux à jour, plus de carte DV360', () => {
    const { svc, plan, tick } = lanceeSurV1();
    expect(svc.cartes().map((c) => c.canal)).toEqual(['dv360']);
    plan.canaux.set({ selected: { dsps: ['ttd'], socials: [] } }); tick();
    expect(svc.cartes().map((c) => c.canal)).toEqual(['ttd']);
  });
});

describe('ActivationCampagneService — changement de campagne (Review Focus 3)', () => {
  it('pendant le pré-vol : la réponse tardive de A est ignorée', () => {
    const { svc, plan, api, tick } = preparer();
    plan.ouvrir(A); plan.valider(A); tick();
    const premier = api.appels[0];
    plan.ouvrir(B); tick();
    premier.s.next(prevol()); tick();
    expect(svc.prevol()).toBeNull();
    expect(premier.s.observed).toBe(false);
  });

  it('pendant une poussée : le flux reste lié à A, `pousseeEnCours` = A, B le voit', () => {
    const { svc, plan, api, tick, lireA, repondre } = preparer();
    lireA();
    svc.pousser('12', '3, 4');
    const p = api.appels.find((a) => a.nom === 'pousser');
    expect(p?.corps as CorpsPoussee).toEqual({ canal: 'dv360', advertiser_id: '12', cibles: [{ line_item_id: '3' }, { line_item_id: '4' }] });
    p?.s.next({ etape: 'debut', total: 2 } satisfies LigneFlux); tick();
    expect(svc.flux()).toHaveLength(1);

    plan.ouvrir(B); plan.valider(B); tick();
    repondre('prevol', B, prevol());
    expect(svc.pousseeEnCours()).toEqual({ campagne: A });
    expect(svc.flux()).toEqual([]);
    p?.s.next({ etape: 'cible', n: 1, total: 2, statut: 'pousse' } satisfies LigneFlux); tick();
    svc.pousser('12', '5');
    expect(api.appels.filter((a) => a.nom === 'pousser')).toHaveLength(1);

    plan.ouvrir(A); plan.valider(A); tick();
    expect(svc.flux().map((l) => l.etape)).toEqual(['debut', 'cible']);
    p?.s.complete(); tick();
    expect(svc.pousseeEnCours()).toBeNull();
  });
});

describe('ActivationCampagneService — gestes', () => {
  it('pousser refusé sans appel : non activable, annonceur vide, aucun identifiant, 51 identifiants', () => {
    const { svc, api, lireA } = preparer();
    lireA(prevol(false));
    svc.pousser('12', '3');
    expect(api.appels.some((a) => a.nom === 'pousser')).toBe(false);
  });

  it('pousser : 51 line items → « 50 line items au plus. », rien ne part', () => {
    const { svc, api, lireA } = preparer();
    lireA();
    svc.pousser(' ', '3');
    svc.pousser('12', 'abc');
    expect(svc.erreur()).toBe('Aucun identifiant de line item valide (chiffres uniquement).');
    svc.pousser('12', Array.from({ length: 51 }, (_, i) => String(i + 1)).join(' '));
    expect(svc.erreur()).toBe('50 line items au plus.');
    expect(api.appels.some((a) => a.nom === 'pousser')).toBe(false);
  });

  it('fin de poussée : pré-vol et historique relus', () => {
    const { svc, api, tick, lireA } = preparer();
    lireA();
    svc.pousser('12', '3');
    api.appels.find((a) => a.nom === 'pousser')?.s.complete(); tick();
    expect(api.appels.filter((a) => a.nom === 'prevol')).toHaveLength(2);
  });

  it('poussée refusée (409) : le `message` de la route, comme React', () => {
    const { svc, api, tick, lireA } = preparer();
    lireA();
    svc.pousser('12', '3');
    api.appels.find((a) => a.nom === 'pousser')?.s.error(new HttpErrorResponse({
      status: 409, error: JSON.stringify({ error: 'strategie_non_publiee', message: 'Publiez la stratégie avant d’activer.' }),
    }));
    tick();
    expect(svc.erreur()).toBe('Publiez la stratégie avant d’activer.');
    expect(svc.pousseeEnCours()).toBeNull();
  });

  it('publier : la stratégie du pré-vol, puis relecture', () => {
    const { svc, api, tick, lireA } = preparer();
    lireA();
    svc.publier();
    expect(svc.publication()).toBe(true);
    const p = api.appels.find((a) => a.nom === 'publier');
    expect(p?.c).toBe('s1');
    p?.s.next({}); p?.s.complete(); tick();
    expect(svc.publication()).toBe(false);
    expect(api.appels.filter((a) => a.nom === 'prevol')).toHaveLength(2);
  });

  it('annuler : le message de la route tel quel, succès ou refus', () => {
    const { svc, api, tick, lireA } = preparer();
    lireA();
    svc.annuler('l1');
    const a = api.appels.find((x) => x.nom === 'annuler');
    a?.s.next({ message: 'Le lot est marqué annulé.' }); a?.s.complete(); tick();
    expect(svc.messageAnnulation()).toBe('Le lot est marqué annulé.');
    svc.annuler('l2');
    [...api.appels].reverse().find((x) => x.nom === 'annuler')?.s.error(new HttpErrorResponse({ status: 409, error: { error: 'Ce lot est déjà annulé.' } }));
    tick();
    expect(svc.messageAnnulation()).toBe('Ce lot est déjà annulé.');
  });
});

describe('messagePoussee', () => {
  it('lit `message`, puis `error`, dans un corps texte ou objet', () => {
    expect(messagePoussee(new HttpErrorResponse({ status: 403, error: '{"error":"droit_insuffisant","message":"Réservé."}' }))).toBe('Réservé.');
    expect(messagePoussee(new HttpErrorResponse({ status: 404, error: { error: 'Campagne introuvable.' } }))).toBe('Campagne introuvable.');
  });
});

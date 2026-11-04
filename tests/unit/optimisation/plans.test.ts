/**
 * Les trois calculs branchés sous drapeau (tâche 1.6), `fetch` simulé : en `ombre`, Python identique → 0 écart,
 * Python en écart → écart compté et TS servi, Python indisponible → TS servi ; en `python`, la valeur du service ; en
 * `ts` (défaut), aucun appel. La « réponse Python » des cas identiques est fabriquée par le TS lui-même, passée par
 * JSON — ce que le service rendrait si la parité tient (elle est prouvée au bit près par pytest et, de bout en bout, par
 * `tests/integration/optimisation-ombre.test.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { planRisqueSousDrapeau, plansZoneSousDrapeau, recalageSousDrapeau, type EntreesPlansZone } from '@/lib/optimisation/plans';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import {
  planCpDeZone, plansParPlateforme, reglageDuPlan, sortiesPoids, type VolumesAttendus,
} from '@/lib/zones/plan-jeu-zone';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { PlateformePoids } from '@/lib/zones/plateformes';
import { recaler } from '@/lib/simulation/recalage';
import type { CpSimulation, ParamsSimulation } from '@/lib/simulation/types';

const ALGO = { moteur: 'python', version: '0.1.0', entrees_sha256: 'c'.repeat(64) };
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

let info: ReturnType<typeof vi.spyOn>;
const lignesJournal = () => info.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);

function servir(corps: (requete: unknown) => unknown, status = 200) {
  const f = vi.fn(async (_url: string, init: RequestInit) => new Response(
    JSON.stringify(corps(JSON.parse(init.body as string))), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', 'cle-de-test');
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Risque ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const CPS: CpZone[] = [
  { code_postal: '13001', classe: 'haut', pop_en_zone: 4000, pop_totale: 9000, retenu: true },
  { code_postal: '13001', classe: 'bas', pop_en_zone: 1000, pop_totale: 9000, retenu: true },
  { code_postal: '13002', classe: 'bas', pop_en_zone: 500, pop_totale: 20000, retenu: false },
  { code_postal: '75011', classe: 'haut', pop_en_zone: 2500, pop_totale: 3000, retenu: true },
];
const JEU = { mode_plan: 'pondere' as const, poids: { haut: 2, bas: 1 } };
const GROUPES = new Map([['75011', ['75011', '75111']]]);

describe('planRisqueSousDrapeau', () => {
  const planTs = genererPlanCp(CPS, JEU, GROUPES);

  it('drapeau absent : genererPlanCp seul, aucun appel', async () => {
    const f = servir(() => ({}));
    const r = await planRisqueSousDrapeau('rattacher', CPS, JEU, GROUPES);
    expect(r).toEqual({ valeur: planTs });
    expect(f).not.toHaveBeenCalled();
  });

  it('ombre, Python identique : 0 écart, TS servi ; la requête porte cps, jeu et groupes en objet', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    const f = servir(() => ({ ...json(planTs), algo: ALGO }));
    const r = await planRisqueSousDrapeau('rattacher', CPS, JEU, GROUPES);
    expect(r.valeur).toEqual(planTs);
    expect(r.ombre).toEqual({ ecarts: 0, algo: ALGO, erreur: null });
    const requete = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(requete).toEqual({ cps: CPS, jeu: JEU, groupes: { 75011: ['75011', '75111'] } });
    expect((f.mock.calls[0][0] as string)).toBe('http://127.0.0.1:8090/v1/plans/risque');
    expect(lignesJournal()).toEqual([expect.objectContaining({ appelant: 'rattacher', ecarts: 0 })]);
  });

  it('ombre, Python en écart : TS servi, écart journalisé', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    servir(() => {
      const p = json(planTs);
      p.lignes[0].multiplicateur += 0.001;
      return { ...p, algo: ALGO };
    });
    const r = await planRisqueSousDrapeau('export', CPS, JEU, GROUPES);
    expect(r.valeur).toEqual(planTs);
    expect(lignesJournal()[0]).toMatchObject({
      appelant: 'export', ecarts: 1, premier_ecart: { chemin: 'lignes.0.multiplicateur' },
    });
  });

  it('ombre, Python indisponible (503) : TS servi, erreur journalisée', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    servir(() => ({ detail: { message: 'Le calcul du plan est indisponible, réessayez dans une minute.' } }), 503);
    const r = await planRisqueSousDrapeau('cp_geo', CPS, JEU);
    expect(r.valeur).toEqual(genererPlanCp(CPS, JEU));
    expect(lignesJournal()[0]).toMatchObject({ appelant: 'cp_geo', ecarts: null, erreur: { motif: 'indisponible' } });
  });

  it('ombre, service non configuré : TS servi, aucun appel', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    vi.stubEnv('OPTIMISATION_URL', '');
    const f = servir(() => ({}));
    expect((await planRisqueSousDrapeau('cp_geo', CPS, JEU)).valeur).toEqual(genererPlanCp(CPS, JEU));
    expect(f).not.toHaveBeenCalled();
    expect(lignesJournal()[0]).toMatchObject({ erreur: { motif: 'configuration' } });
  });

  it('python : la valeur du service (sans algo ni bilan null) ; une panne lève', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
    servir(() => ({ ...json(planTs), lignes: [], multiplicateur: null, algo: ALGO }));
    const r = await planRisqueSousDrapeau('extraction_risque', CPS, JEU, GROUPES);
    expect(r.valeur).toEqual({ ...json(planTs), lignes: [] });
    expect('multiplicateur' in r.valeur).toBe(false);
    expect(r.algo).toEqual(ALGO);
    servir(() => ({ detail: 'x' }), 500);
    await expect(planRisqueSousDrapeau('extraction_risque', CPS, JEU)).rejects.toMatchObject({ motif: 'serveur' });
  });
});

// ── Zone ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ligne = (code: string, pop_en_zone: number, pop_totale: number, part: number): LigneCouverture => ({
  code, nom: code, commune: null, n_carreaux: 1, pop_en_zone, pop_totale, part, part_brute: part, membres: [code],
});
const LIGNES = [ligne('69001', 6000, 6500, 92.3), ligne('69002', 3000, 10000, 30), ligne('69003', 1000, 50000, 2)];
const poids = (plateforme: PlateformePoids['plateforme'], mecanisme: PlateformePoids['mecanisme'], p: Partial<PlateformePoids> = {}): PlateformePoids => ({
  plateforme, maille: 'cp', mecanisme, valeur_min: null, valeur_max: null, pas: null, nb_max_entrees: null, nb_paliers_max: null,
  poids_groupe_cp: 'meme', branche: false, parametres_a_verifier: [], note: null, releve_le: '2026-10-31', ...p,
});
const POIDS = [
  poids('dv360', 'multiplicateur', { valeur_min: 0.1, valeur_max: 10 }),
  poids('dv360', 'script', { nb_max_entrees: 2000 }),
  poids('ttd', 'budget_ligne'),
];
const VOLUMES: VolumesAttendus = {
  par_code: new Map([['69001', 6500], ['69002', 10000], ['69003', 50000]]), total: 1_000_000, univers: 'METRO',
};
const CHOIX = [
  { plateforme: 'dv360', seuil: 20, n_codes_conversion: 2 },
  { plateforme: 'ttd', seuil: 50, n_codes_conversion: 1 },
];
const reglageCommun = (() => {
  const r = reglageDuPlan(POIDS, ['dv360', 'ttd']);
  if (!r.ok) throw new Error(r.message);
  return r.reglage;
})();

function entrees(lireVolumes = vi.fn(async () => VOLUMES)): EntreesPlansZone {
  return {
    lignes: LIGNES, choix: CHOIX, mode: 'pondere', groupes: new Map(), recette: null,
    reglage: reglageCommun, poids: POIDS, lireVolumes,
  };
}

/** Ce que `/v1/plans/zone` rend quand la parité tient : la sortie du TS, en JSON, `algo` compris. */
function sortieIdentique() {
  const propres = plansParPlateforme(LIGNES, CHOIX, 'pondere', new Map(), POIDS, undefined, VOLUMES);
  if (!propres.ok) throw new Error(propres.message);
  const commun = planCpDeZone(LIGNES, 20, 'pondere', new Map(), undefined, reglageCommun, VOLUMES);
  return json({
    commun: { lignes: commun.lignes, resume: { ...commun.resume, algo: ALGO } },
    reglage: reglageCommun,
    par_plateforme: propres.plans.map((p) => {
      const s = sortiesPoids(POIDS, p.plateforme, p.plan.resume.n_codes, p.plan.resume.multiplicateur);
      return { ...p, poids: s.sorties, avertissements: s.avertissements };
    }),
    sorties_poids: CHOIX.map((c) => {
      const s = sortiesPoids(POIDS, c.plateforme, c.n_codes_conversion, commun.resume.multiplicateur);
      return { plateforme: c.plateforme, poids: s.sorties, avertissements: s.avertissements };
    }),
    algo: ALGO,
  });
}

describe('plansZoneSousDrapeau', () => {
  it('drapeau absent : TS seul, volumes lus, aucun appel, aucun algo', async () => {
    const f = servir(() => ({}));
    const e = entrees();
    const r = await plansZoneSousDrapeau(e);
    expect(r.valeur.ok).toBe(true);
    expect(r.ombre).toBeUndefined();
    expect(r.algo).toBeUndefined();
    expect(e.lireVolumes).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
  });

  it('ombre, identique : 0 écart ; n_codes_conversion envoyé pour CHAQUE plateforme', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    const f = servir(() => sortieIdentique());
    const r = await plansZoneSousDrapeau(entrees());
    expect(r.ombre).toEqual({ ecarts: 0, algo: ALGO, erreur: null });
    const requete = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(requete.choix).toEqual(CHOIX);
    expect(requete.couverture[0]).toEqual({
      code: '69001', pop_en_zone: 6000, pop_totale: 6500, part: 92.3, part_brute: 92.3, membres: ['69001'], incluse: null,
    });
    expect(requete).toMatchObject({ mode_plan: 'pondere', groupes: {}, codes_exacts: null, recette: null });
    expect(lignesJournal()).toEqual([expect.objectContaining({ appelant: 'extraction_zone', ecarts: 0 })]);
  });

  it('ombre, écart dans une sortie de poids : compté, TS servi', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    servir(() => {
      const s = sortieIdentique();
      s.sorties_poids[0].poids[0].n_codes += 1;
      return s;
    });
    const r = await plansZoneSousDrapeau(entrees());
    expect(r.ombre?.ecarts).toBe(1);
    expect(lignesJournal()[0].premier_ecart).toMatchObject({ chemin: 'sorties_poids.0.poids.0.n_codes' });
    if (!r.valeur.ok) throw new Error('refus');
    expect(r.valeur.plans.sortiesCommun.get('dv360')?.sorties[0].n_codes).toBe(2);
  });

  it('ombre, Python injoignable : TS servi', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const r = await plansZoneSousDrapeau(entrees());
    expect(r.valeur.ok).toBe(true);
    expect(r.ombre).toMatchObject({ ecarts: null, erreur: "Le service d'optimisation est injoignable." });
  });

  it('ombre, refus du registre des deux côtés : comparé comme un résultat (0 écart)', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    const sansTtd = POIDS.filter((p) => p.plateforme !== 'ttd');
    const r0 = plansParPlateforme(LIGNES, CHOIX, 'pondere', new Map(), sansTtd, undefined, VOLUMES);
    if (r0.ok) throw new Error('refus attendu');
    servir(() => ({ detail: { refus: 'registre', message: r0.message } }), 422);
    const r = await plansZoneSousDrapeau({ ...entrees(), poids: sansTtd });
    expect(r.valeur).toEqual({ ok: false, message: r0.message });
    expect(r.ombre?.ecarts).toBe(0);
  });

  it('python : la sortie du service, volumes NON lus par le TS, algo dans le résumé commun', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
    servir(() => {
      const s = sortieIdentique();
      s.commun.lignes[0].multiplicateur = 1.5;
      return s;
    });
    const e = entrees();
    const r = await plansZoneSousDrapeau(e);
    expect(e.lireVolumes).not.toHaveBeenCalled();
    if (!r.valeur.ok) throw new Error('refus');
    expect(r.valeur.plans.commun.lignes[0].multiplicateur).toBe(1.5);
    expect((r.valeur.plans.commun.resume as unknown as { algo: unknown }).algo).toEqual(ALGO);
    expect([...r.valeur.plans.sortiesPropres.keys()]).toEqual(['dv360', 'ttd']);
    expect(r.algo).toEqual(ALGO);
  });
});

// ── Recalage ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const CPS_SIM = [
  { code_postal: '75011', cluster_id: 'b', multiplicateur: 1, part_en_zone: 50 },
  { code_postal: '13001', cluster_id: 'a', multiplicateur: 2, part_en_zone: 10 },
] as CpSimulation[];
const OBS = new Map([['b', 30], ['a', 70]]);
const CIBLE = new Map([['b', 0.5], ['a', 0.5]]);
const P = { amortissement: 0.8, seuilDilution: 20, baisseDilues: 0.6 } as ParamsSimulation;

describe('recalageSousDrapeau', () => {
  const rc = recaler(CPS_SIM, OBS, CIBLE, P);
  const enPaires = { multiplicateurs: [...rc.multiplicateurs], corrections: [...rc.corrections], dilues: rc.dilues };

  it('OPTIMISATION_PLAN_SOURCE ne le touche pas : seul OPTIMISATION_CORRECTION_SOURCE compte', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
    const f = servir(() => ({}));
    expect((await recalageSousDrapeau(CPS_SIM, OBS, CIBLE, P)).valeur).toEqual(rc);
    expect(f).not.toHaveBeenCalled();
  });

  it('ombre, identique : 0 écart ; les Map voyagent en paires, dans l’ordre', async () => {
    vi.stubEnv('OPTIMISATION_CORRECTION_SOURCE', 'ombre');
    const f = servir(() => ({ ...json(enPaires), algo: ALGO }));
    const r = await recalageSousDrapeau(CPS_SIM, OBS, CIBLE, P);
    expect(r.ombre?.ecarts).toBe(0);
    const requete = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(requete.utiles_observees).toEqual([['b', 30], ['a', 70]]);
    expect(requete.params).toEqual({ amortissement: 0.8, seuilDilution: 20, baisseDilues: 0.6 });
    expect((f.mock.calls[0][0] as string)).toMatch(/\/v1\/historique\/recaler$/);
  });

  it('ombre, ordre différent : c’est un écart (l’ordre d’une Map est une donnée)', async () => {
    vi.stubEnv('OPTIMISATION_CORRECTION_SOURCE', 'ombre');
    servir(() => ({ ...json(enPaires), multiplicateurs: [...json(enPaires).multiplicateurs].reverse(), algo: ALGO }));
    expect((await recalageSousDrapeau(CPS_SIM, OBS, CIBLE, P)).ombre?.ecarts).toBeGreaterThan(0);
  });

  it('python : des Map reconstruites dans l’ordre du service', async () => {
    vi.stubEnv('OPTIMISATION_CORRECTION_SOURCE', 'python');
    servir(() => ({ multiplicateurs: [['13001', 2], ['75011', 0.5]], corrections: [], dilues: ['13001'], algo: ALGO }));
    const r = await recalageSousDrapeau(CPS_SIM, OBS, CIBLE, P);
    expect([...r.valeur.multiplicateurs]).toEqual([['13001', 2], ['75011', 0.5]]);
    expect(r.valeur.dilues).toEqual(['13001']);
  });
});

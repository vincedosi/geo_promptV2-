/**
 * `extraireJeuZone` sous `OPTIMISATION_PLAN_SOURCE` (tâche 1.6), base simulée (`_doublures-route.ts`), `fetch` simulé :
 * - drapeau absent : RIEN ne change — aucun appel, pas de clé `algo` dans `p_resume` ;
 * - `ombre`, Python indisponible : l'extraction se fait sur le TS, à l'identique, et `resume_plan.algo` dit la panne ;
 * - `ombre`, Python identique : 0 écart figé ;
 * - `python` : le plan écrit est celui du service ; une panne → 503 français, rien d'écrit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAdminClient, etat, reinitialiser, ORG } from '../api/_doublures-route';
import { extraireJeuZone } from '@/lib/zones/extraction-jeu-zone';
import { PlateformePoidsSchema } from '@/lib/zones/plateformes';
import { planCpDeZone, plansParPlateforme, reglageDuPlan, sortiesPoids } from '@/lib/zones/plan-jeu-zone';
import type { EntreePlanZone } from '@/lib/optimisation/schemas';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { Tables } from '@/types/database.types';

const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';
const JEU = {
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3302', org_id: ORG, custom_geo_zone_id: ZONE, cible: 'ind', mode_plan: 'pondere', type: 'zone',
} as Tables<'zone_sets'>;
const regle = (plateforme: string, maille: string) => ({
  plateforme, maille, libelle: maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14',
  a_verifier: false, note: null, ordre: 1,
});
const COUVERTURE = {
  population: 10_000, surface_km2: 78.5,
  lignes: [
    { code: '69001', nom: 'Lyon 1', commune: null, n_carreaux: 5, pop_en_zone: 6_000, pop_totale: 6_500, part: 92.3, part_brute: 92.3, membres: ['69001'] },
    { code: '69002', nom: 'Lyon 2', commune: null, n_carreaux: 5, pop_en_zone: 3_000, pop_totale: 10_000, part: 30, part_brute: 30, membres: ['69002'] },
    { code: '69003', nom: 'Lyon 3', commune: null, n_carreaux: 1, pop_en_zone: 1_000, pop_totale: 50_000, part: 2, part_brute: 2, membres: ['69003'] },
  ],
};
const ligneSeed = (plateforme: string, mecanisme: string, p: Record<string, unknown> = {}) => ({
  plateforme, maille: 'cp', mecanisme, valeur_min: null, valeur_max: null, pas: null, nb_max_entrees: null, nb_paliers_max: null,
  poids_groupe_cp: 'meme', branche: false, parametres_a_verifier: [], note: null, releve_le: '2026-10-31', ...p,
});
const POIDS_SEED = [
  ligneSeed('dv360', 'multiplicateur', { valeur_min: 0.1, valeur_max: 10 }),
  ligneSeed('dv360', 'script', { nb_max_entrees: 2000 }),
];
const VOLUMES = { volume: 'population_totale', univers: 'METRO', total: 1_000_000, codes: { 69001: 6_500, 69002: 10_000, 69003: 50_000 } };
const DESSIN = { v: 1, type: 'dessin' };
const ALGO = { moteur: 'python', version: '0.1.0', entrees_sha256: 'd'.repeat(64) };

function preparer() {
  etat.tables.plateformes_poids = { data: POIDS_SEED, error: null };
  etat.tables.zone_set_plateformes = { data: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], error: null };
  etat.tables.custom_geo_zones = { data: { recette: DESSIN, unites_constitutives: null }, error: null };
  etat.tables.plateformes_geo = { data: [regle('dv360', 'cp')], error: null };
  etat.tables.cp_groupe = { data: [], error: null };
  etat.reponses.couverture_zone = { data: COUVERTURE, error: null };
  etat.reponses.creer_extraction_jeu_zone = { data: { ok: true, deja_extraite: false, id: 'x', version: 1 }, error: null };
  etat.reponses.volumes_attendus_cp_univers = { data: VOLUMES, error: null };
}

/** Ce que le service rendrait (parité tenue) : le TS sur l'entrée reçue, avec les lectures du service simulées. */
function pythonIdentique(entree: EntreePlanZone, retouche?: (s: Record<string, unknown>) => void) {
  const poids = POIDS_SEED.map((l) => PlateformePoidsSchema.parse(l));
  const volumes = { par_code: new Map(Object.entries(VOLUMES.codes)), total: VOLUMES.total, univers: 'METRO' as const };
  const lignes = entree.couverture as unknown as LigneCouverture[];
  const r = reglageDuPlan(poids, entree.choix.map((c) => c.plateforme));
  if (!r.ok) throw new Error(r.message);
  const propres = plansParPlateforme(lignes, entree.choix, entree.mode_plan, new Map(), poids, undefined, volumes);
  if (!propres.ok) throw new Error(propres.message);
  const commun = planCpDeZone(lignes, Math.min(...entree.choix.map((c) => c.seuil)), entree.mode_plan, new Map(), undefined, r.reglage, volumes);
  const s = JSON.parse(JSON.stringify({
    commun: { lignes: commun.lignes, resume: { ...commun.resume, algo: ALGO } },
    reglage: r.reglage,
    par_plateforme: propres.plans.map((p) => {
      const x = sortiesPoids(poids, p.plateforme, p.plan.resume.n_codes, p.plan.resume.multiplicateur);
      return { ...p, poids: x.sorties, avertissements: x.avertissements };
    }),
    sorties_poids: entree.choix.map((c) => {
      const x = sortiesPoids(poids, c.plateforme, c.n_codes_conversion, commun.resume.multiplicateur);
      return { plateforme: c.plateforme, poids: x.sorties, avertissements: x.avertissements };
    }),
    algo: ALGO,
  }));
  retouche?.(s);
  return s;
}

function servirPython(retouche?: (s: Record<string, unknown>) => void) {
  const f = vi.fn(async (_u: string, init: RequestInit) => new Response(
    JSON.stringify(pythonIdentique(JSON.parse(init.body as string), retouche)),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', f);
  return f;
}

const extraire = () => extraireJeuZone(createAdminClient() as never, JEU, { origine: 'initiale', commentaire: '' }, 'u1');
const creation = () => etat.rpcs.find((r) => r.nom === 'creer_extraction_jeu_zone')?.args as {
  p_cp: { code_postal: string; multiplicateur: number }[]; p_resume: Record<string, unknown>;
} | undefined;

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reinitialiser();
  preparer();
  vi.stubEnv('OPTIMISATION_URL', 'http://127.0.0.1:8090');
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', 'cle-de-test');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extraction d’un jeu de zone sous OPTIMISATION_PLAN_SOURCE', () => {
  it('drapeau absent : aucun appel au service, aucune clé algo dans le résumé', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await extraire()).status).toBe(201);
    expect(f).not.toHaveBeenCalled();
    expect('algo' in creation()!.p_resume).toBe(false);
    expect(Object.fromEntries(creation()!.p_cp.map((l) => [l.code_postal, l.multiplicateur])))
      .toEqual({ 69001: 1.509, 69002: 0.491, 69003: 0 });
  });

  it('ombre, Python indisponible : même extraction que le TS, la panne figée dans resume_plan.algo', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await extraire();
    const reference = creation()!;
    reinitialiser();
    preparer();
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await extraire()).status).toBe(201);
    const { algo, ...resume } = creation()!.p_resume;
    expect(creation()!.p_cp).toEqual(reference.p_cp);
    expect(resume).toEqual(reference.p_resume);
    expect(algo).toEqual({
      moteur: 'ts', ombre: { moteur: 'python', ecarts: null, erreur: "Le service d'optimisation est injoignable." },
    });
  });

  it('ombre, Python identique : 0 écart journalisé et figé ; n_codes_conversion de la conversion envoyé', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
    const f = servirPython();
    expect((await extraire()).status).toBe(201);
    const requete = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string) as EntreePlanZone;
    expect(requete.choix).toEqual([{ plateforme: 'dv360', seuil: 20, n_codes_conversion: 2 }]);
    expect(creation()!.p_resume.algo).toEqual({ moteur: 'ts', ombre: { ...ALGO, ecarts: 0 } });
    const ligne = JSON.parse(info.mock.calls[0][0] as string);
    expect(ligne).toMatchObject({ evenement: 'optimisation_ombre', appelant: 'extraction_zone', ecarts: 0 });
  });

  it('python : le plan écrit est celui du service, son algo figé ; volumes non lus par Next', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
    servirPython((s) => {
      (s.commun as { lignes: { multiplicateur: number }[] }).lignes[0].multiplicateur = 1.5;
    });
    expect((await extraire()).status).toBe(201);
    expect(creation()!.p_cp[0]).toMatchObject({ code_postal: '69001', multiplicateur: 1.5 });
    expect(creation()!.p_resume.algo).toEqual(ALGO);
    expect(etat.rpcs.map((r) => r.nom)).not.toContain('volumes_attendus_cp_univers');
  });

  it('python, service en panne : 503 en français, rien d’écrit', async () => {
    vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const r = await extraire();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("Le service d'optimisation est injoignable.");
    expect(creation()).toBeUndefined();
  });
});

/**
 * Le plan d'une campagne depuis une EXTRACTION (lot 6, T1 ; arbitrages A-4, A-10, A-11), contre la vraie base locale :
 * - `POST /api/zones/jeux/[id]/rattacher` avec `extraction` : `bidding_zone_configs` = les CP à multiplicateur > 0 de
 *   l'extraction, à l'unité près ; extraction d'un autre jeu → 404 ; jeu d'un autre espace → 404 du chargeur ; sans
 *   `extraction`, un jeu de zone reste refusé (409) et un jeu risque donne les chiffres d'avant le lot 6 ; une
 *   extraction sans plateforme au CP se rattache avec 0 CP (T6) ;
 * - `GET /api/zones/jeux/[id]/extractions/[version]/cp` : le même compte que le plan écrit ; par plateforme, ses CP ;
 * - `PUT /api/campaigns/[campaignId]/channels` : `cpm_prevus` relu par le GET, élagué au retrait du canal ;
 * - `GET /api/bidding/strategies?campaign_id=` (relecture 1) : la seule plus récente de la campagne.
 *
 * Seuls l'appelant et les quotas sont simulés. Deux espaces `[ESSAI lot6 T1]` sont créés puis supprimés ; jeux,
 * extractions, campagnes et stratégies partent avec eux (cascades). La campagne posée dans l'espace du jeu risque de
 * référence est supprimée à la fin, sa stratégie en cascade.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const sb = creerClientTest();
const LONG = 120_000;
const appelant = vi.hoisted(() => ({ org: '' }));

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000009a1', role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const rattacher = await import('@/app/api/zones/jeux/[id]/rattacher/route');
const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');
const cpExtraction = await import('@/app/api/zones/jeux/[id]/extractions/[version]/cp/route');
const canaux = await import('@/app/api/campaigns/[campaignId]/channels/route');
const strategies = await import('@/app/api/bidding/strategies/route');

/** « Seveso France — test phase 4 », jeu RISQUE de référence (caractérisation du lot 5), espace GENESIS (Global). */
const JEU_RISQUE = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const ORG_RISQUE = '00000000-0000-0000-0000-000000000001';

let org = '';
let autreOrg = '';
let campagne = '';
let campagneRisque = '';
let jeu = '';
let autreJeu = '';
let jeuAutreEspace = '';
let extraction = '';
let extractionAutreJeu = '';
let jeuSansCp = '';
let extractionSansCp = '';
let campagneSansCp = '';

const json = (methode: string, corps: unknown) =>
  ({ method: methode, body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const lier = (id: string, corps: unknown) =>
  rattacher.POST(new NextRequest(`http://localhost/api/zones/jeux/${id}/rattacher`, json('POST', corps)), params(id));
const lireCp = (id: string, version: number, q = '') =>
  cpExtraction.GET(new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions/${version}/cp${q}`),
    { params: Promise.resolve({ id, version: String(version) }) });
const urlCanaux = (c: string) => `http://localhost/api/campaigns/${c}/channels`;
const pCanaux = (c: string) => ({ params: Promise.resolve({ campaignId: c }) });

async function nouvelleOrg(nom: string): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: `[ESSAI lot6 T1] ${nom}`, slug: `essai-lot6-t1-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

/** Un rayon de 5 km autour de Lyon : assez de CP pour deux seuils distincts. */
async function creerZone(nom: string, orgId: string): Promise<string> {
  const recette = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000 };
  const { data: rayon, error: e1 } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: 5000 });
  if (e1) throw new Error(e1.message);
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: orgId, p_cree_par: null, p_recette: recette,
    p_geometry_geojson: JSON.stringify((rayon as { geometry: unknown }).geometry),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** Un jeu de zone enregistré, avec ses choix de plateformes. */
async function creerJeu(orgId: string, zoneId: string, nom: string, choix: Record<string, unknown>[]): Promise<string> {
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: orgId, nom, type: 'zone', custom_geo_zone_id: zoneId, cible: 'ind', mode_plan: 'pondere', brouillon: false, version: 1,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  const ins = await sb.from('zone_set_plateformes').insert(choix.map((c) => ({ zone_set_id: data.id, rayon_m: null, ...c })));
  if (ins.error) throw new Error(ins.error.message);
  return data.id as string;
}

/** Fige le jeu par la vraie route d'extraction (lot 5) et rend l'identifiant de la version 1. */
async function extraire(id: string): Promise<string> {
  const r = await extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions`, json('POST', {})), params(id));
  if (r.status !== 201) throw new Error(`extraction ${r.status} : ${JSON.stringify(await r.json())}`);
  return (await r.json() as { id: string }).id;
}

async function nouvelleCampagne(orgId: string, nom: string): Promise<string> {
  const { data, error } = await sb.from('dsp_campaigns')
    .insert({ name: `[ESSAI lot6 T1] ${nom}`, organization_id: orgId, is_demo: true }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  appelant.org = org;
  const zone = await creerZone('Lyon 5 km', org);
  const zoneAutre = await creerZone('Lyon 5 km (autre espace)', autreOrg);
  // DV360 au CP à 20 %, Meta au CP à 50 % (un sous-ensemble), TikTok à la commune (aucun CP).
  jeu = await creerJeu(org, zone, 'Lyon trois plateformes', [
    { plateforme: 'dv360', maille: 'cp', seuil: 20 },
    { plateforme: 'meta', maille: 'cp', seuil: 50 },
    { plateforme: 'tiktok', maille: 'commune', seuil: 20 },
  ]);
  autreJeu = await creerJeu(org, zone, 'Lyon DV360 seul', [{ plateforme: 'dv360', maille: 'cp', seuil: 30 }]);
  jeuAutreEspace = await creerJeu(autreOrg, zoneAutre, 'Lyon autre espace', [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }]);
  // T6 : aucune plateforme au CP (TikTok seul, aux communes) — l'extraction n'a aucun plan CP.
  jeuSansCp = await creerJeu(org, zone, 'Lyon TikTok seul', [{ plateforme: 'tiktok', maille: 'commune', seuil: 20 }]);
  extraction = await extraire(jeu);
  extractionAutreJeu = await extraire(autreJeu);
  extractionSansCp = await extraire(jeuSansCp);
  campagneSansCp = await nouvelleCampagne(org, 'campagne sans CP');
  campagne = await nouvelleCampagne(org, 'campagne');
  campagneRisque = await nouvelleCampagne(ORG_RISQUE, 'campagne risque');
}, LONG);

afterAll(async () => {
  if (campagneRisque) {
    const { error } = await sb.from('dsp_campaigns').delete().eq('id', campagneRisque);
    if (error) throw new Error(`nettoyage de la campagne risque : ${error.message}`);
  }
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const camps = await sb.from('dsp_campaigns').delete().eq('organization_id', o);
    if (camps.error) throw new Error(`nettoyage des campagnes : ${camps.error.message}`);
    // Les jeux avant les zones (clé étrangère `on delete restrict`) ; leurs extractions partent en cascade.
    const jeux = await sb.from('zone_sets').delete().eq('org_id', o);
    if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
    const { error } = await sb.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
}, LONG);

/** Les lignes d'un ensemble absentes de l'autre, dans les deux sens (0 = identiques à l'unité près). */
const ecartPlan = (strategie: string, extractionId: string) => Number(psql(`
  with plan as (select postal_code as cp, bid_multiplier as m from public.bidding_zone_configs where strategy_id = '${strategie}'),
       ext as (select code_postal as cp, multiplicateur as m from public.zone_set_extraction_cp
               where extraction_id = '${extractionId}' and multiplicateur > 0)
  select (select count(*) from (select * from plan except select * from ext) a)
       + (select count(*) from (select * from ext except select * from plan) b);`));

describe('POST /api/zones/jeux/[id]/rattacher — avec une extraction', () => {
  it('201 : le plan écrit = les CP à multiplicateur > 0 de l’extraction ; stratégie nommée et sourcée', async () => {
    const r = await lier(jeu, { campagne, extraction });
    expect(r.status).toBe(201);
    const corps = await r.json() as { strategie: string; codes_postaux: number; extraction: string; extraction_version: number };
    expect(corps).toMatchObject({ jeu, extraction, extraction_version: 1 });

    const attendus = Number(psql(`select count(*) from public.zone_set_extraction_cp
      where extraction_id = '${extraction}' and multiplicateur > 0;`));
    expect(attendus).toBeGreaterThan(0);
    expect(corps.codes_postaux).toBe(attendus);
    expect(ecartPlan(corps.strategie, extraction)).toBe(0);

    const { data: x } = await sb.from('zone_set_extractions').select('taux_utile, part_plan_en_zone').eq('id', extraction).single();
    const { data: s, error } = await sb.from('bidding_strategies')
      .select('name, objective_code, algorithm_code, weighting_mode, status, in_zone_weights').eq('id', corps.strategie).single();
    if (error) throw new Error(error.message);
    expect(s).toMatchObject({
      name: 'Jeu de zones — Lyon trois plateformes (extraction v1)',
      objective_code: 'maximize_impressions', algorithm_code: 'zone_set', weighting_mode: 'by_zone_set', status: 'active',
    });
    const poids = s.in_zone_weights as Record<string, unknown>;
    expect(poids).toMatchObject({
      mode: 'zone_set', zone_set_id: jeu, extraction_id: extraction, extraction_version: 1,
      taux_utile: x!.taux_utile, part_plan_en_zone: x!.part_plan_en_zone,
    });
    expect((poids.plateformes as { plateforme: string }[]).map((p) => p.plateforme)).toEqual(['dv360', 'meta', 'tiktok']);
  }, LONG);

  it('l’extraction d’un AUTRE jeu : 404, rien d’écrit', async () => {
    const avant = Number(psql(`select count(*) from public.bidding_strategies where campaign_id = '${campagne}';`));
    const r = await lier(jeu, { campagne, extraction: extractionAutreJeu });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Extraction introuvable pour ce jeu.');
    expect(Number(psql(`select count(*) from public.bidding_strategies where campaign_id = '${campagne}';`))).toBe(avant);
  });

  it('le jeu d’un AUTRE espace : 404 du chargeur', async () => {
    const r = await lier(jeuAutreEspace, { campagne, extraction });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Jeu de zones introuvable dans cet espace.');
  });

  it('sans extraction, un jeu de zone reste refusé : 409 (inchangé)', async () => {
    const r = await lier(jeu, { campagne });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Ce jeu de zones se gère à l'étape ⑤ de la carte.");
  });

  it('un identifiant d’extraction qui n’est pas un UUID : 400', async () => {
    expect((await lier(jeu, { campagne, extraction: 'v1' })).status).toBe(400);
  });
});

describe('POST /api/zones/jeux/[id]/rattacher — extraction SANS plateforme au CP (T6)', () => {
  it('201 : stratégie écrite et active, 0 CP, aucune ligne de bidding_zone_configs, résumé TikTok recopié', async () => {
    expect(Number(psql(`select count(*) from public.zone_set_extraction_cp where extraction_id = '${extractionSansCp}';`))).toBe(0);
    const r = await lier(jeuSansCp, { campagne: campagneSansCp, extraction: extractionSansCp });
    expect(r.status).toBe(201);
    const corps = await r.json() as { strategie: string; codes_postaux: number; extraction: string };
    expect(corps).toMatchObject({ jeu: jeuSansCp, codes_postaux: 0, extraction: extractionSansCp, anciennes_archivees: true });
    expect(Number(psql(`select count(*) from public.bidding_zone_configs where strategy_id = '${corps.strategie}';`))).toBe(0);
    const { data: s, error } = await sb.from('bidding_strategies')
      .select('status, objective_code, in_zone_weights').eq('id', corps.strategie).single();
    if (error) throw new Error(error.message);
    expect(s).toMatchObject({ status: 'active', objective_code: 'maximize_impressions' });
    expect(((s.in_zone_weights as Record<string, unknown>).plateformes as { plateforme: string; maille: string }[]))
      .toEqual([expect.objectContaining({ plateforme: 'tiktok', maille: 'commune' })]);
  }, LONG);
});

describe('POST /api/zones/jeux/[id]/rattacher — jeu risque VIVANT (chemin du wizard React, inchangé)', () => {
  it('201 : les chiffres d’avant le lot 6 (« Seveso France — test phase 4 », seuil enregistré 35, pondéré)', async () => {
    appelant.org = ORG_RISQUE;
    try {
      const r = await lier(JEU_RISQUE, { campagne: campagneRisque });
      expect(r.status).toBe(201);
      const corps = await r.json() as Record<string, unknown>;
      // Mesuré le 2026-10-25 sur le code d'AVANT T1 (même jeu, même base) : la caractérisation du chemin vivant.
      expect(corps).toMatchObject({
        jeu: JEU_RISQUE, version: 2, codes_postaux: 2000, mode_plan: 'pondere', n_retenus: 931, taux_utile: 79.8,
        part_plan_en_zone: 52.9, anciennes_archivees: true,
      });
      expect(corps.extraction).toBeUndefined();
      const { data: s } = await sb.from('bidding_strategies').select('name, in_zone_weights').eq('id', corps.strategie as string).single();
      expect(s!.name).toMatch(/^Jeu de zones — .+ \(v\d+\)$/);
      expect((s!.in_zone_weights as Record<string, unknown>).extraction_id).toBeUndefined();
    } finally {
      appelant.org = org;
    }
  }, LONG);
});

describe('GET /api/zones/jeux/[id]/extractions/[version]/cp', () => {
  it('sans plateforme : le même compte que le plan écrit dans bidding_zone_configs', async () => {
    const r = await lireCp(jeu, 1);
    expect(r.status).toBe(200);
    const { cp, total, retenus } = await r.json() as { cp: { code_postal: string; multiplicateur: number }[]; total: number; retenus: number };
    const strategie = psql(`select id from public.bidding_strategies where campaign_id = '${campagne}' and status = 'active';`);
    const ecrits = Number(psql(`select count(*) from public.bidding_zone_configs where strategy_id = '${strategie}';`));
    expect(total).toBe(ecrits);
    expect(cp).toHaveLength(ecrits);
    expect(cp.every((c) => c.multiplicateur > 0)).toBe(true);
    // `retenus` : les lignes RETENUES du plan écrit, dans l'unité de `total` (codes bruts, preuve du lot 6, D-3).
    const extraction = psql(`select id from public.zone_set_extractions where zone_set_id = '${jeu}' and version = 1;`);
    expect(retenus).toBe(Number(psql(
      `select count(*) from public.zone_set_extraction_cp where extraction_id = '${extraction}' and multiplicateur > 0 and retenu;`,
    )));
    expect(retenus).toBeLessThanOrEqual(total);
  });

  it('par plateforme : Meta (seuil 50) ⊂ DV360 (seuil 20) ; TikTok (commune) n’a aucun CP', async () => {
    const lire = async (p: string) => (await (await lireCp(jeu, 1, `?plateforme=${p}`)).json()) as { cp: { code_postal: string }[]; total: number };
    const dv = await lire('dv360');
    const meta = await lire('meta');
    const tiktok = await lire('tiktok');
    expect(meta.total).toBeGreaterThan(0);
    expect(meta.total).toBeLessThan(dv.total);
    const deDv = new Set(dv.cp.map((c) => c.code_postal));
    expect(meta.cp.every((c) => deDv.has(c.code_postal))).toBe(true);
    expect(tiktok).toEqual({ cp: [], total: 0, retenus: 0 });
  });

  it('une version absente : 404 ; un jeu d’un autre espace : 404 ; une version qui n’est pas un entier : 400', async () => {
    expect((await lireCp(jeu, 9)).status).toBe(404);
    expect((await lireCp(jeuAutreEspace, 1)).status).toBe(404);
    const r = await cpExtraction.GET(new NextRequest(`http://localhost/api/zones/jeux/${jeu}/extractions/x/cp`),
      { params: Promise.resolve({ id: jeu, version: 'x' }) });
    expect(r.status).toBe(400);
  });
});

describe('GET /api/bidding/strategies?campaign_id= (relecture 1)', () => {
  const lister = (q: string) => strategies.GET(new NextRequest(`http://localhost/api/bidding/strategies${q}`));

  it('la SEULE plus récente de la campagne (la stratégie active du rattachement), pas la liste de l’espace', async () => {
    const r = await lister(`?campaign_id=${campagne}`);
    expect(r.status).toBe(200);
    const { strategies: lues } = await r.json() as { strategies: { id: string; campaign_id: string; status: string }[] };
    const active = psql(`select id from public.bidding_strategies where campaign_id = '${campagne}' and status = 'active';`);
    expect(lues).toHaveLength(1);
    expect(lues[0]).toMatchObject({ id: active, campaign_id: campagne, status: 'active' });
  });

  it('un campaign_id qui n’est pas un UUID : 400 ; une campagne d’un autre espace : liste vide', async () => {
    expect((await lister('?campaign_id=x')).status).toBe(400);
    appelant.org = autreOrg;
    try {
      expect((await (await lister(`?campaign_id=${campagne}`)).json()).strategies).toEqual([]);
    } finally {
      appelant.org = org;
    }
  });
});

describe('PUT /api/campaigns/[campaignId]/channels — cpm_prevus', () => {
  const ecrire = (corps: unknown) => canaux.PUT(new NextRequest(urlCanaux(campagne), json('PUT', corps)), pCanaux(campagne));
  const lire = async () => (await (await canaux.GET(new NextRequest(urlCanaux(campagne)), pCanaux(campagne))).json()) as {
    selected: { budgets?: Record<string, number>; cpm_prevus?: Record<string, number> };
  };

  it('relu par le GET, conservé quand un PUT ne le renvoie pas, élagué au retrait du canal', async () => {
    const sel = { dsps: ['dv360'], socials: ['meta'], ad_server: null };
    expect((await ecrire({ ...sel, budgets: { dv360: 1000, meta: 500 }, cpm_prevus: { dv360: 4.5, meta: 3 } })).status).toBe(200);
    expect((await lire()).selected).toMatchObject({ budgets: { dv360: 1000, meta: 500 }, cpm_prevus: { dv360: 4.5, meta: 3 } });

    // Un PUT de sélection seule (le React de StepCanaux) ne l'efface pas.
    expect((await ecrire(sel)).status).toBe(200);
    expect((await lire()).selected.cpm_prevus).toEqual({ dv360: 4.5, meta: 3 });

    // Meta retiré : sa ligne part, comme son budget.
    expect((await ecrire({ dsps: ['dv360'], socials: [], ad_server: null })).status).toBe(200);
    const apres = (await lire()).selected;
    expect(apres.cpm_prevus).toEqual({ dv360: 4.5 });
    expect(apres.budgets).toEqual({ dv360: 1000 });
  });

  it('un CPM négatif : 400', async () => {
    expect((await ecrire({ dsps: ['dv360'], socials: [], ad_server: null, cpm_prevus: { dv360: -1 } })).status).toBe(400);
  });
});

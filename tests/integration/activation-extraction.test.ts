/**
 * ⑦ Activation d'une campagne lancée depuis une EXTRACTION (lot 7, T1 ; E1-E4, Review Focus 1, 2 et 4), contre la
 * vraie base locale, par les vraies routes :
 * - pré-vol avant publication → `jamais_publiee` ; après `publier` → activable, `mode_dv360 = 'simule'` (démo, aucune
 *   connexion DV360 dans l'espace), `n_cp_dv360` = les lignes de `…/cp?plateforme=dv360` ;
 * - `pousser` sur 2 line items → NDJSON `debut` (`mode: 'simule'`), 2 `cible` `pousse`, `fin` `termine` ; le lot porte
 *   `mode = 'simule'`, l'historique le rend ; relancer `rattacher` → `jamais_publiee`, l'ancien lot reste listé ;
 * - la même campagne sans `is_demo` → `indisponible`, `pousser` 409 sans lot écrit ;
 * - une extraction Meta + TikTok seuls → `n_cp_dv360 = 0`, motif `aucun_cp_dv360`, 200 ;
 * - un jeu RISQUE rattaché par extraction → `n_cp_dv360` = le plan entier ;
 * - caractérisation du chemin `zone_id` : `pousser` simulé → les comptes du mapping de la zone, comme `targeting/push`.
 *
 * Seuls l'appelant (super_admin) et les quotas sont simulés. Rien ne part chez Google : toutes les campagnes sont de
 * démo dans des espaces sans connexion DV360 active. Campagnes `[ESSAI lot7 T1]` supprimées à la fin (stratégies,
 * versions, lots et cibles en cascade), espace d'essai et ses jeux aussi, journaux DSP des campagnes d'essai effacés.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { psql } from './_psql';
import { mapPostalCodesToGeoIds } from '@/lib/digital/dv360-geo';
import { creerEspaceFixture, extraireJeuZone, nettoyerEspaceFixture } from './_jeu-zone-fixture';

const sb = creerClientTest();
const LONG = 180_000;
const appelant = vi.hoisted(() => ({ org: '' }));

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000007a1', role: 'super_admin', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const rattacher = await import('@/app/api/zones/jeux/[id]/rattacher/route');
const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');
const cpExtraction = await import('@/app/api/zones/jeux/[id]/extractions/[version]/cp/route');
const publier = await import('@/app/api/bidding/strategies/[id]/publier/route');
const prevolRoute = await import('@/app/api/campaigns/[campaignId]/activation/prevol/route');
const pousserRoute = await import('@/app/api/campaigns/[campaignId]/activation/pousser/route');
const historiqueRoute = await import('@/app/api/campaigns/[campaignId]/activation/historique/route');

/**
 * Le jeu de ZONE extrait (dv360 CP, meta cercle, tiktok, ttd), créé par le test dans son propre espace et supprimé à la
 * fin (fixture `_jeu-zone-fixture.ts`, relecture du lot 4) — jusque-là l'id en dur `66061937` (« Lycées 5 km — BdR »,
 * preuve du lot 6), absent d'une base reconstruite.
 */
let JEU = '';
let EXTRACTION = '';
let ORG_JEU = '';
/** « Seveso France — test phase 4 », jeu RISQUE de référence ; son extraction v1 n'a ni `plateformes` ni unités. */
const JEU_RISQUE = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const EXTRACTION_RISQUE = 'b7c11e25-7734-4766-bbb2-c4695c51c7f2';
const ORG_RISQUE = '00000000-0000-0000-0000-000000000001';

const campagnes: string[] = [];
let orgEssai = '';

const json = (corps: unknown) =>
  ({ method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const pC = (c: string) => ({ params: Promise.resolve({ campaignId: c }) });
const pId = (id: string) => ({ params: Promise.resolve({ id }) });

const lier = async (jeu: string, campagne: string, extraction: string) => {
  const r = await rattacher.POST(new NextRequest(`http://localhost/api/zones/jeux/${jeu}/rattacher`, json({ campagne, extraction })), pId(jeu));
  if (r.status !== 201) throw new Error(`rattacher ${r.status} : ${JSON.stringify(await r.json())}`);
  return (await r.json()) as { strategie: string };
};
const publierStrategie = async (strategie: string) => {
  const r = await publier.POST(new NextRequest(`http://localhost/api/bidding/strategies/${strategie}/publier`, { method: 'POST' }), pId(strategie));
  if (r.status !== 201) throw new Error(`publier ${r.status} : ${JSON.stringify(await r.json())}`);
};

interface Prevol {
  strategie: { id: string } | null; activable: boolean; blocages: string[];
  mode_dv360: string; n_cp_dv360: number; extraction: { zone_set_id: string; version: number } | null;
  motifs: { code: string; message: string }[];
}
const prevol = async (c: string) => {
  const r = await prevolRoute.GET(new NextRequest(`http://localhost/api/campaigns/${c}/activation/prevol`), pC(c));
  expect(r.status).toBe(200);
  return (await r.json()) as Prevol;
};
const pousser = (c: string, lineItems: string[]) => pousserRoute.POST(
  new NextRequest(`http://localhost/api/campaigns/${c}/activation/pousser`, json({
    canal: 'dv360', advertiser_id: '123', cibles: lineItems.map((line_item_id) => ({ line_item_id })),
  })),
  pC(c),
);
const lignesNdjson = async (r: Response) =>
  (await r.text()).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
const historique = async (c: string) => {
  const r = await historiqueRoute.GET(new NextRequest(`http://localhost/api/campaigns/${c}/activation/historique`), pC(c));
  return ((await r.json()) as { lots: { id: string; mode: string; statut: string; version_strategie: number }[] }).lots;
};
const nLots = (c: string) => Number(psql(`select count(*) from public.activation_lots where campaign_id = '${c}';`));

async function nouvelleCampagne(orgId: string, nom: string, demo = true): Promise<string> {
  const { data, error } = await sb.from('dsp_campaigns')
    .insert({ name: `[ESSAI lot7 T1] ${nom}`, organization_id: orgId, is_demo: demo }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  campagnes.push(data.id as string);
  return data.id as string;
}

/** Un rayon de 5 km autour de Lyon (patron du lot 6). */
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

beforeAll(async () => {
  const { data, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI lot7 T1] espace', slug: `essai-lot7-t1-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  orgEssai = data.id as string;
  ORG_JEU = await creerEspaceFixture(sb, 'activation-extraction');
  appelant.org = ORG_JEU;
  ({ jeu: JEU, extraction: EXTRACTION } = await extraireJeuZone(sb, ORG_JEU, (jeu) => extractions.POST(
    new NextRequest(`http://localhost/api/zones/jeux/${jeu}/extractions`, json({})), pId(jeu))));
}, LONG);

afterAll(async () => {
  for (const c of campagnes) {
    const logs = await sb.from('dsp_api_logs').delete().eq('detail->>campaign_id', c);
    if (logs.error) throw new Error(`nettoyage des journaux : ${logs.error.message}`);
    const { error } = await sb.from('dsp_campaigns').delete().eq('id', c);
    if (error) throw new Error(`nettoyage de la campagne : ${error.message}`);
  }
  if (orgEssai) {
    // Les jeux avant les zones (clé étrangère `on delete restrict`) ; leurs extractions partent en cascade.
    const jeux = await sb.from('zone_sets').delete().eq('org_id', orgEssai);
    if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
    const { error } = await sb.from('organizations').delete().eq('id', orgEssai);
    if (error) throw new Error(`nettoyage de l’espace : ${error.message}`);
  }
  await nettoyerEspaceFixture(sb, ORG_JEU);
}, LONG);

describe('⑦ campagne lancée depuis l’extraction v1 du jeu de zone de la fixture', () => {
  let campagne = '';
  let lotV1 = '';

  it('pré-vol avant publication : `jamais_publiee` ; après : activable en simulé, n_cp_dv360 = …/cp?plateforme=dv360', async () => {
    appelant.org = ORG_JEU;
    campagne = await nouvelleCampagne(ORG_JEU, 'extraction fixture');
    const { strategie } = await lier(JEU, campagne, EXTRACTION);

    const avant = await prevol(campagne);
    expect(avant.motifs.map((m) => m.code)).toEqual(['jamais_publiee']);
    expect(avant.blocages).toEqual(avant.motifs.map((m) => m.message));
    expect(avant.activable).toBe(false);
    expect(avant.extraction).toEqual({ zone_set_id: JEU, version: 1 });

    await publierStrategie(strategie);
    const apres = await prevol(campagne);
    expect(apres).toMatchObject({ activable: true, mode_dv360: 'simule', motifs: [], blocages: [] });
    expect(apres.strategie?.id).toBe(strategie);

    const r = await cpExtraction.GET(
      new NextRequest(`http://localhost/api/zones/jeux/${JEU}/extractions/1/cp?plateforme=dv360`),
      { params: Promise.resolve({ id: JEU, version: '1' }) },
    );
    const cp = (await r.json()) as { total: number };
    expect(cp.total).toBeGreaterThan(0);
    expect(apres.n_cp_dv360).toBe(cp.total);
  }, LONG);

  it('pousser 2 line items : flux simulé complet, lot `simule` écrit et rendu par l’historique', async () => {
    const r = await pousser(campagne, ['111', '222']);
    expect(r.status).toBe(200);
    const lignes = await lignesNdjson(r);
    expect(lignes[0]).toMatchObject({ etape: 'debut', canal: 'dv360', mode: 'simule', version_strategie: 1, total: 2 });
    const pousses = lignes.filter((l) => l.etape === 'cible' && l.statut === 'pousse');
    expect(pousses.map((l) => l.line_item_id)).toEqual(['111', '222']);
    const { cp } = await (await cpExtraction.GET(
      new NextRequest(`http://localhost/api/zones/jeux/${JEU}/extractions/1/cp?plateforme=dv360`),
      { params: Promise.resolve({ id: JEU, version: '1' }) },
    )).json() as { cp: { code_postal: string }[] };
    const attendu = mapPostalCodesToGeoIds(cp.map((c) => c.code_postal));
    for (const l of pousses) {
      expect(l).toMatchObject({ n_geo_ids: attendu.mapped.length, cp_non_resolus: attendu.unmapped.length });
    }
    expect(lignes.at(-1)).toMatchObject({ etape: 'fin', statut: 'termine', pousses: 2, echecs: 0, interrompu: false });
    lotV1 = lignes[0].lot_id as string;

    expect(psql(`select mode || '|' || statut from public.activation_lots where id = '${lotV1}';`)).toBe('simule|termine');
    expect(psql(`select string_agg(distinct etat_avant->>'mode' || '/' || (etat_avant->>'extraction_id'), ',')
      from public.activation_cibles where lot_id = '${lotV1}';`)).toBe(`simule/${EXTRACTION}`);
    expect((await historique(campagne)).find((l) => l.id === lotV1)).toMatchObject({ mode: 'simule', statut: 'termine' });
  }, LONG);

  it('un super_admin dont l’espace actif est AUTRE que celui de l’extraction : 404, aucun lot (relecture 1, I-1)', async () => {
    appelant.org = orgEssai;
    try {
      const avant = nLots(campagne);
      const p = await prevolRoute.GET(new NextRequest(`http://localhost/api/campaigns/${campagne}/activation/prevol`), pC(campagne));
      expect(p.status).toBe(404);
      expect(await p.json()).toEqual({ error: 'Extraction introuvable dans cet espace.' });
      const r = await pousser(campagne, ['111']);
      expect(r.status).toBe(404);
      expect(nLots(campagne)).toBe(avant);
    } finally { appelant.org = ORG_JEU; }
  }, LONG);

  it('campagne relancée en ⑥ (nouveau rattachement) : `jamais_publiee`, l’ancien lot reste listé (Review Focus 4)', async () => {
    const { strategie } = await lier(JEU, campagne, EXTRACTION);
    const p = await prevol(campagne);
    expect(p.strategie?.id).toBe(strategie);
    expect(p.motifs.map((m) => m.code)).toEqual(['jamais_publiee']);
    expect((await historique(campagne)).find((l) => l.id === lotV1)).toMatchObject({ version_strategie: 1, mode: 'simule' });
    await publierStrategie(strategie);
  }, LONG);

  it('la même campagne sans `is_demo` : indisponible, `pousser` 409 sans lot écrit', async () => {
    const { error } = await sb.from('dsp_campaigns').update({ is_demo: false }).eq('id', campagne);
    if (error) throw new Error(error.message);
    const p = await prevol(campagne);
    expect(p.mode_dv360).toBe('indisponible');
    expect(p.motifs.map((m) => m.code)).toEqual(['aucune_connexion']);
    expect(p.activable).toBe(false);

    const avant = nLots(campagne);
    const r = await pousser(campagne, ['111']);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'aucune_connexion' });
    expect(nLots(campagne)).toBe(avant);
  }, LONG);
});

describe('⑦ extraction Meta + TikTok seuls (Review Focus 1)', () => {
  it('n_cp_dv360 = 0, motif `aucun_cp_dv360`, pré-vol 200 ; pousser 409 sans lot', async () => {
    appelant.org = orgEssai;
    const zone = await creerZone('Lyon 5 km', orgEssai);
    const { data: jeu, error } = await sb.from('zone_sets').insert({
      org_id: orgEssai, nom: 'Lyon Meta + TikTok', type: 'zone', custom_geo_zone_id: zone, cible: 'ind',
      mode_plan: 'pondere', brouillon: false, version: 1,
    }).select('id').single();
    if (error || !jeu) throw new Error(error?.message);
    const ins = await sb.from('zone_set_plateformes').insert([
      { zone_set_id: jeu.id, plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 5000 },
      { zone_set_id: jeu.id, plateforme: 'tiktok', maille: 'departement', seuil: 20, rayon_m: null },
    ]);
    if (ins.error) throw new Error(ins.error.message);
    const rx = await extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${jeu.id}/extractions`, json({})), pId(jeu.id));
    if (rx.status !== 201) throw new Error(`extraction ${rx.status} : ${JSON.stringify(await rx.json())}`);
    const extraction = ((await rx.json()) as { id: string }).id;

    const campagne = await nouvelleCampagne(orgEssai, 'Meta + TikTok');
    const { strategie } = await lier(jeu.id, campagne, extraction);
    await publierStrategie(strategie);
    const p = await prevol(campagne);
    expect(p).toMatchObject({ n_cp_dv360: 0, mode_dv360: 'simule', activable: false });
    expect(p.motifs).toEqual([
      { code: 'aucun_cp_dv360', message: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.' },
    ]);
    const r = await pousser(campagne, ['111']);
    expect(r.status).toBe(409);
    expect(nLots(campagne)).toBe(0);
  }, LONG);

  it('caractérisation du chemin `zone_id` : pousser simulé rend les comptes du mapping de la zone', async () => {
    appelant.org = orgEssai;
    const zone = await creerZone('Lyon 5 km (stratégie à zone)', orgEssai);
    // Les CP de la zone, par la requête CP de `resolve_custom_geo_zone_codes` (sql/252, qui exige un `auth.uid()`) :
    // c'est ce que lit `lireCodesDeZone`.
    psql(`insert into public.custom_geo_zone_codes (zone_id, code_type, code)
      select distinct z.id, 'cp', cp.code_postal from public.custom_geo_zones z
      join public.ref_codes_postaux cp on cp.geom is not null and st_intersects(cp.geom, z.geometry)
      where z.id = '${zone}';`);
    const campagne = await nouvelleCampagne(orgEssai, 'stratégie à zone');
    const { data: s, error } = await sb.from('bidding_strategies').insert({
      name: '[ESSAI lot7 T1] zone', campaign_id: campagne, algorithm_code: 'zone_set',
      objective_code: 'maximize_impressions', scope_type: 'custom_zone', zone_id: zone, status: 'active',
    }).select('id').single();
    if (error || !s) throw new Error(error?.message);
    await publierStrategie(s.id as string);

    const codes = psql(`select string_agg(code, ',' order by code) from public.custom_geo_zone_codes
      where zone_id = '${zone}' and code_type = 'cp';`).split(',');
    const attendu = mapPostalCodesToGeoIds(codes);
    expect(attendu.mapped.length).toBeGreaterThan(0);

    const p = await prevol(campagne);
    expect(p).toMatchObject({ activable: true, mode_dv360: 'simule', n_cp_dv360: codes.length, extraction: null });
    const lignes = await lignesNdjson(await pousser(campagne, ['333']));
    expect(lignes.find((l) => l.etape === 'cible' && l.statut === 'pousse'))
      .toMatchObject({ n_geo_ids: attendu.mapped.length, cp_non_resolus: attendu.unmapped.length });
    expect(lignes.at(-1)).toMatchObject({ etape: 'fin', statut: 'termine' });
    expect(psql(`select etat_avant->>'zone_id' from public.activation_cibles c join public.activation_lots l on l.id = c.lot_id
      where l.campaign_id = '${campagne}';`)).toBe(zone);

    // Relecture 1 (I-1) : vue depuis un AUTRE espace actif, la zone est introuvable — 404, rien d'écrit.
    appelant.org = ORG_JEU;
    const avant = nLots(campagne);
    const refus = await prevolRoute.GET(new NextRequest(`http://localhost/api/campaigns/${campagne}/activation/prevol`), pC(campagne));
    expect(refus.status).toBe(404);
    expect(await refus.json()).toEqual({ error: 'Zone introuvable.' });
    const r = await pousser(campagne, ['333']);
    expect(r.status).toBe(404);
    expect(nLots(campagne)).toBe(avant);
  }, LONG);
});

describe('⑦ jeu RISQUE rattaché par extraction (Review Focus 2)', () => {
  it('n_cp_dv360 = le plan CP entier de l’extraction, et …/cp?plateforme=dv360 le rend aussi', async () => {
    appelant.org = ORG_RISQUE;
    const campagne = await nouvelleCampagne(ORG_RISQUE, 'risque');
    await lier(JEU_RISQUE, campagne, EXTRACTION_RISQUE);
    const plan = Number(psql(`select count(*) from public.zone_set_extraction_cp
      where extraction_id = '${EXTRACTION_RISQUE}' and multiplicateur > 0;`));
    expect(plan).toBeGreaterThan(0);

    const p = await prevol(campagne);
    expect(p.n_cp_dv360).toBe(plan);
    // L'espace a une connexion DV360 en ERREUR : une démo s'y pousse en simulé.
    expect(p.mode_dv360).toBe('simule');
    expect(p.motifs.map((m) => m.code)).toEqual(['jamais_publiee']);

    const r = await cpExtraction.GET(
      new NextRequest(`http://localhost/api/zones/jeux/${JEU_RISQUE}/extractions/1/cp?plateforme=dv360`),
      { params: Promise.resolve({ id: JEU_RISQUE, version: '1' }) },
    );
    expect(((await r.json()) as { total: number }).total).toBe(plan);
  }, LONG);
});

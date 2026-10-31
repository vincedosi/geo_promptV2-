/**
 * A8 (amendement E5, sql/306) contre la vraie base locale : la part prévue du suivi, découplée du multiplicateur.
 *
 * - l'extraction d'un jeu de zone (Toulouse : le groupe 31000 de six codes indiscernables) fige `part_prevue` par code
 *   et la ligne HORS_ZONE dans `resume_plan` ; Σ des parts (codes + HORS_ZONE) = 1 ; les six membres du groupe se
 *   partagent À PARTS ÉGALES la part de l'unité (somme par unité, ruling 1) ;
 * - `hors_zone_extraction` / `lireHorsZone`, LE lecteur partagé : volume = référentiel − unités retenues (ruling 2) ;
 * - `rattacher` recopie `part_prevue` dans `bidding_zone_configs`, et `refresh_campaign_rollups` la donne telle quelle
 *   à `campaign_cp_rollup.planned_share` (le groupe ne pèse plus six fois) ;
 * - un plan SANS part prévue (chemin ⑥ hors jeu de zone) garde m ÷ Σ m, inchangé.
 *
 * Seuls l'appelant et les quotas sont simulés. Un espace `[ESSAI A8]` est créé puis supprimé, avec ses jeux,
 * extractions, campagnes et stratégies (cascades).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { psql, psqlLignes } from './_psql';
import { lireHorsZone, lireVolumesAttendus } from '@/lib/zones/part-prevue-serveur';

const sb = creerClientTest();
const LONG = 120_000;
const appelant = vi.hoisted(() => ({ org: '' }));

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000009a8', role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const rattacher = await import('@/app/api/zones/jeux/[id]/rattacher/route');
const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');

const TOULOUSE = ['31000', '31100', '31200', '31300', '31400', '31500'];

let org = '';
let jeuStrict = '';
let jeuNational = '';
let extStrict = '';
let extNational = '';
let campagne = '';
let campagneHorsJeu = '';

const json = (corps: unknown) => ({ method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function creerJeu(zoneId: string, nom: string, mode: 'exclusif' | 'pondere'): Promise<string> {
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: org, nom, type: 'zone', custom_geo_zone_id: zoneId, cible: 'ind', mode_plan: mode, brouillon: false, version: 1,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  const ins = await sb.from('zone_set_plateformes').insert({ zone_set_id: data.id, plateforme: 'dv360', maille: 'cp', seuil: 10, rayon_m: null });
  if (ins.error) throw new Error(ins.error.message);
  return data.id as string;
}

async function extraire(id: string): Promise<string> {
  const r = await extractions.POST(new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions`, json({})), params(id));
  if (r.status !== 201) throw new Error(`extraction ${r.status} : ${JSON.stringify(await r.json())}`);
  return (await r.json() as { id: string }).id;
}

async function nouvelleCampagne(nom: string): Promise<string> {
  const { data, error } = await sb.from('dsp_campaigns')
    .insert({ name: `[ESSAI A8] ${nom}`, organization_id: org, is_demo: true }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

/** Une impression par code, sur une journée : le rollup ne porte que les CP livrés. */
async function livrer(campagneId: string, codes: readonly string[]): Promise<void> {
  const { error } = await sb.from('dsp_campaign_data').insert(codes.map((c) => ({
    campaign_id: campagneId, date: '2026-10-30', country: 'FR', postal_code: c, tracked_ads: 100, impressions: 100,
  })));
  if (error) throw new Error(error.message);
}

const partsDe = (extractionId: string) => new Map(psqlLignes(`
  select code_postal || ':' || coalesce(part_prevue::text, 'null') from public.zone_set_extraction_cp
   where extraction_id = '${extractionId}' and retenu order by code_postal;`).filter(Boolean)
  .map((l) => { const [c, p] = l.split(':'); return [c, p === 'null' ? null : Number(p)] as const; }));

beforeAll(async () => {
  const o = await sb.from('organizations').insert({ name: '[ESSAI A8] part prévue', slug: `essai-a8-${Date.now()}` }).select('id').single();
  if (o.error || !o.data) throw new Error(o.error?.message);
  org = o.data.id as string;
  appelant.org = org;
  // 6 km autour du Capitole, seuil 10 % : le groupe 31000 (six codes, une géométrie) et des CP voisins sont retenus.
  const recette = { v: 1, type: 'rayon_point', lon: 1.4442, lat: 43.6045, rayon_m: 6000 };
  const { data: rayon, error: e1 } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: 6000 });
  if (e1) throw new Error(e1.message);
  const { data: zone, error: e2 } = await sb.rpc('creer_zone_recette', {
    p_nom: 'Toulouse 6 km', p_org_id: org, p_cree_par: null, p_recette: recette,
    p_geometry_geojson: JSON.stringify((rayon as { geometry: unknown }).geometry),
  });
  if (e2) throw new Error(e2.message);
  const zoneId = (zone as { id: string }).id;
  jeuStrict = await creerJeu(zoneId, 'Toulouse strict', 'exclusif');
  jeuNational = await creerJeu(zoneId, 'Toulouse national', 'pondere');
  extStrict = await extraire(jeuStrict);
  extNational = await extraire(jeuNational);
  campagne = await nouvelleCampagne('campagne jeu de zone');
  campagneHorsJeu = await nouvelleCampagne('campagne hors jeu');
}, LONG);

afterAll(async () => {
  if (!org) return;
  const camps = await sb.from('dsp_campaigns').delete().eq('organization_id', org);
  if (camps.error) throw new Error(`nettoyage des campagnes : ${camps.error.message}`);
  const jeux = await sb.from('zone_sets').delete().eq('org_id', org);
  if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
  const { error } = await sb.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
}, LONG);

describe('extraction : part prévue figée par code, ligne HORS_ZONE dans resume_plan', () => {
  it('strict : Σ des parts = 1, HORS_ZONE à 0 ; le groupe 31000 partagé à parts égales entre ses six codes', () => {
    const p = partsDe(extStrict);
    expect(TOULOUSE.every((c) => p.has(c))).toBe(true);
    const somme = [...p.values()].reduce<number>((t, v) => t + (v ?? 0), 0);
    expect(somme).toBeCloseTo(1, 9);
    const membres = TOULOUSE.map((c) => p.get(c) as number);
    for (const m of membres) expect(m).toBeCloseTo(membres[0], 15);
    // La part de l'unité = sa population en zone ÷ Σ des populations en zone des unités retenues (classe 1, strict).
    const attendue = Number(psql(`
      select sum(pop_en_zone) filter (where code_postal = '31000') / sum(pop_en_zone)
        from public.zone_set_extraction_cp where extraction_id = '${extStrict}' and retenu;`));
    // 5 décimales et non 9 : la part prévue prend part × volume, la part sur les populations ARRONDIES de la couverture
    // (`round(pop)`, sql/304) et le volume sur la population non arrondie (`cp_population_totale`) — écart ≈ 1e-6.
    expect(membres.reduce((t, m) => t + m, 0)).toBeCloseTo(attendue, 5);
  });

  it('lireHorsZone (LE lecteur partagé) : mode strict, part prévue 0, volume = référentiel − unités retenues', async () => {
    const hz = await lireHorsZone(sb as never, extStrict);
    expect(hz).toMatchObject({ code: 'HORS_ZONE', mode: 'strict', multiplicateur: 0, part: 1, classe: 0, part_prevue: 0 });
    const retenus = psql(`select string_agg(code_postal, ',') from public.zone_set_extraction_cp
      where extraction_id = '${extStrict}' and retenu and code_postal = code_canonique;`).split(',');
    const v = await lireVolumesAttendus(sb as never, retenus);
    const volumeRetenus = retenus.reduce((t, c) => t + (v.par_code.get(c) ?? 0), 0);
    expect(hz!.volume).toBeCloseTo(v.total - volumeRetenus, 6);
    expect(v.total).toBeGreaterThan(60_000_000);
  });

  it('national : HORS_ZONE entre dans Σ (Σ codes + HORS_ZONE = 1), sa part > 0', async () => {
    const hz = await lireHorsZone(sb as never, extNational);
    expect(hz).toMatchObject({ mode: 'national', part: 1 });
    expect(hz!.part_prevue).toBeGreaterThan(0);
    const somme = [...partsDe(extNational).values()].reduce<number>((t, v) => t + (v ?? 0), 0);
    expect(somme + (hz!.part_prevue as number)).toBeCloseTo(1, 9);
  });

  it('extraction inconnue : null, pas d’erreur', async () => {
    expect(await lireHorsZone(sb as never, '00000000-0000-4000-8000-0000000000a8')).toBeNull();
  });
});

describe('suivi : planned_share = part prévue (jeu de zone), m ÷ Σ m sinon', () => {
  it('rattacher recopie part_prevue ; refresh_campaign_rollups la donne telle quelle, le groupe ne pèse plus 6 fois', async () => {
    const r = await rattacher.POST(new NextRequest(`http://localhost/api/zones/jeux/${jeuStrict}/rattacher`,
      json({ campagne, extraction: extStrict })), params(jeuStrict));
    expect(r.status).toBe(201);
    const corps = await r.json() as { strategie: string; part_prevue: unknown };
    expect(corps.part_prevue).toEqual({ source: 'extraction', hors_zone: 0, mode_hors_zone: 'strict' });
    const ecart = Number(psql(`
      select count(*) from public.bidding_zone_configs z
        join public.zone_set_extraction_cp c on c.code_postal = z.postal_code and c.extraction_id = '${extStrict}'
       where z.strategy_id = '${corps.strategie}' and z.part_prevue is distinct from c.part_prevue;`));
    expect(ecart).toBe(0);

    await livrer(campagne, TOULOUSE);
    const { error } = await sb.rpc('refresh_campaign_rollups', { p_campaign_id: campagne });
    expect(error).toBeNull();
    const p = partsDe(extStrict);
    const rollup = new Map(psqlLignes(`select postal_code || ':' || planned_share from public.campaign_cp_rollup
      where campaign_id = '${campagne}';`).filter(Boolean).map((l) => l.split(':')).map(([c, v]) => [c, Number(v)]));
    for (const c of TOULOUSE) expect(rollup.get(c)).toBeCloseTo(p.get(c) as number, 12);
    // Le groupe pèse UNE unité : Σ de ses six codes au suivi = sa part d'unité. Avant A8 (m ÷ Σ m par code, six codes au
    // même multiplicateur), il pesait six fois son multiplicateur.
    const unite = Number(psql(`
      select sum(pop_en_zone) filter (where code_postal = '31000') / sum(pop_en_zone)
        from public.zone_set_extraction_cp where extraction_id = '${extStrict}' and retenu;`));
    expect(TOULOUSE.reduce((t, c) => t + (rollup.get(c) as number), 0)).toBeCloseTo(unite, 5);
    const m = (code: string) => Number(psql(`select bid_multiplier from public.bidding_zone_configs
      where strategy_id = '${corps.strategie}' and postal_code = '${code}';`));
    const sommeM = Number(psql(`select sum(bid_multiplier) from public.bidding_zone_configs where strategy_id = '${corps.strategie}';`));
    expect(TOULOUSE.reduce((t, c) => t + m(c), 0) / sommeM).toBeCloseTo((6 * m('31000')) / sommeM, 12);
  });

  it('plan sans part prévue (chemin ⑥ hors jeu de zone) : m ÷ Σ m, inchangé', async () => {
    const { data: s, error } = await sb.from('bidding_strategies').insert({
      name: '[ESSAI A8] hors jeu', campaign_id: campagneHorsJeu, algorithm_code: 'zone_set', objective_code: 'maximize_impressions',
      granularity: 'postal_code', weighting_mode: 'uniform', status: 'active',
    }).select('id').single();
    if (error || !s) throw new Error(error?.message);
    const ins = await sb.from('bidding_zone_configs').insert([
      { strategy_id: s.id, postal_code: '75001', bid_multiplier: 1, weight: 1 },
      { strategy_id: s.id, postal_code: '75002', bid_multiplier: 3, weight: 3 },
    ]);
    if (ins.error) throw new Error(ins.error.message);
    await livrer(campagneHorsJeu, ['75001', '75002']);
    const { error: e } = await sb.rpc('refresh_campaign_rollups', { p_campaign_id: campagneHorsJeu });
    expect(e).toBeNull();
    expect(psql(`select string_agg(postal_code || '=' || round(planned_share, 4), ',' order by postal_code)
      from public.campaign_cp_rollup where campaign_id = '${campagneHorsJeu}';`)).toBe('75001=0.2500,75002=0.7500');
  });
});

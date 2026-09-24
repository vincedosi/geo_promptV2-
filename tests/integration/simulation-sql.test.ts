/**
 * Les RPC de la simulation de campagne (sql/232), contre la base locale.
 *
 * Ce que ce fichier verrouille :
 * - `simulation_entrees` rend une ligne par code postal de l'extraction, avec
 *   la surface du référentiel et le drapeau `membre` ;
 * - `simulation_agregats` calcule les impressions UTILES au grain de la ligne
 *   (impressions × part en zone), et décide « en zone » sur le plan de la
 *   VERSION du jour — v1 avant le recalage, v2 après ;
 * - une simulation inconnue rend un refus nommé, jamais un tableau vide qu'on
 *   lirait comme « aucune diffusion ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

let jeuId: string | null = null;
let campagneId: string | null = null;
let simulationId: string | null = null;

const DEBUT = '2026-01-01';

/** Deux codes postaux : 13001 retenu à 25 % d'exposés, 13002 hors zone. */
const LIGNES_V1 = [
  {
    code_postal: '13001', code_canonique: '13001', classe: 'haut:1',
    cluster_id: null, cluster_rang: null, zone_nom: null,
    pop_en_zone: 1000, pop_totale: 4000, part_en_zone: 25, retenu: true, multiplicateur: 1.5,
  },
  {
    code_postal: '13002', code_canonique: '13002', classe: 'hors',
    cluster_id: null, cluster_rang: null, zone_nom: null,
    pop_en_zone: 0, pop_totale: 8000, part_en_zone: 0, retenu: false, multiplicateur: 0.5,
  },
];

/** La v2 fait l'inverse sur la rétention : 13002 y devient « en zone ». */
const LIGNES_V2 = [
  { ...LIGNES_V1[0], retenu: false, multiplicateur: 0.4 },
  { ...LIGNES_V1[1], retenu: true, multiplicateur: 1.6 },
];

const RESUME = { n_cp: 2, n_retenus: 1, taux_utile: 25, part_plan_en_zone: 100, population_exposee: 1000 };

async function extraire(lignes: unknown, origine: string): Promise<string> {
  const { data, error } = await sb.rpc('creer_zone_set_extraction', {
    p_zone_set_id: jeuId!, p_lignes: lignes as never, p_resume: RESUME as never,
    p_origine: origine, p_commentaire: '', p_created_by: undefined,
  });
  if (error) throw new Error(error.message);
  const r = data as unknown as { ok: boolean; id: string };
  if (!r.ok) throw new Error('extraction refusée');
  return r.id;
}

beforeAll(async () => {
  const { data: modele, error } = await sb
    .from('zone_sets')
    .select('org_id, created_by, profil, cible, gravites, natures, modes, territoire, mode_plan, seuil_couverture_cp, poids, profil_hash, custom_geo_zone_id')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!modele) throw new Error('Aucun jeu de zones en base : ce test a besoin d’un modèle.');

  const { data: jeu, error: e1 } = await sb.from('zone_sets').insert({
    ...modele,
    nom: `__test simulation ${Date.now()}`,
    description: 'jeu jetable créé par tests/integration/simulation-sql',
    brouillon: false,
    construit_le: new Date().toISOString(),
    population_exposee: 1000, n_cp_retenus: 1, taux_utile: 25,
    profil_hash: `__test_sim_${Date.now()}`,
  }).select('id').single();
  if (e1) throw new Error(e1.message);
  jeuId = jeu.id;

  const v1 = await extraire(LIGNES_V1, 'initiale');
  const v2 = await extraire(LIGNES_V2, 'recalage');

  const { data: camp, error: e2 } = await sb.from('dsp_campaigns').insert({
    name: '__test simulation', dsp_source: 'simulation', organization_id: modele.org_id,
    est_simulation: true, date_start: DEBUT, date_end: '2026-01-28',
  }).select('id').single();
  if (e2) throw new Error(e2.message);
  campagneId = camp.id;

  const { data: sim, error: e3 } = await sb.from('zone_set_simulations').insert({
    zone_set_id: jeuId, org_id: modele.org_id, campaign_id: camp.id,
    extraction_v1_id: v1, extraction_v2_id: v2, date_debut: DEBUT,
    jours: 28, jour_recalage: 15, params: {} as never, statut: 'v2',
  }).select('id').single();
  if (e3) throw new Error(e3.message);
  simulationId = sim.id;

  // Jour 1 (v1) et jour 15 (v2), deux partenaires sur 13001, un sur 13002.
  const { error: e4 } = await sb.from('dsp_campaign_data').insert([
    { campaign_id: camp.id, date: '2026-01-01', postal_code: '13001', country: 'FR', media: 'A', actor: 'A', impressions: 1000, spend: 4 },
    { campaign_id: camp.id, date: '2026-01-01', postal_code: '13001', country: 'FR', media: 'B', actor: 'B', impressions: 200, spend: 2 },
    { campaign_id: camp.id, date: '2026-01-01', postal_code: '13002', country: 'FR', media: 'A', actor: 'A', impressions: 100, spend: 0.5 },
    { campaign_id: camp.id, date: '2026-01-15', postal_code: '13001', country: 'FR', media: 'A', actor: 'A', impressions: 400, spend: 1.6 },
    { campaign_id: camp.id, date: '2026-01-15', postal_code: '13002', country: 'FR', media: 'A', actor: 'A', impressions: 600, spend: 3 },
  ]);
  if (e4) throw new Error(e4.message);
});

afterAll(async () => {
  // La campagne emporte impressions et simulation ; le jeu, ses extractions.
  if (campagneId) await sb.from('dsp_campaigns').delete().eq('id', campagneId);
  if (jeuId) await sb.from('zone_sets').delete().eq('id', jeuId);
});

interface Agregats {
  ok: boolean;
  error?: string;
  par_cp: { cp: string; v: number; imps: number; utiles: number }[];
  par_jour: { jour: number; imps: number; utiles: number; en_zone: number }[];
  par_partenaire: { partenaire: string; v: number; imps: number }[];
}

describe('simulation de campagne (sql/232)', () => {
  it('simulation_entrees rend une ligne par code postal, surface et drapeau membre compris', async () => {
    const { data: ext } = await sb.from('zone_set_simulations').select('extraction_v1_id').eq('id', simulationId!).single();
    const { data, error } = await sb.rpc('simulation_entrees', { p_extraction: ext!.extraction_v1_id });
    expect(error).toBeNull();
    const lignes = data as unknown as { code_postal: string; membre: boolean; surface_km2: number | null }[];
    expect(lignes.map((l) => l.code_postal)).toEqual(['13001', '13002']);
    expect(lignes.every((l) => l.membre === false)).toBe(true);
    expect(lignes.every((l) => l.surface_km2 != null)).toBe(true);
  });

  it('les impressions utiles valent impressions × part en zone', async () => {
    const { data, error } = await sb.rpc('simulation_agregats', { p_simulation: simulationId! });
    expect(error).toBeNull();
    const a = data as unknown as Agregats;
    expect(a.ok).toBe(true);
    const v1 = a.par_cp.find((r) => r.cp === '13001' && r.v === 1)!;
    expect(Number(v1.imps)).toBe(1200);
    expect(Number(v1.utiles)).toBe(300); // 1 200 × 25 %
    const hors = a.par_cp.find((r) => r.cp === '13002' && r.v === 1)!;
    expect(Number(hors.utiles)).toBe(0);
  });

  it('« en zone » se lit sur le plan de la version du jour', async () => {
    const { data } = await sb.rpc('simulation_agregats', { p_simulation: simulationId! });
    const a = data as unknown as Agregats;
    const j1 = a.par_jour.find((j) => j.jour === 1)!;
    const j15 = a.par_jour.find((j) => j.jour === 15)!;
    // Jour 1, plan v1 : seul 13001 est retenu.
    expect(Number(j1.imps)).toBe(1300);
    expect(Number(j1.en_zone)).toBe(1200);
    // Jour 15, plan v2 : seul 13002 est retenu.
    expect(Number(j15.imps)).toBe(1000);
    expect(Number(j15.en_zone)).toBe(600);
  });

  it('ventile par partenaire et par version', async () => {
    const { data } = await sb.rpc('simulation_agregats', { p_simulation: simulationId! });
    const a = data as unknown as Agregats;
    const aV1 = a.par_partenaire.find((p) => p.partenaire === 'A' && p.v === 1)!;
    expect(Number(aV1.imps)).toBe(1100);
  });

  it('refuse une simulation inconnue en la nommant', async () => {
    const { data, error } = await sb.rpc('simulation_agregats', {
      p_simulation: '00000000-0000-4000-8000-000000000000',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, error: 'simulation_introuvable' });
  });
});

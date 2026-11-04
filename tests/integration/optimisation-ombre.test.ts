/**
 * PREUVE DE BOUT EN BOUT du mode ombre (tâche 1.6) : Next calcule en TS, appelle le VRAI service Python
 * (`services/optimisation`, conteneur `optimisation_api`, `docker compose up`), compare, journalise — sur la base locale.
 *
 * - Extraction d'un jeu de ZONE par la route (`POST /api/zones/jeux/[id]/extractions`, `OPTIMISATION_PLAN_SOURCE=ombre`) :
 *   Lyon 5 km, DV360 au CP à 20 % et TTD au CP à 10 % (deux plans propres, plan commun au seuil le plus bas), puis une
 *   zone « France métropolitaine » DV360 au CP (≈ 6 000 unités). Attendu : une ligne `optimisation_ombre` à 0 écart, et
 *   `resume_plan.algo = {moteur: 'ts', ombre: {…, ecarts: 0}}` RELU en base (sql/344).
 * - Plan d'un jeu RISQUE existant (lecture seule) et recalage : 0 écart.
 *
 * Service absent (conteneur arrêté, clé introuvable) : chaque cas est SAUTÉ en le disant — la suite d'intégration ne
 * dépend pas d'un conteneur optionnel. Un espace `[ESSAI optim 1.6]` est créé puis supprimé ; zones, jeux et extractions
 * partent avec lui. Seuls l'appelant et les quotas sont simulés.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

const sb = creerClientTest();
const LONG = 180_000;
const appelant = vi.hoisted(() => ({ org: '' }));
const AUTEUR = '00000000-0000-4000-8000-0000000016a1';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: AUTEUR, role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');
const { planRisqueSousDrapeau, recalageSousDrapeau } = await import('@/lib/optimisation/plans');
const { lireGroupesCp } = await import('@/lib/zones/groupes');
const { lireTout } = await import('@/lib/supabase/lire-tout');
const { genererPlanCp } = await import('@/lib/zones/plan');
const { cibleParZone } = await import('@/lib/simulation/alignement');

/** La clé : l'environnement, sinon `services/optimisation/.env` (non suivi). Jamais affichée. */
function cleInterne(): string | undefined {
  if (process.env.OPTIMISATION_CLE_INTERNE?.trim()) return process.env.OPTIMISATION_CLE_INTERNE.trim();
  const f = join(process.cwd(), 'services', 'optimisation', '.env');
  if (!existsSync(f)) return undefined;
  return /^OPTIMISATION_CLE_INTERNE=(.*)$/m.exec(readFileSync(f, 'utf-8'))?.[1]?.trim() || undefined;
}

const URL_SERVICE = process.env.OPTIMISATION_URL?.trim() || 'http://127.0.0.1:8090';
let disponible = false;
let raison = '';
let org = '';

type Ligne = { evenement: string; appelant: string; ecarts: number | null; premier_ecart: unknown; erreur?: unknown };
let journal: Ligne[] = [];

async function nouvelleOrg(): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI optim 1.6] ombre', slug: `essai-optim-16-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

async function creerZone(nom: string, recette: Record<string, unknown>, geometrie: unknown): Promise<string> {
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: org, p_cree_par: null, p_recette: recette, p_geometry_geojson: JSON.stringify(geometrie),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function jeuSur(zone: string, nom: string, choix: { plateforme: string; seuil: number }[]): Promise<string> {
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: org, nom, type: 'zone', custom_geo_zone_id: zone, cible: 'ind', mode_plan: 'pondere', brouillon: false, version: 1,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  const l = await sb.from('zone_set_plateformes')
    .insert(choix.map((c) => ({ zone_set_id: data.id, maille: 'cp', rayon_m: null, ...c })));
  if (l.error) throw new Error(l.error.message);
  return data.id as string;
}

/** Saute le cas EN LE DISANT (`ctx.skip()` de Vitest 2 ne prend pas de raison). */
function sauter(ctx: { skip: () => void }, pourquoi: string): void {
  console.warn(`[ombre 1.6] cas sauté : ${pourquoi}`);
  ctx.skip();
}

const extraire = (id: string) => extractions.POST(
  new NextRequest(`http://localhost/api/zones/jeux/${id}/extractions`, {
    method: 'POST', body: JSON.stringify({ commentaire: 'ombre 1.6' }), headers: { 'content-type': 'application/json' },
  }), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const cle = cleInterne();
  if (!cle) {
    raison = 'clé interne introuvable (OPTIMISATION_CLE_INTERNE ou services/optimisation/.env)';
    return;
  }
  try {
    const r = await fetch(`${URL_SERVICE}/sante`, { headers: { 'X-Optimisation-Cle': cle }, signal: AbortSignal.timeout(3000) });
    disponible = r.ok;
    raison = r.ok ? '' : `GET /sante → ${r.status}`;
  } catch {
    raison = `service injoignable sur ${URL_SERVICE} (docker compose -f services/optimisation/compose.yaml up -d)`;
  }
  if (!disponible) return;
  vi.stubEnv('OPTIMISATION_URL', URL_SERVICE);
  vi.stubEnv('OPTIMISATION_CLE_INTERNE', cle);
  vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'ombre');
  vi.stubEnv('OPTIMISATION_CORRECTION_SOURCE', 'ombre');
  vi.spyOn(console, 'info').mockImplementation((texte: unknown) => {
    try {
      const l = JSON.parse(String(texte)) as Ligne;
      if (l.evenement === 'optimisation_ombre') journal.push(l);
    } catch { /* une autre ligne */ }
  });
  org = await nouvelleOrg();
  appelant.org = org;
}, LONG);

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (!org) return;
  const jeux = await sb.from('zone_sets').delete().eq('org_id', org);
  if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
  const { error } = await sb.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('mode ombre contre le service Python réel', () => {
  async function prouverExtraction(jeu: string) {
    journal = [];
    const r = await extraire(jeu);
    const corps = await r.json() as { id: string; error?: string };
    expect(r.status, corps.error).toBe(201);
    expect(journal, JSON.stringify(journal)).toHaveLength(1);
    expect(journal[0]).toMatchObject({ appelant: 'extraction_zone', ecarts: 0, premier_ecart: null });
    const { data, error } = await sb.from('zone_set_extractions').select('resume_plan').eq('id', corps.id).single();
    if (error) throw new Error(error.message);
    const algo = (data.resume_plan as { algo?: { moteur: string; ombre: Record<string, unknown> } }).algo;
    expect(algo?.moteur).toBe('ts');
    expect(algo?.ombre).toMatchObject({ moteur: 'python', ecarts: 0 });
    expect(String(algo?.ombre.entrees_sha256)).toMatch(/^[0-9a-f]{64}$/);
    return { ...journal[0], algo };
  }

  it('extraction Lyon 5 km, DV360 (20 %) + TTD (10 %) au CP : 0 écart, algo figé en base', async (ctx) => {
    if (!disponible) sauter(ctx, raison);
    const recette = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000 };
    const { data: rayon, error } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: 5000 });
    if (error) throw new Error(error.message);
    const zone = await creerZone('Lyon 5 km', recette, (rayon as { geometry: unknown }).geometry);
    const jeu = await jeuSur(zone, 'Lyon ombre', [{ plateforme: 'dv360', seuil: 20 }, { plateforme: 'ttd', seuil: 10 }]);
    const preuve = await prouverExtraction(jeu);
    console.log(`[ombre 1.6] Lyon : ${JSON.stringify({ ecarts: preuve.ecarts, algo: preuve.algo })}`);
  }, LONG);

  it('extraction France métropolitaine, DV360 au CP (≈ 6 000 unités) : 0 écart', async (ctx) => {
    if (!disponible) sauter(ctx, raison);
    const { data: forme, error } = await sb.rpc('zone_pays_geometrie', { p_code: 'METRO' });
    if (error) throw new Error(error.message);
    const zone = await creerZone('France METRO', { v: 1, type: 'pays', code: 'METRO' }, (forme as { geometry: unknown }).geometry);
    const jeu = await jeuSur(zone, 'Métropole ombre', [{ plateforme: 'dv360', seuil: 20 }]);
    const preuve = await prouverExtraction(jeu);
    console.log(`[ombre 1.6] METRO : ${JSON.stringify({ ecarts: preuve.ecarts, duree_python_ms: (preuve as { duree_python_ms?: number }).duree_python_ms })}`);
  }, LONG);

  it('plan d’un jeu RISQUE existant (lecture seule) puis recalage sur ses codes : 0 écart chacun', async (ctx) => {
    if (!disponible) sauter(ctx, raison);
    const { data: jeu } = await sb.from('zone_sets').select('id, mode_plan, poids')
      .eq('type', 'risque').not('construit_le', 'is', null).limit(1).maybeSingle();
    if (!jeu) sauter(ctx, 'aucun jeu risque construit en base locale');
    const { lignes } = await lireTout<{ code_postal: string; classe: string; pop_en_zone: number; pop_totale: number; retenu: boolean; cluster_id: string; part_en_zone: number | null }>(
      (de, a) => sb.from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, retenu, cluster_id, part_en_zone')
        .eq('zone_set_id', jeu!.id).order('code_postal').order('cluster_id').range(de, a),
      8000,
    );
    const cps = lignes.map((r) => ({
      code_postal: r.code_postal, classe: r.classe, pop_en_zone: Number(r.pop_en_zone ?? 0),
      pop_totale: Number(r.pop_totale ?? 0), retenu: r.retenu,
    }));
    const mode = { mode_plan: jeu!.mode_plan as 'pondere' | 'exclusif', poids: (jeu!.poids ?? {}) as Record<string, number> };
    const groupes = await lireGroupesCp(sb as never);
    journal = [];
    await planRisqueSousDrapeau('integration_risque', cps, mode, groupes);
    expect(journal[0], JSON.stringify(journal)).toMatchObject({ appelant: 'integration_risque', ecarts: 0 });

    // Recalage : les codes du jeu, multiplicateur du plan, impressions observées déterministes par bassin.
    const plan = genererPlanCp(cps, mode, groupes);
    const mult = new Map(plan.lignes.map((l) => [l.code_postal, l.multiplicateur]));
    const vus = new Set<string>();
    const sim = lignes.filter((r) => (vus.has(r.code_postal) ? false : (vus.add(r.code_postal), true))).map((r) => ({
      code_postal: r.code_postal, code_canonique: r.code_postal, cluster_id: r.cluster_id, retenu: r.retenu,
      multiplicateur: mult.get(r.code_postal) ?? 0, pop_en_zone: Number(r.pop_en_zone ?? 0),
      pop_totale: Number(r.pop_totale ?? 0), part_en_zone: Number(r.part_en_zone ?? 0), surface_km2: null, membre: false,
    }));
    const observees = new Map<string, number>();
    for (const [i, z] of [...new Set(sim.map((c) => c.cluster_id))].entries()) observees.set(z, 1000 + ((i * 7919) % 5000));
    journal = [];
    await recalageSousDrapeau(sim, observees, cibleParZone(sim),
      { amortissement: 0.8, seuilDilution: 20, baisseDilues: 0.6 } as never);
    expect(journal[0], JSON.stringify(journal)).toMatchObject({ appelant: 'simulation_recaler', ecarts: 0 });
    console.log(`[ombre 1.6] risque ${cps.length} lignes, recalage ${sim.length} CP : 0 écart`);
  }, LONG);
});

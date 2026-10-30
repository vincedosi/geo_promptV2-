/**
 * La zone « France entière » côté serveur (④ finitions, T2, arbitrages A-3, A-4, A-5) : l'exécuteur de recette, les
 * compteurs de « Mes zones » sans lecture géométrique, les refus de la couverture et le refus de ⑤.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createAdminClient, etat, reinitialiser, ORG } from '../api/_doublures-route';
import { executerRecette } from '@/lib/zones/executer-recette';
import { MESSAGES_REFUS_COUVERTURE, MESSAGE_ZONE_PAYS_PLATEFORMES, estRecettePays, refusZonePays, repondreCouverture } from '@/lib/zones/couverture';
import { repondreResolue } from '@/lib/zones/session-zones';
import { extraireJeuZone } from '@/lib/zones/extraction-jeu-zone';
import type { Tables } from '@/types/database.types';

vi.mock('@/lib/api/rate-limit', () => import('../api/_doublures-route'));
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: async () => [] }));
vi.mock('@/lib/auth/perimetre-donnees', () => ({ indicateursVisiblesDeLaSession: async () => ({ visibles: new Set(), propres: new Set() }) }));

const CARRE ={ type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';

beforeEach(() => {
  reinitialiser();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('exécuteur : la recette pays', () => {
  it('une seule RPC, zone_pays_geometrie, avec le code du pays ; aucune géométrie cliente lue', async () => {
    etat.reponses.zone_pays_geometrie = { data: { geometry: CARRE, surface_km2: 547_779.4 }, error: null };
    const r = await executerRecette(createAdminClient() as never, { v: 1, type: 'pays', code: 'METRO' },
      { orgId: ORG, sources: [], geometrie: { type: 'Polygon', coordinates: [] } });
    expect(r).toEqual({ ok: true, geometry: CARRE, surface_km2: 547_779.4, compte: null, part_retenue: null, population: null });
    expect(etat.rpcs).toEqual([{ nom: 'zone_pays_geometrie', args: { p_code: 'METRO' } }]);
  });
});

describe('compteurs de « Mes zones » : une zone pays n’est pas résolue par la géométrie', () => {
  it('pays → compter_zone_pays, jamais resolve_custom_geo_zone_codes (qui lirait tous les IRIS)', async () => {
    etat.reponses.compter_zone_pays = { data: { zone_id: ZONE, count_cp: 6051, count_iris: 48_000 }, error: null };
    const res = await repondreResolue(createAdminClient() as never, ZONE, 'u1', 547_779.4, 'creation', true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zone_id: ZONE, count_cp: 6051, count_iris: 48_000, surface_km2: 547_779.4 });
    expect(etat.rpcs.map((r) => r.nom)).toEqual(['compter_zone_pays']);
    expect(etat.rpcs[0].args).toEqual({ p_zone_id: ZONE, p_caller_user_id: 'u1' });
  });

  it('autre recette → resolve_custom_geo_zone_codes, comme avant', async () => {
    etat.reponses.resolve_custom_geo_zone_codes = { data: { count_cp: 3, count_iris: 9 }, error: null };
    await repondreResolue(createAdminClient() as never, ZONE, 'u1', 12, 'creation');
    expect(etat.rpcs.map((r) => r.nom)).toEqual(['resolve_custom_geo_zone_codes']);
  });

  it('un échec des compteurs pays rend 207 : la zone existe', async () => {
    etat.reponses.compter_zone_pays = { data: null, error: { message: 'panne' } };
    const res = await repondreResolue(createAdminClient() as never, ZONE, 'u1', 1, 'creation', true);
    expect(res.status).toBe(207);
  });
});

describe('couverture : le refus d’un découpage trop fin pour un pays', () => {
  it('message dit, 422, avec le découpage', async () => {
    expect(MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays).toBe(
      'Sur toute la France, le découpage par IRIS (48 872) ou par commune (34 918) est trop fin : choisissez le découpage par code postal.');
    const res = repondreCouverture({ data: { refus: 'decoupage_trop_fin_pays', decoupage: 'iris' }, error: null },
      MESSAGES_REFUS_COUVERTURE, 't', 'échec');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ refus: 'decoupage_trop_fin_pays', decoupage: 'iris' });
  });
});

describe('⑤ : une zone pays s’achète au pays (⑤ finitions, T2, A-7)', () => {
  it('l’extraction d’un jeu sur une zone pays ne répond plus 422 « zone_pays »', async () => {
    const jeu = { id: 'j', org_id: ORG, custom_geo_zone_id: ZONE, cible: 'ind', mode_plan: 'pondere', type: 'zone' } as Tables<'zone_sets'>;
    etat.tables.zone_set_plateformes = { data: [{ plateforme: 'meta', maille: 'cp', seuil: 30, rayon_m: null }], error: null };
    etat.tables.custom_geo_zones = { data: { recette: { v: 1, type: 'pays', code: 'FR' } }, error: null };
    etat.tables.plateformes_geo = { data: [], error: null };
    const res = await extraireJeuZone(createAdminClient() as never, jeu, { origine: 'initiale', commentaire: '' }, 'u1');
    expect(res).toBeInstanceOf(NextResponse);
    expect(JSON.stringify(await res.json())).not.toContain(MESSAGE_ZONE_PAYS_PLATEFORMES);
  });
  it('la phrase de « Mes zones » (export, détail) renvoie à l’étape ⑤', () => {
    expect(MESSAGE_ZONE_PAYS_PLATEFORMES).toBe('Zone nationale : achetez-la à l’étape ⑤ (ciblage par pays des plateformes).');
  });
});

describe('estRecettePays / refusZonePays : la règle unique des routes (revue finale)', () => {
  it('reconnaît la recette pays, et elle seule, sans lever sur une recette nulle ou illisible', async () => {
    expect(estRecettePays({ v: 1, type: 'pays', code: 'FR' })).toBe(true);
    for (const r of [null, undefined, 'pays', 42, {}, { v: 1, type: 'dessin' }]) expect(estRecettePays(r)).toBe(false);
    expect(refusZonePays({ v: 1, type: 'dessin' })).toBeNull();
    const refus = refusZonePays({ v: 1, type: 'pays', code: 'METRO' });
    expect(refus?.status).toBe(422);
    expect(await refus?.json()).toEqual({ error: MESSAGE_ZONE_PAYS_PLATEFORMES, refus: 'zone_pays' });
  });
});

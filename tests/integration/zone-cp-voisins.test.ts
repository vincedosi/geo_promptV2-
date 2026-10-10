/**
 * `create_custom_geo_zone` (sql/247) — une zone par codes postaux s'enregistre
 * même quand sa géométrie revient invalide du client.
 *
 * Le défaut, mesuré le 2026-10-11 : `get_admin_filter_geometry` sérialise en
 * GeoJSON à 9 décimales ; sur 470 des 6 187 codes postaux, un trou dégénéré
 * (deux sommets qui ne diffèrent qu'à la 15e décimale) s'effondre, la
 * géométrie renvoyée à `/api/custom-geo/save` est invalide, `ST_MakeValid` en
 * fait une GEOMETRYCOLLECTION (polygones + lignes) et la colonne
 * `geometry(MultiPolygon)` la refuse. 13001 + 13002, 75001 + 75002 et même
 * 13002 seul ne s'enregistraient pas.
 *
 * On rejoue ici la chaîne EXACTE des routes : `get_admin_filter_geometry`
 * (`/source/codes-postaux`) → `JSON.stringify` (le client) →
 * `create_custom_geo_zone` + `resolve_custom_geo_zone_codes` (`/save`).
 *
 * ⚠ Écrit dans la base locale : zones nommées `[ESSAI serveur4]`, supprimées
 * à la fin (suppression gardée, `count: 'exact'`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();
const PREFIXE = '[ESSAI serveur4]';

let orgId = '';
let userId = '';

interface Resolution { count_iris: number; count_cp: number }

async function geometrieCp(codes: string[]): Promise<{ type: string }> {
  const { data, error } = await sb.rpc('get_admin_filter_geometry', { p_scale: 'cp', p_codes: codes });
  expect(error).toBeNull();
  const g = (data as { geometry: { type: string } | null }).geometry;
  expect(g).not.toBeNull();
  return g as { type: string };
}

async function enregistrer(nom: string, codes: string[]): Promise<{ id: string; resolution: Resolution }> {
  const geometrie = await geometrieCp(codes);
  const { data: id, error } = await sb.rpc('create_custom_geo_zone', {
    p_name: `${PREFIXE} ${nom}`,
    p_description: null,
    p_org_id: orgId,
    p_source_type: 'codes_postaux',
    p_source_metadata: {},
    p_geometry_geojson: JSON.stringify(geometrie),
  });
  expect(error?.message ?? null).toBeNull();
  expect(typeof id).toBe('string');
  const res = await sb.rpc('resolve_custom_geo_zone_codes', { p_zone_id: id, p_caller_user_id: userId });
  expect(res.error).toBeNull();
  return { id: id as string, resolution: res.data as Resolution };
}

async function codesDeZone(id: string): Promise<string[]> {
  const { data, error } = await sb
    .from('custom_geo_zone_codes').select('code').eq('zone_id', id).eq('code_type', 'cp');
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.code as string);
}

async function nettoyer(): Promise<void> {
  const { error } = await sb.from('custom_geo_zones').delete({ count: 'exact' }).like('name', `${PREFIXE}%`);
  if (error) throw new Error(`Nettoyage des zones d'essai impossible : ${error.message}`);
}

beforeAll(async () => {
  const { data, error } = await sb
    .from('profiles').select('id, organization_id').eq('role', 'super_admin').not('organization_id', 'is', null).limit(1);
  expect(error).toBeNull();
  expect(data?.length).toBe(1);
  userId = data![0].id as string;
  orgId = data![0].organization_id as string;
  await nettoyer();
});

afterAll(async () => {
  await nettoyer();
  const { count, error } = await sb
    .from('custom_geo_zones').select('id', { count: 'exact', head: true }).like('name', `${PREFIXE}%`);
  expect(error).toBeNull();
  expect(count).toBe(0);
});

describe('create_custom_geo_zone — codes postaux voisins (sql/247)', () => {
  it.each([
    ['13001 + 13002', ['13001', '13002']],
    ['75001 + 75002', ['75001', '75002']],
    ['13002 seul', ['13002']],
    ['69001 + 69002', ['69001', '69002']],
  ])('%s : la zone s enregistre et porte ses codes', async (nom, codes) => {
    const { id, resolution } = await enregistrer(nom, codes);
    expect(resolution.count_cp).toBeGreaterThanOrEqual(codes.length);
    expect(resolution.count_iris).toBeGreaterThan(0);
    const cp = await codesDeZone(id);
    for (const c of codes) expect(cp).toContain(c);
  });

  it('une liste non contiguë (Marseille, Paris, Lyon) s enregistre', async () => {
    const { id, resolution } = await enregistrer('non contigue', ['13001', '75001', '69001']);
    expect(resolution.count_cp).toBeGreaterThanOrEqual(3);
    const cp = await codesDeZone(id);
    for (const c of ['13001', '75001', '69001']) expect(cp).toContain(c);
  });

  it('50 codes postaux voisins de Paris s enregistrent', async () => {
    // Les 50 codes de Paris et de la petite couronne : 75001-75020 + 92, 93, 94.
    const { data, error } = await sb
      .from('ref_codes_postaux').select('code_postal')
      .or('code_postal.like.75%,code_postal.like.92%,code_postal.like.93%,code_postal.like.94%')
      .order('code_postal').limit(50);
    expect(error).toBeNull();
    const codes = (data ?? []).map((r) => r.code_postal as string);
    expect(codes).toHaveLength(50);
    const { resolution } = await enregistrer('50 CP Paris', codes);
    expect(resolution.count_cp).toBeGreaterThanOrEqual(50);
  });

  it('non-régression : 13004 + 13005 + 13012, qui passait déjà, garde ses comptes (96 IRIS, 11 CP)', async () => {
    const { resolution } = await enregistrer('deja valide', ['13004', '13005', '13012']);
    expect(resolution).toMatchObject({ count_iris: 96, count_cp: 11 });
  });

  // Deux cas : parent invalide, puis parent VALIDE (13001) pour que seule la
  // sous-zone passe par la réparation — sinon le parent échouerait d'abord et
  // la branche des sous-zones ne serait jamais prouvée.
  it.each([
    ['parent et sous-zone invalides', ['13001', '13002']],
    ['sous-zone seule invalide', ['13001']],
  ])('la variante à sous-zones extrait aussi les polygones (%s)', async (nom, parent) => {
    const geometrie = JSON.stringify(await geometrieCp(parent));
    const { data: id, error } = await sb.rpc('create_custom_geo_zone_with_subzones', {
      p_name: `${PREFIXE} sous-zones ${nom}`,
      p_description: null,
      p_org_id: orgId,
      p_source_type: 'capture',
      p_source_metadata: {},
      p_geometry_geojson: geometrie,
      p_subzones: [{ name: '13002', source_ref: '13002', geometry_geojson: JSON.stringify(await geometrieCp(['13002'])) }],
    });
    expect(error?.message ?? null).toBeNull();
    const sz = await sb.from('custom_geo_zone_subzones').select('name').eq('zone_id', id as string);
    expect(sz.error).toBeNull();
    expect(sz.data).toEqual([{ name: '13002' }]);
  });
});

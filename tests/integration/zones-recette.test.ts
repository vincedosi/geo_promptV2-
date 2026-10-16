/**
 * Zones à recette (spec carte-en-parcours § 16) : une zone garde la recette qui l'a produite ; la remplacer est refusé
 * dès qu'un plan la cite. Le périmètre de ① est résolu EN BASE (jamais une géométrie fournie par le client).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
let org = '';
let autreOrg = '';
const CARRE = JSON.stringify({ type: 'Polygon', coordinates: [[[5.36, 43.29], [5.40, 43.29], [5.40, 43.32], [5.36, 43.32], [5.36, 43.29]]] });
const RECETTE = { v: 1, type: 'dessin' };

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations').insert({ name: `[ESSAI lot3] ${nom}`, slug: `essai-lot3-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}
async function creer(recette: unknown = RECETTE, o = org) {
  return admin.rpc('creer_zone_recette', { p_nom: 'Essai', p_org_id: o, p_cree_par: null, p_recette: recette, p_geometry_geojson: CARRE });
}

beforeAll(async () => { org = await nouvelleOrg('a'); autreOrg = await nouvelleOrg('b'); });
afterAll(async () => {
  for (const o of [org, autreOrg]) {
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('creer_zone_recette', () => {
  it('écrit la zone, sa recette et un source_type lisible', async () => {
    const { data, error } = await creer();
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    const { data: z } = await admin.from('custom_geo_zones').select('recette, source_type, org_id').eq('id', id).single();
    expect(z).toEqual({ recette: RECETTE, source_type: 'recette_dessin', org_id: org });
  });
  it('une recette d’une autre version, ou d’un type inconnu, est refusée et rien n’est écrit', async () => {
    const avant = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    for (const r of [{ v: 2, type: 'dessin' }, { v: 1, type: 'pluie' }]) {
      const { error } = await creer(r);
      expect(error?.code).toBe('23514');
    }
    const apres = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    expect(apres.count).toBe(avant.count);
  });
  it('une recette qui cite une zone d’un AUTRE espace est refusée, et rien n’est écrit', async () => {
    const etrangere = ((await creer(RECETTE, autreOrg)).data as { id: string }).id;
    const mienne = ((await creer()).data as { id: string }).id;
    const avant = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    expect((await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [mienne, etrangere] })).data)
      .toEqual({ refus: 'zone_introuvable' });
    expect((await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [mienne, '3f2504e0-4f89-11d3-9a0c-0305e82c3301'] })).data)
      .toEqual({ refus: 'zone_introuvable' });
    expect((await creer({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 1000, perimetre: { type: 'zone', code: etrangere } })).data)
      .toEqual({ refus: 'perimetre_inconnu' });
    const apres = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    expect(apres.count).toBe(avant.count);
  });
  it('les UUID cités sont rangés en minuscules (sinon zone_referencee ne les verrait pas)', async () => {
    const a = ((await creer()).data as { id: string }).id;
    const b = ((await creer()).data as { id: string }).id;
    const c = ((await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [a.toUpperCase(), b.toUpperCase()] })).data as { id: string }).id;
    const p = ((await creer({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'zone', code: b.toUpperCase() } })).data as { id: string }).id;
    const { data: lignes } = await admin.from('custom_geo_zones').select('id, recette').in('id', [c, p]);
    const parId = new Map((lignes ?? []).map((l) => [l.id, l.recette as Record<string, unknown>]));
    expect(parId.get(c)?.zones).toEqual([a, b]);
    expect((parId.get(p)?.perimetre as { code: string }).code).toBe(b);
    expect((await admin.rpc('zone_referencee', { p_zone_id: a })).data).toBe('combinaison');
  });
});

describe('resoudre_perimetre', () => {
  const TOUS = ['region', 'departement', 'commune', 'cp', 'zone'];
  const resoudre = (p_type: string, p_code: string, p_types_admis = TOUS, p_max_km2 = 100000) =>
    admin.rpc('resoudre_perimetre', { p_type, p_code, p_org_id: org, p_max_km2, p_types_admis });
  const lu = async (...a: Parameters<typeof resoudre>) => {
    const { data, error } = await resoudre(...a);
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data[0] : data) as { g: unknown; refus: string | null };
  };

  it.each([
    ['departement', '13'], ['region', '84'], ['cp', '13001'],
    ['commune', '13056'],           // code INSEE (Martigues)
    ['commune', '2a004'],           // code INSEE corse tel que ① le transmet (minuscules) → Ajaccio
    ['commune', '93066'],           // le code que le message « commune ambiguë » propose (Saint-Denis 93)
    ['commune', 'martigues'],       // le texte tapé dans ① (panneau-filtre-logique.ts:59 : minuscules)
    ['commune', 'saint-etienne'],   // sans accent → Saint-Étienne (42218)
    ['commune', 'marseille'],       // 16 arrondissements unis
    ['commune', 'paris'],           // 20 arrondissements unis
    ['commune', 'lyon'],            // 9 arrondissements unis
  ])('%s %s : une géométrie, aucun refus', async (t, c) => {
    const r = await lu(t, c);
    expect(r.refus).toBeNull();
    expect(r.g).not.toBeNull();
  });

  it.each([
    ['france', 'FR', TOUS, 'perimetre_national_refuse'],
    ['region', '84', ['departement', 'commune', 'cp', 'zone'], 'perimetre_non_admis'],
    ['commune', 'saint-sauveur', TOUS, 'commune_ambigue'],   // 11 communes de ce nom
    ['commune', 'nullepart-sur-rien', TOUS, 'perimetre_inconnu'],
    ['departement', '00', TOUS, 'perimetre_inconnu'],
    ['zone', 'pas-un-uuid', TOUS, 'perimetre_inconnu'],
  ] as const)('%s %s : refus %s', async (t, c, admis, refus) => {
    expect(await lu(t, c, [...admis])).toEqual({ g: null, refus });
  });

  it('une zone d’un autre espace : inconnue ; une zone de l’espace : résolue ; trop grande : refusée', async () => {
    const autre = ((await creer(RECETTE, autreOrg)).data as { id: string }).id;
    expect((await lu('zone', autre)).refus).toBe('perimetre_inconnu');
    const mienne = ((await creer()).data as { id: string }).id;
    expect((await lu('zone', mienne)).refus).toBeNull();
    expect((await lu('zone', mienne.toUpperCase())).refus).toBeNull();
    expect((await lu('zone', mienne, TOUS, 1)).refus).toBe('perimetre_trop_grand');
  });
});

describe('zone_referencee', () => {
  it('libre : null ; prise pour périmètre par une recette : perimetre', async () => {
    const z = ((await creer()).data as { id: string }).id;
    expect((await admin.rpc('zone_referencee', { p_zone_id: z })).data).toBeNull();
    await creer({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 1000, perimetre: { type: 'zone', code: z } });
    expect((await admin.rpc('zone_referencee', { p_zone_id: z })).data).toBe('perimetre');
  });
});

describe('remplacer_geometrie_zone', () => {
  it('remplace la forme d’une zone libre et efface ses statistiques', async () => {
    const id = ((await creer()).data as { id: string }).id;
    await admin.from('custom_geo_zones').update({ audience_stats: { pop: 1 } }).eq('id', id);
    const AUTRE = JSON.stringify({ type: 'Polygon', coordinates: [[[5.30, 43.25], [5.45, 43.25], [5.45, 43.35], [5.30, 43.35], [5.30, 43.25]]] });
    const { data, error } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: AUTRE });
    expect(error).toBeNull();
    expect(data).toEqual({ remplace: true });
    const { data: z } = await admin.from('custom_geo_zones').select('audience_stats, resolved_at').eq('id', id).single();
    expect(z).toEqual({ audience_stats: {}, resolved_at: null });
  });
  it('efface les codes, les sous-zones et les compteurs de l’ancienne forme (les routes les re-résolvent ensuite)', async () => {
    const id = ((await creer()).data as { id: string }).id;
    const { data: sz, error: e1 } = await admin.from('custom_geo_zone_subzones')
      .insert({ zone_id: id, name: 'Sous-zone', geometry: 'SRID=4326;MULTIPOLYGON(((5.36 43.29,5.40 43.29,5.40 43.32,5.36 43.32,5.36 43.29)))' })
      .select('id').single();
    expect(e1).toBeNull();
    const { error: e2 } = await admin.from('custom_geo_zone_codes').insert({ zone_id: id, code_type: 'cp', code: '13001', subzone_id: sz?.id });
    expect(e2).toBeNull();
    await admin.from('custom_geo_zones').update({ feature_count_cp: 3, feature_count_iris: 12 }).eq('id', id);
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ remplace: true });
    const codes = await admin.from('custom_geo_zone_codes').select('code', { count: 'exact', head: true }).eq('zone_id', id);
    const sous = await admin.from('custom_geo_zone_subzones').select('id', { count: 'exact', head: true }).eq('zone_id', id);
    expect([codes.count, sous.count]).toEqual([0, 0]);
    const { data: z } = await admin.from('custom_geo_zones').select('feature_count_cp, feature_count_iris').eq('id', id).single();
    expect(z).toEqual({ feature_count_cp: 0, feature_count_iris: 0 });
  });
  it('une zone prise pour périmètre par une autre recette : refus « perimetre »', async () => {
    const z = ((await creer()).data as { id: string }).id;
    await creer({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'zone', code: z } });
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: z, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_referencee', par: 'perimetre' });
  });
  it('une zone d’un autre espace : introuvable, rien ne change', async () => {
    const id = ((await creer(RECETTE, autreOrg)).data as { id: string }).id;
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_introuvable' });
  });
  it('une zone citée par une combinaison : refus, la forme ne bouge pas', async () => {
    const a = ((await creer()).data as { id: string }).id;
    const b = ((await creer()).data as { id: string }).id;
    await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [a, b] });
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: a, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_referencee', par: 'combinaison' });
  });
  it('une zone membre d’un composite (React) : refus', async () => {
    const a = ((await creer()).data as { id: string }).id;
    await admin.rpc('create_custom_geo_zone', {
      p_name: 'Composite', p_description: null, p_org_id: org, p_source_type: 'composite',
      p_source_metadata: { kind: 'union', member_zone_ids: [a] }, p_geometry_geojson: CARRE,
    });
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: a, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_referencee', par: 'composite' });
  });
});

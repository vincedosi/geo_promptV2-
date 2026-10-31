/**
 * Les routes d'un jeu de ZONE contre la vraie base locale (lot 5, T7) : `POST` / `GET /api/zones/jeux`,
 * `GET` / `PATCH` / `DELETE /api/zones/jeux/[id]`, et `POST /api/zones/[id]/recalculer` sur la zone d'un jeu
 * (Review Focus 2 : une zone d'un jeu enregistré ne se recalcule plus — 409 `zone_referencee` existant).
 *
 * Seuls l'appelant et les quotas sont simulés (le 429 est prouvé en unitaire) : les contraintes, la clé étrangère
 * `(plateforme, maille) → plateformes_geo` et la jointure du nom de zone sont celles de la base. Deux espaces
 * `[ESSAI lot5 T7]` sont créés puis supprimés ; jeux et zones partent avec eux.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

const sb = creerClientTest();
const LONG = 60_000;
const appelant = vi.hoisted(() => ({ org: '' }));

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000007a1', role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const liste = await import('@/app/api/zones/jeux/route');
const unJeu = await import('@/app/api/zones/jeux/[id]/route');
const recalculer = await import('@/app/api/zones/[id]/recalculer/route');

let org = '';
let autreOrg = '';
let zone = '';
let zoneAutre = '';
let risque = '';

const URL = 'http://localhost/api/zones/jeux';
const json = (methode: string, corps: unknown) =>
  ({ method: methode, body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const poster = (corps: unknown) => liste.POST(new NextRequest(URL, json('POST', corps)));
const lire = (id: string) => unJeu.GET(new NextRequest(`${URL}/${id}`), params(id));
const patcher = (id: string, corps: unknown) => unJeu.PATCH(new NextRequest(`${URL}/${id}`, json('PATCH', corps)), params(id));

const jeuDe = (zoneId: string, plateformes: unknown[] = [
  { plateforme: 'dv360', maille: 'cp', seuil: 20 },
  { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 },
]) => ({ type: 'zone', zone_id: zoneId, cible: 'ind', mode_plan: 'pondere', plateformes });

async function nouvelleOrg(nom: string): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: `[ESSAI lot5 T7] ${nom}`, slug: `essai-lot5-t7-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

/** Une zone RECALCULABLE (rayon de 5 km autour de Lyon) : sans référence, `recalculer` irait jusqu'au calcul. */
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

async function choixEnBase(jeuId: string) {
  const { data, error } = await sb.from('zone_set_plateformes').select('plateforme, maille, seuil, rayon_m')
    .eq('zone_set_id', jeuId).order('plateforme');
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ ...c, seuil: Number(c.seuil) }));
}

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  appelant.org = org;
  zone = await creerZone('Lyon 5 km', org);
  zoneAutre = await creerZone('Lyon 5 km (autre espace)', autreOrg);
  // Un jeu RISQUE dans le même espace, écrit directement : la liste doit rendre les deux types.
  const { data, error } = await sb.from('zone_sets').insert({
    org_id: org, nom: 'Seveso essai', type: 'risque', profil: { haut: [1000] }, profil_hash: `essai-t7-${Date.now()}`,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  risque = data.id as string;
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    // Les jeux d'abord : leur clé étrangère vers la zone est `on delete restrict`.
    const jeux = await sb.from('zone_sets').delete().eq('org_id', o);
    if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
    const { error } = await sb.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('POST /api/zones/jeux — jeu de zone', () => {
  let jeu = '';

  it('201 : en-tête de type zone, deux choix, version 1 puis 2 pour le même nom ; aucun profil, aucun CP', async () => {
    const r = await poster({ nom: 'Lyon essai', jeu: jeuDe(zone) });
    expect(r.status).toBe(201);
    const cree = await r.json() as { id: string; version: number };
    expect(cree.version).toBe(1);
    jeu = cree.id;

    const { data: ligne } = await sb.from('zone_sets').select('type, custom_geo_zone_id, cible, profil, created_by')
      .eq('id', jeu).single();
    expect(ligne).toEqual({ type: 'zone', custom_geo_zone_id: zone, cible: 'ind', profil: null,
      created_by: '00000000-0000-4000-8000-0000000007a1' });
    expect(await choixEnBase(jeu)).toEqual([
      { plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null },
      { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 },
    ]);
    const { count } = await sb.from('zone_set_cp').select('*', { count: 'exact', head: true }).eq('zone_set_id', jeu);
    expect(count).toBe(0);

    const v2 = await poster({ nom: 'Lyon essai', jeu: jeuDe(zone, [{ plateforme: 'ttd', maille: 'polygone', seuil: 0 }]) });
    expect(v2.status).toBe(201);
    expect((await v2.json()).version).toBe(2);
  }, LONG);

  it.each([
    ['couple absent de plateformes_geo', [{ plateforme: 'dv360', maille: 'iris', seuil: 20 }]],
    ['maille disponible = false (TikTok CP)', [{ plateforme: 'tiktok', maille: 'cp', seuil: 20 }]],
    ['rayon sous la borne lue en base (Meta, 1 km)', [{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 500 }]],
  ])('400 %s — aucun jeu écrit', async (_n, plateformes) => {
    const avant = await sb.from('zone_sets').select('id', { count: 'exact', head: true }).eq('org_id', org);
    const r = await poster({ nom: 'Refusé', jeu: jeuDe(zone, plateformes) });
    expect(r.status).toBe(400);
    const apres = await sb.from('zone_sets').select('id', { count: 'exact', head: true }).eq('org_id', org);
    expect(apres.count).toBe(avant.count);
  });

  it('404 : la zone d’un AUTRE espace', async () => {
    const r = await poster({ nom: 'Intrus', jeu: jeuDe(zoneAutre) });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Zone introuvable dans cet espace.');
  });

  it('GET de la liste SANS paramètre : les seuls jeux risque (la liste d’avant le lot 5, revue finale point 1)', async () => {
    const r = await liste.GET(new NextRequest(URL));
    const { jeux } = await r.json() as { jeux: { id: string; type: string }[] };
    expect(jeux.some((j) => j.id === risque)).toBe(true);
    expect(jeux.some((j) => j.id === jeu)).toBe(false);
    expect(jeux.every((j) => j.type === 'risque')).toBe(true);
  });

  it('GET de la liste ?type=tous : les deux types, le nom de la zone pour le jeu de zone', async () => {
    const r = await liste.GET(new NextRequest(`${URL}?type=tous`));
    const { jeux } = await r.json() as { jeux: { id: string; type: string; custom_geo_zone_id: string | null; zone_nom: string | null }[] };
    expect(jeux.find((j) => j.id === jeu)).toMatchObject({ type: 'zone', custom_geo_zone_id: zone, zone_nom: 'Lyon 5 km' });
    expect(jeux.find((j) => j.id === risque)).toMatchObject({ type: 'risque', custom_geo_zone_id: null, zone_nom: null });
  });

  it('GET [id] : { jeu, zone, plateformes }', async () => {
    const r = await lire(jeu);
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps.jeu).toMatchObject({ id: jeu, type: 'zone', nom: 'Lyon essai', version: 1, cible: 'ind' });
    expect(corps.jeu.org_id).toBeUndefined();
    expect(corps.zone).toEqual({ id: zone, nom: 'Lyon 5 km', recette: { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000, part_retenue: 1 } });
    expect(corps.plateformes.map((c: { plateforme: string }) => c.plateforme)).toEqual(['dv360', 'meta']);
  });

  it('GET [id] depuis un autre espace : 404 du chargeur', async () => {
    appelant.org = autreOrg;
    try {
      expect((await lire(jeu)).status).toBe(404);
    } finally {
      appelant.org = org;
    }
  });

  it('PATCH remplace les choix (dv360 retiré, meta réglé, tiktok ajouté), renomme, change le mode', async () => {
    const r = await patcher(jeu, {
      nom: 'Lyon essai réglé', mode_plan: 'exclusif',
      plateformes: [
        { plateforme: 'meta', maille: 'cercle', seuil: 25, rayon_m: 15000 },
        { plateforme: 'tiktok', maille: 'commune', seuil: 40 },
      ],
    });
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps.jeu).toMatchObject({ nom: 'Lyon essai réglé', mode_plan: 'exclusif' });
    expect(await choixEnBase(jeu)).toEqual([
      { plateforme: 'meta', maille: 'cercle', seuil: 25, rayon_m: 15000 },
      { plateforme: 'tiktok', maille: 'commune', seuil: 40, rayon_m: null },
    ]);
    expect(corps.plateformes).toHaveLength(2);
  });

  it('PATCH d’un couple non disponible : 400, choix inchangés', async () => {
    const r = await patcher(jeu, { plateformes: [{ plateforme: 'dv360', maille: 'polygone', seuil: 20 }] });
    expect(r.status).toBe(400);
    expect((await choixEnBase(jeu)).map((c) => c.plateforme)).toEqual(['meta', 'tiktok']);
  });

  it('Review Focus 2 : la zone d’un jeu enregistré ne se recalcule plus — 409 zone_referencee existant', async () => {
    const r = await recalculer.POST(new NextRequest(`http://localhost/api/zones/${zone}/recalculer`, { method: 'POST' }), params(zone));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ refus: 'zone_referencee', par: 'jeu_de_zones' });
  });

  it('DELETE : les jeux partent (choix en cascade), la zone est libérée', async () => {
    const { data: jeux } = await sb.from('zone_sets').select('id').eq('custom_geo_zone_id', zone);
    for (const { id } of jeux ?? []) {
      const r = await unJeu.DELETE(new NextRequest(`${URL}/${id}`, { method: 'DELETE' }), params(id));
      expect(r.status).toBe(200);
    }
    expect(await choixEnBase(jeu)).toEqual([]);
    const { data: ref } = await sb.rpc('zone_referencee', { p_zone_id: zone });
    expect(ref).toBeNull();
  }, LONG);
});

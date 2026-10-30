/**
 * Finitions de ④ Analyse (plan 2026-10-30), côté base.
 *
 * T1 — `codes_postaux_de_zone_jsonb` (sql/295) : les codes postaux d'une zone pour le score composite sont ceux de la
 * couverture « Par code postal » (`couverture_geometrie(…, 'cp')`), au code près : les CP des carreaux dont le centroïde
 * est dans la zone (`carreaux_de_forme`), et non plus les CP dont le centroïde du contour y tombe. Une zone de 2 km à la
 * campagne n'est plus « vide ».
 *
 * Les zones de test sont créées dans deux espaces de test, supprimés (cascade) en fin de fichier. La zone composite
 * (13 001 km², espace interne) est seulement LUE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const LONG = 120_000;

/** Zone composite de l'espace interne : 13 001 km², 23 073 sommets (mesures du plan). */
const COMPOSITE = '919ca65d-665a-43f6-834e-ea9f2eb68c72';
const ESPACE_INTERNE = '00000000-0000-0000-0000-000000000001';

let org = '';
let autreOrg = '';
const zones: Record<string, string> = {};

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI ④ finitions] ${nom}`, slug: `essai-analyse-finitions-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

async function creerZone(nom: string, type: string, geojson: string, o = org): Promise<string> {
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: o, p_cree_par: null, p_recette: { v: 1, type }, p_geometry_geojson: geojson,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

const carre = (o: number, s: number, e: number, n: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] });

async function disque(lon: number, lat: number, rayon: number): Promise<string> {
  const { data, error } = await admin.rpc('zone_rayon', { p_lon: lon, p_lat: lat, p_rayon_m: rayon });
  if (error) throw new Error(error.message);
  return JSON.stringify((data as { geometry: unknown }).geometry);
}

async function codesDeZone(zone: string, o = org): Promise<{ codes?: string[]; refus?: string }> {
  const { data, error } = await admin.rpc('codes_postaux_de_zone_jsonb', { p_zone: zone, p_org: o });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as { codes?: string[]; refus?: string };
}

async function codesDeCouverture(zone: string, o = org): Promise<string[]> {
  const { data, error } = await admin.rpc('couverture_geometrie', { p_zone_id: zone, p_org_id: o, p_decoupage: 'cp' });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return (data as { lignes: { code: string }[] }).lignes.map((l) => l.code);
}

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  zones.rural = await creerZone('Disque 2 km (0,5 ; 45,9)', 'rayon_point', await disque(0.5, 45.9, 2000));
  zones.lyon = await creerZone('Disque 2 km Lyon', 'rayon_point', await disque(4.8357, 45.764, 2000));
  zones.vaste = await creerZone('Rectangle de 180 000 km²', 'dessin', carre(0, 44, 5, 48));
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('T1 — codes_postaux_de_zone_jsonb : la règle de la couverture', () => {
  it('disque de 2 km à la campagne : les CP de la couverture, au code près (2 CP, plus de « Périmètre vide »)', async () => {
    const r = await codesDeZone(zones.rural);
    expect(r.refus).toBeUndefined();
    expect(r.codes).toEqual(['16270', '16450']);
    expect(new Set(r.codes)).toEqual(new Set(await codesDeCouverture(zones.rural)));
  }, LONG);

  it('disque de 2 km à Lyon : même ensemble que la couverture, codes triés et sans nul', async () => {
    const r = await codesDeZone(zones.lyon);
    const couverture = await codesDeCouverture(zones.lyon);
    expect(couverture.length).toBeGreaterThan(0);
    expect(new Set(r.codes)).toEqual(new Set(couverture));
    expect(r.codes).toEqual([...r.codes!].sort());
    expect(r.codes!.every((c) => typeof c === 'string' && c !== '')).toBe(true);
  }, LONG);

  it('zone composite de 13 001 km² : 895 codes postaux (459 avec l’ancienne règle)', async () => {
    const r = await codesDeZone(COMPOSITE, ESPACE_INTERNE);
    expect(r.codes).toHaveLength(895);
  }, LONG);

  it('zone d’un autre espace : `zone_introuvable`, sans un code', async () => {
    expect(await codesDeZone(zones.rural, autreOrg)).toEqual({ refus: 'zone_introuvable' });
    expect(await codesDeZone(COMPOSITE, org)).toEqual({ refus: 'zone_introuvable' });
  });

  it('zone absente : `zone_introuvable`', async () => {
    expect(await codesDeZone('00000000-0000-0000-0000-00000000dead')).toEqual({ refus: 'zone_introuvable' });
  });

  it('zone de plus de 100 000 km² : `zone_trop_vaste`, la borne de la couverture', async () => {
    const r = await codesDeZone(zones.vaste) as { refus?: string; plafond_km2?: number; surface_km2?: number };
    expect(r.refus).toBe('zone_trop_vaste');
    expect(r.plafond_km2).toBe(100000);
    expect(r.surface_km2).toBeGreaterThan(100000);
  });
});

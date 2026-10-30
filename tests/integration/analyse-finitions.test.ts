/**
 * Finitions de ④ Analyse (plan 2026-10-30), côté base.
 *
 * T1 — `codes_postaux_de_zone_jsonb` (sql/295) : les codes postaux d'une zone pour le score composite sont ceux de la
 * couverture « Par code postal » (`couverture_geometrie(…, 'cp')`), au code près : les CP des carreaux dont le centroïde
 * est dans la zone (`carreaux_de_forme`), et non plus les CP dont le centroïde du contour y tombe. Une zone de 2 km à la
 * campagne n'est plus « vide ».
 *
 * T2 — la zone « France entière » (sql/296) : recette `pays` (`METRO` | `FR`), forme par `zone_pays_geometrie`, couverture
 * par `couverture_zone` → `couverture_pays_jsonb`, chiffrée par les dénominateurs nationaux sans lire un carreau ; IRIS
 * et commune refusés ; le score sur une zone pays prend les CP de cette couverture.
 *
 * Les zones de test sont créées dans deux espaces de test, supprimés (cascade) en fin de fichier. La zone composite
 * (13 001 km², espace interne) est seulement LUE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { creerClientTest } from './_client';
import { psql, psqlBrut } from './_psql';

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

/** Ce que fait `POST /api/zones` pour une recette pays : la forme par `zone_pays_geometrie`, écrite par `creer_zone_recette`. */
async function creerZonePays(code: 'METRO' | 'FR', o = org): Promise<string> {
  const { data: forme, error: e1 } = await admin.rpc('zone_pays_geometrie', { p_code: code });
  if (e1) throw new Error(e1.message);
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: `Pays ${code}`, p_org_id: o, p_cree_par: null, p_recette: { v: 1, type: 'pays', code },
    p_geometry_geojson: JSON.stringify((forme as { geometry: unknown }).geometry),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

interface CouvertureZone {
  refus?: string; motif?: string; pays?: string; decoupage?: string; population: number; n_carreaux: number;
  lignes: { code: string; part: number | null; pop_en_zone: number; pop_totale: number | null }[];
  n_territoires: number; surface_km2: number; zone_id: string; cache: boolean;
}

async function couvertureZone(zone: string, decoupage: string, o = org): Promise<CouvertureZone> {
  const { data, error } = await admin.rpc('couverture_zone', { p_zone_id: zone, p_org_id: o, p_cible: 'ind', p_decoupage: decoupage });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as CouvertureZone;
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
  zones.metro = await creerZonePays('METRO');
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

describe('T2 — la zone pays et sa couverture nationale (sql/296)', () => {
  /** Les références nationales, lues dans les dénominateurs (mesurées le 30/10 : 5 956 CP, 62 528 975 hab.). */
  const refMetro = () => psql(`select count(*) || '|' || round(sum((populations->>'ind')::numeric))
                                 from public.cp_population_totale
                                where code_postal not like '97%' and code_postal not like '98%';`).split('|').map(Number);

  it('recette `pays` METRO → une zone multipolygone, sans aucune région d’outre-mer', () => {
    const r = psql(`select st_numgeometries(z.geometry) || '|' || (z.recette->>'type') || '|' || (z.recette->>'code')
                      from public.custom_geo_zones z where z.id = '${zones.metro}';`).split('|');
    expect(Number(r[0])).toBeGreaterThanOrEqual(1);
    expect(r.slice(1)).toEqual(['pays', 'METRO']);
    const drom = psql(`select count(*) from public.ref_regions r, public.custom_geo_zones z
                        where z.id = '${zones.metro}' and r.code_region in ('01', '02', '03', '04', '06')
                          and st_intersects(z.geometry, coalesce(r.geom_perimetre, r.geom));`);
    expect(drom).toBe('0');
  });

  it('la contrainte refuse toujours un type inconnu', () => {
    const r = psqlBrut(`begin; update public.custom_geo_zones set recette = '{"v":1,"type":"planete"}' where id = '${zones.metro}'; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('custom_geo_zones_recette_forme');
  });

  it('telle quelle : la population nationale de la cible, somme de cp_population_totale hors outre-mer', async () => {
    const [nCp, pop] = refMetro();
    expect(nCp).toBe(5956);
    expect(pop).toBe(62_528_975);
    const r = await couvertureZone(zones.metro, 'forme');
    expect(r.refus).toBeUndefined();
    expect(r.pays).toBe('METRO');
    expect(r.population).toBe(pop);
    expect(r.lignes).toEqual([]);
    expect(r.zone_id).toBe(zones.metro);
    expect(r.surface_km2).toBeGreaterThan(500_000);
  }, LONG);

  it('par code postal : chaque CP du pays à 100 %, autant de lignes que de CP métropolitains', async () => {
    const [nCp] = refMetro();
    const r = await couvertureZone(zones.metro, 'cp');
    expect(r.refus).toBeUndefined();
    expect(r.lignes).toHaveLength(nCp);
    expect(r.n_territoires).toBe(nCp);
    expect(r.lignes.every((l) => l.part === 100 && l.pop_en_zone === l.pop_totale)).toBe(true);
    expect(r.lignes.some((l) => l.code.startsWith('97') || l.code.startsWith('98'))).toBe(false);
    expect(r.lignes.some((l) => l.code.startsWith('20'))).toBe(true); // la Corse est en métropole
  }, LONG);

  it('par département : 96 départements métropolitains, à 100 %', async () => {
    const r = await couvertureZone(zones.metro, 'departement');
    expect(r.lignes).toHaveLength(96);
    expect(r.lignes.every((l) => l.part === 100)).toBe(true);
  }, LONG);

  it('IRIS et commune : refus `decoupage_trop_fin_pays`, sans lecture', async () => {
    expect((await couvertureZone(zones.metro, 'iris')).refus).toBe('decoupage_trop_fin_pays');
    expect((await couvertureZone(zones.metro, 'commune')).refus).toBe('decoupage_trop_fin_pays');
  });

  it('une seconde lecture sert le cache', async () => {
    await couvertureZone(zones.metro, 'forme');
    expect((await couvertureZone(zones.metro, 'forme')).cache).toBe(true);
  }, LONG);

  it('une zone NON pays de plus de 100 000 km² reste `zone_trop_vaste` ; une zone pays d’un autre espace, introuvable', async () => {
    expect((await couvertureZone(zones.vaste, 'forme')).refus).toBe('zone_trop_vaste');
    expect((await couvertureZone(zones.metro, 'forme', autreOrg)).refus).toBe('zone_introuvable');
  });

  it('le score sur une zone pays prend les CP de la couverture nationale, au code près', async () => {
    const r = await codesDeZone(zones.metro);
    const couverture = await couvertureZone(zones.metro, 'cp');
    expect(new Set(r.codes)).toEqual(new Set(couverture.lignes.map((l) => l.code)));
  }, LONG);

  it('compteurs de « Mes zones » sans lecture géométrique : CP du référentiel métropolitain, aucun code écrit', () => {
    // Un membre de l'espace de test (supprimé avec lui, en cascade), comme l'exige resolve_custom_geo_zone_codes.
    const user = psql(`select id from auth.users order by created_at limit 1;`);
    psql(`insert into public.organization_members (user_id, organization_id) values ('${user}', '${org}') on conflict do nothing;`);
    const o = JSON.parse(psql(`select public.compter_zone_pays('${zones.metro}', '${user}')::text;`)) as { count_cp: number; count_iris: number };
    expect(o.count_cp).toBe(Number(psql(`select count(*) from public.ref_codes_postaux where code_dept not like '97%' and code_dept not like '98%';`)));
    expect(o.count_iris).toBeGreaterThan(45_000);
    expect(psql(`select count(*) from public.custom_geo_zone_codes where zone_id = '${zones.metro}';`)).toBe('0');
    const refus = psqlBrut(`select public.compter_zone_pays('${zones.rural}', '${user}');`);
    expect(refus.status).not.toBe(0);
  });

  it('rejouer la migration ne change rien', () => {
    const empreinte = () => psql(`select (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname))
                                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname = 'public' and p.proname in ('pays_contient_code', 'zone_pays_geometrie',
                                     'couverture_pays_jsonb', 'couverture_zone', 'codes_postaux_de_zone_jsonb', 'compter_zone_pays'))
                                  || '|' || (select pg_get_constraintdef(oid) from pg_constraint
                                              where conname = 'custom_geo_zones_recette_forme');`);
    const avant = empreinte();
    const r = psqlBrut(readFileSync('sql/296_zone_pays.sql', 'utf8'));
    expect(r.status, r.stderr).toBe(0);
    expect(empreinte()).toBe(avant);
  });
});

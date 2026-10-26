/**
 * Rayon autour de TOUS les POI d'un type, dans le périmètre de ① (spec § 16.3, arbitrage L3-1 : la zone est découpée
 * par le périmètre). Mesures du 2026-10-14 : 5 584 lycées, 5 km, région ARA → 0,8 s.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
// Les lycées ont TOUS une source (0 sur 5 584 sans data_source_id, mesuré le 14/10) : sans elle, ils sont invisibles.
let sourcesLycees: string[] = [];
beforeAll(async () => {
  const { data, error } = await admin.from('poi_france').select('data_source_id').eq('categorie', 'lycee').limit(1);
  if (error || !data?.[0]?.data_source_id) throw new Error(`source des lycées : ${error?.message ?? 'absente'}`);
  sourcesLycees = [data[0].data_source_id as string];
});
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_rayon_poi', {
  p_categorie: 'lycee', p_rayon_m: 5000, p_perimetre_type: 'departement', p_perimetre_code: '13',
  p_org_id: null, p_sources: sourcesLycees, p_max_poi: 5000, ...args,
});

describe('zone_rayon_poi', () => {
  it('les lycées des Bouches-du-Rhône à 5 km : une zone, découpée par le département', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    const r = data as { vide: boolean; compte: number; geometry: { type: string }; surface_km2: number; part_retenue: number };
    expect(r.vide).toBe(false);
    expect(r.compte).toBeGreaterThan(50);
    expect(r.geometry.type).toBe('MultiPolygon');
    expect(r.part_retenue).toBeGreaterThan(0);
    // STRICTEMENT sous 1 : des lycées du littoral et des confins (Marseille, Arles, Aubagne…) ont un cercle de 5 km qui
    // déborde en mer ou sur le Var et le Vaucluse. Une part de 1 dirait que le département n'a rien découpé (L3-1).
    expect(r.part_retenue).toBeLessThan(1);
  });
  it('POI d’une source NON visible : invisibles (les lycées sans leur source, les CIRFA)', async () => {
    expect((await appeler({ p_sources: [] })).data).toMatchObject({ vide: true, compte: 0, geometry: null });
    const { data } = await appeler({ p_categorie: 'cirfa', p_perimetre_type: 'region', p_perimetre_code: '93' });
    expect(data).toMatchObject({ vide: true, compte: 0, geometry: null });
  });
  it.each([
    ['France entière', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, 'perimetre_national_refuse'],
    ['département inconnu', { p_perimetre_code: '00' }, 'perimetre_inconnu'],
  ])('%s : refus, sans calcul', async (_n, args, refus) => {
    const { data, error } = await appeler(args);
    expect(error).toBeNull();
    expect(data).toEqual({ refus });
  });
  it('plus de POI que le plafond : refus « trop_de_poi », jamais une zone partielle', async () => {
    const { data } = await appeler({ p_max_poi: 10 });
    expect(data).toEqual({ refus: 'trop_de_poi', plafond: 10 });
  });
  it('rayon hors bornes : 22023', async () => {
    const { error } = await appeler({ p_rayon_m: 60_000 });
    expect(error?.code).toBe('22023');
  });
});

/**
 * Branche `('france', 'METRO')` (sql/285, retours du 26/10, T2) : aucune borne produit, seule la capacité synchrone
 * mesurée (10 000 POI) ; points lus par catégorie d'abord et bornés par BBOX_METRO, cercles découpés par l'union des
 * régions de métropole.
 */
describe('zone_rayon_poi — France métropolitaine', () => {
  const SOURCE_CIRFA = admin.from('poi_france').select('data_source_id').eq('categorie', 'cirfa').limit(1);
  let sourcesCirfa: string[] = [];
  beforeAll(async () => {
    const { data, error } = await SOURCE_CIRFA;
    if (error || !data?.[0]?.data_source_id) throw new Error(`source des CIRFA : ${error?.message ?? 'absente'}`);
    sourcesCirfa = [data[0].data_source_id as string];
  });
  const metro = (args: Record<string, unknown>) => appeler({
    p_perimetre_type: 'france', p_perimetre_code: 'METRO', p_rayon_m: 20_000, p_max_poi: 10_000, ...args,
  });
  /** Toutes les positions d'un MultiPolygon GeoJSON. */
  const positions = (g: { coordinates: number[][][][] }) => g.coordinates.flat(2);

  it('CIRFA à 20 km : les 95 CIRFA de métropole (Nice compris), aucune partie hors métropole', async () => {
    const { data, error } = await metro({ p_categorie: 'cirfa', p_sources: sourcesCirfa });
    expect(error).toBeNull();
    const r = data as { vide: boolean; compte: number; geometry: { type: string; coordinates: number[][][][] } };
    expect(r.vide).toBe(false);
    expect(r.compte).toBe(95);
    expect(r.geometry.type).toBe('MultiPolygon');
    const horsMetro = positions(r.geometry).filter(([x, y]) => x < -5.5 || x > 9.8 || y < 41.2 || y > 51.2);
    expect(horsMetro).toEqual([]);
  });

  it('lycées à 20 km (la plus grosse catégorie commune, 5 324 en métropole) : calculés, sans plafond produit', async () => {
    const { data, error } = await metro({});
    expect(error).toBeNull();
    expect(data).toMatchObject({ vide: false, compte: 5324 });
  });

  it('arrêts de transport (285 000) : au-delà de la capacité synchrone, refus « trop_de_poi_metropole »', async () => {
    const { data, error } = await metro({ p_categorie: 'arret_transport', p_sources: [] });
    expect(error).toBeNull();
    expect(data).toEqual({ refus: 'trop_de_poi_metropole', plafond: 10_000 });
  });

  it('la capacité ne se contourne pas par p_max_poi : 22023 au-delà de 10 000', async () => {
    expect((await metro({ p_max_poi: 20_000 })).error?.code).toBe('22023');
  });

  it('un périmètre local a la même capacité (relecture 1, I-4) : 22023 au-delà de 10 000 seulement', async () => {
    expect((await appeler({ p_max_poi: 10_001 })).error?.code).toBe('22023');
    expect((await appeler({ p_max_poi: 10_000 })).error).toBeNull();
  });

  it('sites ICPE de Bretagne (13 865) : au-delà de la capacité, refus « trop_de_poi » à 10 000 — plus « 5 000 »', async () => {
    const { data, error } = await appeler({
      p_categorie: 'risque_industriel', p_rayon_m: 2000, p_perimetre_type: 'region', p_perimetre_code: '53', p_sources: [], p_max_poi: 10_000,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ refus: 'trop_de_poi', plafond: 10_000 });
  });

  it('France entière (FR) : toujours refusée', async () => {
    expect((await appeler({ p_perimetre_type: 'france', p_perimetre_code: 'FR' })).data).toEqual({ refus: 'perimetre_national_refuse' });
  });
});

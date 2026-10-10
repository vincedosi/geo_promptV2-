/**
 * `get_zone_centroids_jsonb` (sql/243) — la météo au code postal sur TOUS les CP.
 *
 * `get_zone_centroids` (`RETURNS TABLE`) était coupée par PostgREST : 1 000
 * centroïdes sur 6 187 en local (`max_rows`), 5 000 sur l'ancienne production,
 * et la queue perdue portait les 136 codes ultramarins. La jumelle rend du
 * `jsonb`, filtre la bbox en base et DIT quand sa borne est atteinte.
 *
 * ⚠ Lit la base locale : on compare à des comptes lus dans la même base.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Zone { code: string; nom: string | null; lat: number; lon: number }
interface Reponse { zones: Zone[]; tronque: boolean }

const METRO = { p_ouest: -5.5, p_sud: 41.0, p_est: 10.0, p_nord: 51.5 };
const RHONE = { p_ouest: 4.0, p_sud: 45.5, p_est: 5.5, p_nord: 46.5 };

async function compteCp(): Promise<number> {
  const { count, error } = await sb.from('ref_codes_postaux').select('code_postal', { count: 'exact', head: true });
  expect(error).toBeNull();
  return count ?? 0;
}

describe('get_zone_centroids_jsonb', () => {
  it('sans bbox : tous les codes postaux du référentiel, DROM compris, sans doublon', async () => {
    const { data, error } = await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp' });
    expect(error).toBeNull();
    const r = data as Reponse;
    expect(r.tronque).toBe(false);
    expect(r.zones.length).toBe(await compteCp());
    expect(r.zones.length).toBeGreaterThan(5000);
    expect(new Set(r.zones.map((z) => z.code)).size).toBe(r.zones.length);
    expect(r.zones.some((z) => z.code.startsWith('97'))).toBe(true);
    for (const z of r.zones) {
      expect(Number.isFinite(z.lat)).toBe(true);
      expect(Number.isFinite(z.lon)).toBe(true);
    }
  });

  it('bbox métropole : plus de 1 000 CP, tous dans la bbox', async () => {
    const r = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', ...METRO })).data as Reponse;
    expect(r.tronque).toBe(false);
    expect(r.zones.length).toBeGreaterThan(5000);
    for (const z of r.zones) {
      expect(z.lon).toBeGreaterThanOrEqual(METRO.p_ouest);
      expect(z.lon).toBeLessThanOrEqual(METRO.p_est);
      expect(z.lat).toBeGreaterThanOrEqual(METRO.p_sud);
      expect(z.lat).toBeLessThanOrEqual(METRO.p_nord);
    }
  });

  it('bbox d un département : le sous-ensemble exact du palier complet', async () => {
    const tout = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp' })).data as Reponse;
    const attendus = tout.zones.filter((z) =>
      z.lon >= RHONE.p_ouest && z.lon <= RHONE.p_est && z.lat >= RHONE.p_sud && z.lat <= RHONE.p_nord,
    ).map((z) => z.code).sort();
    const r = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', ...RHONE })).data as Reponse;
    expect(r.zones.map((z) => z.code).sort()).toEqual(attendus);
    expect(attendus.length).toBeGreaterThan(50);
  });

  it('borne atteinte : exactement la borne, et tronque = vrai ; pile : faux', async () => {
    const n = await compteCp();
    const moins = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', p_limite: n - 1 })).data as Reponse;
    expect(moins.zones).toHaveLength(n - 1);
    expect(moins.tronque).toBe(true);
    const pile = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', p_limite: n })).data as Reponse;
    expect(pile.zones).toHaveLength(n);
    expect(pile.tronque).toBe(false);
  });

  it('paliers région et département inchangés (18 et 104 lignes au référentiel)', async () => {
    const reg = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'region' })).data as Reponse;
    const dep = (await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'departement' })).data as Reponse;
    const { count: nReg } = await sb.from('ref_regions').select('code_region', { count: 'exact', head: true });
    const { count: nDep } = await sb.from('ref_departements').select('code_dept', { count: 'exact', head: true });
    expect(reg.zones).toHaveLength(nReg ?? -1);
    expect(dep.zones).toHaveLength(nDep ?? -1);
  });

  it('palier inconnu : erreur', async () => {
    const { error } = await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'commune' });
    expect(error).not.toBeNull();
  });
});

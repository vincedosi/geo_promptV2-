/**
 * `codes_postaux_dans_bbox_jsonb` (sql/245) — les codes postaux d'une bbox,
 * tous.
 *
 * `codes_postaux_dans_bbox` (`RETURNS TABLE`) rendait 1 000 codes sur 6 051
 * pour la métropole sous le `max_rows` local : `/api/analyses/score` scorait
 * les 1 000 premiers codes d'une grande zone enregistrée.
 *
 * ⚠ Lit la base locale : on compare à des comptes et à une autre RPC de la
 * même base, jamais à des valeurs figées.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

const METRO = { p_ouest: -5.5, p_sud: 41.0, p_est: 10.0, p_nord: 51.5 };
const RHONE = { p_ouest: 4.0, p_sud: 45.5, p_est: 5.5, p_nord: 46.5 };

async function codes(bbox: typeof METRO): Promise<string[]> {
  const { data, error } = await sb.rpc('codes_postaux_dans_bbox_jsonb', bbox);
  expect(error).toBeNull();
  return data as string[];
}

/** Le même périmètre lu par une autre voie : les centroïdes de sql/243. */
async function attendus(bbox: typeof METRO): Promise<string[]> {
  const { data } = await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', ...bbox });
  return (data as { zones: { code: string }[] }).zones.map((z) => z.code).sort();
}

describe('codes_postaux_dans_bbox_jsonb', () => {
  it('bbox métropole : bien plus de 1 000 codes, triés, sans doublon, sans DROM', async () => {
    const r = await codes(METRO);
    expect(r.length).toBeGreaterThan(5000);
    expect(new Set(r).size).toBe(r.length);
    expect([...r].sort()).toEqual(r);
    expect(r.some((c) => c.startsWith('97'))).toBe(false);
    expect(r).toEqual(await attendus(METRO));
  });

  it('bbox d un département : le même ensemble que les centroïdes', async () => {
    const r = await codes(RHONE);
    expect(r.length).toBeGreaterThan(50);
    expect(r).toEqual(await attendus(RHONE));
  });

  it('bbox vide (océan) : tableau vide, pas null', async () => {
    expect(await codes({ p_ouest: -30, p_sud: 30, p_est: -25, p_nord: 35 })).toEqual([]);
  });
});

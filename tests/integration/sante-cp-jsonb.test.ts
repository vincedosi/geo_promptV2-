/**
 * `lire_sante_cp_jsonb` (sql/244) — la santé environnementale au code postal,
 * tout le jour, en un passage.
 *
 * La route lisait la table du jour par PostgREST (`max_rows` = 1 000) et, avec
 * une bbox, la liste des CP par `codes_postaux_dans_bbox` (`RETURNS TABLE`,
 * 1 000 sur 6 051 en métropole). La RPC fait la date, le seuil, la bbox et la
 * borne en base.
 *
 * ⚠ Lit la base locale : on compare à des comptes lus dans la même base, et
 * à des RPC/tables relues directement — jamais à des valeurs figées.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Ligne { code_postal: string; indice_global: number; [k: string]: unknown }
interface Reponse { date: string | null; rows: Ligne[]; tronque: boolean }

const METRO = { p_ouest: -5.5, p_sud: 41.0, p_est: 10.0, p_nord: 51.5 };

async function lire(args: Record<string, unknown>): Promise<Reponse> {
  const { data, error } = await sb.rpc('lire_sante_cp_jsonb', args);
  expect(error).toBeNull();
  return data as Reponse;
}

async function lignesDuJour(table: 'pollen_map_daily' | 'atmo_map_daily', date: string): Promise<number> {
  const { count, error } = await sb.from(table).select('code_postal', { count: 'exact', head: true })
    .eq('date_ech', date).gte('indice_global', 1);
  expect(error).toBeNull();
  return count ?? -1;
}

describe('lire_sante_cp_jsonb', () => {
  for (const jeu of ['pollen', 'atmo'] as const) {
    it(`${jeu} sans bbox : toutes les lignes peintes du dernier jour, triées, sans doublon`, async () => {
      const r = await lire({ p_jeu: jeu });
      if (r.date === null) {
        expect(r.rows).toEqual([]);
        return;
      }
      const table = jeu === 'pollen' ? 'pollen_map_daily' : 'atmo_map_daily';
      const { data: derniere } = await sb.from(table).select('date_ech').order('date_ech', { ascending: false }).limit(1);
      expect(r.date).toBe(derniere?.[0]?.date_ech);
      expect(r.rows).toHaveLength(await lignesDuJour(table, r.date));
      expect(r.tronque).toBe(false);
      const codes = r.rows.map((l) => l.code_postal);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort()).toEqual(codes);
      for (const l of r.rows) expect(l.indice_global).toBeGreaterThanOrEqual(1);
    });
  }

  it('colonnes : exactement celles que la route rendait (pollen)', async () => {
    const r = await lire({ p_jeu: 'pollen' });
    if (!r.rows.length) return;
    expect(Object.keys(r.rows[0]).sort()).toEqual([
      'alerte', 'ambroisie', 'armoise', 'aulne', 'bouleau', 'code_postal', 'conc_ambroisie', 'conc_armoise',
      'conc_aulne', 'conc_bouleau', 'conc_graminees', 'conc_olivier', 'graminees', 'indice_global',
      'nb_communes', 'olivier',
    ]);
  });

  it('bbox : le sous-ensemble dont le centroïde du CP tombe dans la bbox', async () => {
    const tout = await lire({ p_jeu: 'pollen' });
    // Une bbox serrée autour des CP présents (Ain, 01xxx) puis la métropole.
    const ain = { p_ouest: 4.7, p_sud: 45.6, p_est: 6.2, p_nord: 46.6 };
    const dansAin = await lire({ p_jeu: 'pollen', ...ain });
    const { data: cps } = await sb.rpc('get_zone_centroids_jsonb', { p_scale: 'cp', ...ain });
    const retenus = new Set(((cps as { zones: { code: string }[] }).zones).map((z) => z.code));
    expect(dansAin.rows.map((l) => l.code_postal))
      .toEqual(tout.rows.filter((l) => retenus.has(l.code_postal)).map((l) => l.code_postal));
    const metro = await lire({ p_jeu: 'pollen', ...METRO });
    expect(metro.rows.length).toBe(tout.rows.filter((l) => !l.code_postal.startsWith('97')).length);
  });

  it('seuil et métrique : filtre sur la colonne demandée', async () => {
    const r = await lire({ p_jeu: 'pollen', p_metrique: 'graminees', p_niveau_min: 2 });
    for (const l of r.rows) expect(Number(l.graminees)).toBeGreaterThanOrEqual(2);
  });

  it('borne : tronque dit vrai', async () => {
    const tout = await lire({ p_jeu: 'pollen' });
    const n = tout.rows.length;
    if (n < 2) return;
    const moins = await lire({ p_jeu: 'pollen', p_limite: n - 1 });
    expect(moins.rows).toHaveLength(n - 1);
    expect(moins.tronque).toBe(true);
    const pile = await lire({ p_jeu: 'pollen', p_limite: n });
    expect(pile.tronque).toBe(false);
  });

  it('jeu ou métrique inconnus : erreur, jamais un nom brut dans le SQL', async () => {
    expect((await sb.rpc('lire_sante_cp_jsonb', { p_jeu: 'pollen_map_daily; drop table x' })).error).not.toBeNull();
    expect((await sb.rpc('lire_sante_cp_jsonb', { p_jeu: 'atmo', p_metrique: 'ambroisie' })).error).not.toBeNull();
  });
});

/**
 * A3 (sql/307) contre la vraie base locale : le cercle d'un « rayon autour d'un point » n'est exact que si le disque
 * est ENTIER en France.
 *
 * - Strasbourg, 20 km : le disque passe le Rhin ; la base pose `part_retenue` = 0,6586 dans la recette ; le cercle est
 *   « calculé » (la perte passe par `paver_cercles`, la méthode des POI) et l'avertissement dit 100 % → 65,9 % ;
 * - Clermont-Ferrand, 5 km : disque entier, `part_retenue` = 1, le cercle reste exact ;
 * - une `part_retenue` envoyée par le client est écrasée par la base ; une réécriture de la forme la recalcule.
 *
 * Un espace `[ESSAI A3]` est créé puis supprimé (ses zones partent en cascade).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';
import { avertissementsDisque, exactitude } from '@/lib/zones/conversion';
import { lireRecette } from '@/lib/zones/recette-schema';
import type { PlateformeGeo } from '@/lib/zones/plateformes';
import type { Recette } from '@/lib/zones/recette';

const sb = creerClientTest();
const LONG = 120_000;

const STRASBOURG = { v: 1, type: 'rayon_point', lon: 7.7521, lat: 48.5734, rayon_m: 20_000 };
const CLERMONT = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 5_000 };

let org = '';
const zones: Record<string, string> = {};

/** La zone comme ③ l'écrit : la forme de `zone_rayon`, puis `creer_zone_recette` avec la recette (sans part). */
async function creer(nom: string, recette: Record<string, unknown>): Promise<string> {
  const { data: rayon, error: e1 } = await sb.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: recette.rayon_m });
  if (e1) throw new Error(e1.message);
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: org, p_cree_par: null, p_recette: recette,
    p_geometry_geojson: JSON.stringify((rayon as { geometry: unknown }).geometry),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** La recette relue en base, passée par le schéma serveur (celui des routes). */
async function recetteDe(id: string): Promise<Recette> {
  const { data, error } = await sb.from('custom_geo_zones').select('recette').eq('id', id).single();
  if (error || !data) throw new Error(error?.message);
  const lue = lireRecette(data.recette);
  if (!lue.ok) throw new Error(lue.message);
  return lue.recette;
}

/** La ligne Meta / cercle du registre (bornes 1 à 80 km : 20 km y est admis). */
async function meta(): Promise<PlateformeGeo> {
  const { data, error } = await sb.from('plateformes_geo').select('*').eq('plateforme', 'meta').eq('maille', 'cercle').single();
  if (error || !data) throw new Error(error?.message);
  return data as unknown as PlateformeGeo;
}

beforeAll(async () => {
  const o = await sb.from('organizations').insert({ name: '[ESSAI A3] disque hors de France', slug: `essai-a3-${Date.now()}` }).select('id').single();
  if (o.error || !o.data) throw new Error(o.error?.message);
  org = o.data.id as string;
  zones.strasbourg = await creer('Strasbourg 20 km', STRASBOURG);
  zones.clermont = await creer('Clermont-Ferrand 5 km', CLERMONT);
  // Un client qui prétend au disque entier : la base recalcule.
  zones.menteuse = await creer('Strasbourg 20 km (part forcée)', { ...STRASBOURG, part_retenue: 1 });
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await sb.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
}, LONG);

describe('A3 — la part du disque retenue, posée par la base', () => {
  it('Strasbourg 20 km : 0,6586 ; Clermont-Ferrand 5 km : 1', async () => {
    expect((await recetteDe(zones.strasbourg) as { part_retenue?: number }).part_retenue).toBe(0.6586);
    expect((await recetteDe(zones.clermont) as { part_retenue?: number }).part_retenue).toBe(1);
  });

  it('une part envoyée par le client est écrasée', async () => {
    expect((await recetteDe(zones.menteuse) as { part_retenue?: number }).part_retenue).toBe(0.6586);
  });

  it('réécrire la forme la recalcule (le disque de Clermont posé sur la zone forcée → 1)', async () => {
    psql(`update public.custom_geo_zones set geometry = (select geometry from public.custom_geo_zones where id = '${zones.clermont}'),
                 recette = '${JSON.stringify(CLERMONT)}'::jsonb where id = '${zones.menteuse}';`);
    expect((await recetteDe(zones.menteuse) as { part_retenue?: number }).part_retenue).toBe(1);
  });
});

describe('A3 — exactitude et avertissement sur la recette relue', () => {
  it('Strasbourg 20 km : non exact (perte calculée, comme pour les POI), avertissement « hors de France » 100 % → 65,9 %', async () => {
    const r = await recetteDe(zones.strasbourg);
    const l = await meta();
    expect(exactitude(r, 'cercle', l)).toBe('calculee');
    expect(exactitude(r, 'cercle', l, 20_000)).toBe('calculee');
    expect(avertissementsDisque(r, 'cercle')).toEqual([{ code: 'disque_hors_france', limite: 100, valeur: 65.9 }]);
  });

  it('Clermont-Ferrand 5 km : exact, aucun avertissement', async () => {
    const r = await recetteDe(zones.clermont);
    expect(exactitude(r, 'cercle', await meta())).toBe('exacte');
    expect(avertissementsDisque(r, 'cercle')).toEqual([]);
  });

  it('la perte de Strasbourg se calcule par paver_cercles (la méthode des POI), au rayon de la recette', async () => {
    const { data, error } = await sb.rpc('paver_cercles', {
      p_zone_id: zones.strasbourg, p_org_id: org, p_cible: 'ind', p_rayon_m: 20_000, p_seuil: 20,
    });
    if (error) throw new Error(error.message);
    const p = data as { n_cercles: number; couverte: number; manques: number; hors_zone: number; achetee: number; population: number };
    expect(p.n_cercles).toBeGreaterThan(0);
    // Les deux égalités du bilan (Review Focus 1), à l'arrondi à l'entier près de chaque terme rendu par la RPC.
    expect(Math.abs(p.manques + p.couverte - p.population)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.hors_zone + p.couverte - p.achetee)).toBeLessThanOrEqual(1);
  }, LONG);
});

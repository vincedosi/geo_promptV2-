/**
 * B10 — le rayon par défaut d'une zone sans rayon de recette se tire de SA surface (R = √(surface / π) / 3, borné par
 * la plateforme), et le plus petit rayon sous le plafond de cercles est PROPOSÉ quand un pavage est refusé
 * `trop_de_cercles` (dichotomie de six pavages au plus, un à la fois).
 *
 * Ce que ce fichier prouve, contre la base locale :
 *   - `custom_geo_zones.surface_km2` (sql/316, colonne générée) est la surface géodésique de la forme ;
 *   - zone de 20 km² sur Meta : rayon calculé ≈ 0,8 km, ramené au minimum de Meta (1 km, lu dans `plateformes_geo`),
 *     au moins 4 cercles retenus au seuil 20 — à 10 km (l'ancien défaut), un au plus (un disque de 314 km²) ;
 *   - zone de 30 000 km² : le rayon par défaut passe sous le plafond de Meta (200 cercles) ; et partant d'un rayon
 *     refusé (5 km), `paverAvecProposition` propose un rayon sous le plafond, le plus petit au pas de la réglette.
 *
 * Les temps mesurés sont écrits dans la sortie (`console.info`). L'espace de test est supprimé en cascade à la fin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';
import { paverAvecProposition } from '@/lib/zones/conversion-serveur';
import { PAS_RAYON_PROPOSE_M } from '@/lib/zones/rayon-propose';
import type { PlateformeGeo } from '@/lib/zones/plateformes';
import { rayonDefautExplique } from '../../angular/src/app/features/carte/logique/jeu/mailles-url';

const admin = creerClientTest();
const LONG = 240_000;
const DESSIN = { v: 1, type: 'dessin' } as const;

let org = '';
let petite = '';
let vaste = '';
let meta: PlateformeGeo;

interface Pavage { refus?: string; n_cercles: number; plafond?: number; rayon_propose?: { rayon_m: number; n_cercles: number; au_pas: boolean; essais: number } | null }

async function paver(zone: string, rayon: number): Promise<Pavage> {
  const { data, error } = await admin.rpc('paver_cercles', {
    p_zone_id: zone, p_org_id: org, p_cible: 'ind', p_rayon_m: rayon, p_seuil: 20,
    p_pop_min: meta.limites.pop_min_unite, p_max_cercles: meta.limites.max_unites,
  });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Pavage;
}

const surface = (zone: string) => Number(psql(`select surface_km2 from public.custom_geo_zones where id = '${zone}';`));

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI B10] rayon par défaut', slug: `essai-b10-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  org = data.id as string;
  const lu = await admin.from('plateformes_geo').select('*').eq('plateforme', 'meta').eq('maille', 'cercle').single();
  if (lu.error || !lu.data) throw new Error(lu.error?.message ?? 'ligne meta / cercle absente');
  meta = lu.data as unknown as PlateformeGeo;
  // Un carré de √20 km de côté au centre de Lyon (45,76° N : 1° de longitude ≈ 77,7 km).
  petite = psql(`select public.creer_zone_recette('Lyon 20 km² (B10)', '${org}', null, '{"v":1,"type":"dessin"}',
                   ST_AsGeoJSON(ST_MakeEnvelope(4.80, 45.74, 4.8576, 45.7802, 4326)))->>'id';`);
  // Un carré de ≈ 173 km de côté au centre de la France (Berry, Bourbonnais, Nivernais).
  vaste = psql(`select public.creer_zone_recette('Centre 30 000 km² (B10)', '${org}', null, '{"v":1,"type":"dessin"}',
                  ST_AsGeoJSON(ST_MakeEnvelope(1.5, 46.2, 3.781, 47.7576, 4326)))->>'id';`);
  if (!petite || !vaste) throw new Error('zones de test non créées');
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('surface_km2 (sql/316)', () => {
  it('la surface géodésique de la forme, posée par la base', () => {
    expect(surface(petite)).toBeCloseTo(20, 0);
    expect(surface(vaste)).toBeGreaterThan(29_500);
    expect(surface(vaste)).toBeLessThan(30_500);
  });
});

describe('zone de 20 km² sur Meta', () => {
  it('rayon proposé ≈ 0,8 km ramené à 1 km (minimum de Meta), au moins 4 cercles retenus', async () => {
    const d = rayonDefautExplique(meta, DESSIN, surface(petite));
    expect(d.source).toBe('surface');
    expect(d.calcule_m).toBeGreaterThan(780);
    expect(d.calcule_m).toBeLessThan(880);
    expect(d.borne).toBe('rayon_min_m');
    expect(d.rayon_m).toBe(meta.limites.rayon_min_m);
    const t0 = performance.now();
    const r = await paver(petite, d.rayon_m);
    console.info(`[B10] 20 km² à ${d.rayon_m} m : ${r.n_cercles} cercles, ${Math.round(performance.now() - t0)} ms`);
    expect(r.refus).toBeUndefined();
    expect(r.n_cercles).toBeGreaterThanOrEqual(4);
  }, LONG);
  it('le constat, nuancé : à 10 km (l’ancien défaut), un cercle au plus — un seul disque de 314 km² pour 20 km²', async () => {
    // Mesuré le 02/11 : 1 cercle ici (centre de Lyon, assez dense pour que 20 km² fassent 20 % du disque), 0 ailleurs
    // selon la densité et le calage de la grille. Le défaut B10 en retient 12.
    expect((await paver(petite, 10_000)).n_cercles).toBeLessThanOrEqual(1);
  }, LONG);
});

describe('zone de 30 000 km² sur Meta', () => {
  it('le rayon par défaut passe sous le plafond de 200 cercles', async () => {
    const d = rayonDefautExplique(meta, DESSIN, surface(vaste));
    expect(d.source).toBe('surface');
    expect(d.rayon_m).toBeGreaterThan(30_000);
    expect(d.rayon_m).toBeLessThan(35_000);
    const t0 = performance.now();
    const r = await paver(vaste, d.rayon_m);
    console.info(`[B10] 30 000 km² à ${d.rayon_m} m : ${r.n_cercles} cercles, ${Math.round(performance.now() - t0)} ms`);
    expect(r.refus).toBeUndefined();
    expect(r.n_cercles).toBeGreaterThan(0);
    expect(r.n_cercles).toBeLessThanOrEqual(meta.limites.max_unites as number);
  }, LONG);

  it('depuis 5 km (refusé) : le plus petit rayon sous le plafond est proposé, en six pavages au plus', async () => {
    const t0 = performance.now();
    const p = await paverAvecProposition(admin as never, { zoneId: vaste, orgId: org, cible: 'ind', rayon_m: 5_000, seuil: 20 }, meta);
    const ms = Math.round(performance.now() - t0);
    expect(p.error).toBeNull();
    const o = p.data as unknown as Pavage;
    console.info(`[B10] 30 000 km², 5 km refusé (${o.n_cercles} cercles) → proposé ${JSON.stringify(o.rayon_propose)}, ${ms} ms au total`);
    expect(o.refus).toBe('trop_de_cercles');
    expect(o.rayon_propose).toBeTruthy();
    const rp = o.rayon_propose!;
    expect(rp.essais).toBeLessThanOrEqual(6);
    expect(rp.n_cercles).toBeLessThanOrEqual(meta.limites.max_unites as number);
    // Ce que la base rend à ce rayon, et un pas plus bas quand la recherche dit « au pas ».
    expect((await paver(vaste, rp.rayon_m)).refus).toBeUndefined();
    if (rp.au_pas) expect((await paver(vaste, rp.rayon_m - PAS_RAYON_PROPOSE_M)).refus).toBe('trop_de_cercles');
  }, LONG);
});

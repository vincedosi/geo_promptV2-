/**
 * A5 (plan de corrections du découpage des zones, 2026-10-31, lot 1) — le minimum de ménages par carreau appliqué à la
 * CONVERSION dès qu'une cible autre que la population totale est choisie (ARB-4, réponse A de Vincent, 31/10), et les
 * recettes « seuil sur carreaux » anciennes migrées avec un minimum EXPLICITE (sql/310).
 *
 * Constat vérifié le 01/11 AVANT correctif : Lyon, rayon de 3 km, cible « ménages pauvres » → `couverture_geometrie`
 * comptait 618 carreaux, exactement ceux de la population totale ; aucun n'était écarté sous 11 ménages, alors que
 * 1 795 895 carreaux sur 2 324 577 en ont moins (valeurs imputées par l'INSEE). La recette « seuil sur carreaux » sans
 * `min_menages` se recalculait avec 0 (`?? 0`), un défaut implicite différent de celui d'une recette neuve (11).
 *
 * Le minimum est LU dans `reglages_conversion` (clé `min_menages_cible`), jamais supposé : la base locale est partagée,
 * le test ne le modifie pas. Les contrôles indépendants relisent `carreaux_filosofi` (une autre table que celle que lit la
 * RPC) ou `carreau_couverture` par un autre chemin (index par département).
 *
 * Un espace `[ESSAI A5]` est créé puis supprimé ; ses zones partent avec lui.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql, psqlBrut } from './_psql';
import { libelleRecette, type Recette } from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const sb = creerClientTest();
const LONG = 180_000;

interface Couverture {
  n_carreaux: number; population: number; min_menages: number; carreaux_ecartes: { n_carreaux: number; population: number };
  lignes: { code: string; n_carreaux: number; pop_en_zone: number | null; pop_totale: number | null; part: number | null }[];
  reference: { population_france: number }; motif_vide: string | null; refus?: string;
}

let org = '';
let zone = '';
/** Le réglage, tel que la base le porte. */
let MIN = 0;

async function couverture(cible: string, decoupage: string): Promise<Couverture> {
  const { data, error } = await sb.rpc('couverture_geometrie', { p_zone_id: zone, p_org_id: org, p_cible: cible, p_decoupage: decoupage });
  if (error) throw new Error(error.message);
  return data as Couverture;
}

beforeAll(async () => {
  MIN = Number(psql(`select valeur from public.reglages_conversion where cle = 'min_menages_cible';`));
  const o = await sb.from('organizations').insert({ name: '[ESSAI A5] minimum de ménages', slug: `essai-a5-${Date.now()}` }).select('id').single();
  if (o.error || !o.data) throw new Error(o.error?.message);
  org = o.data.id as string;
  // Lyon, rayon de 3 km autour de Bellecour : la recette du brief (« rayon 3 km »), forme posée par la base.
  const z = await sb.rpc('zone_rayon', { p_lon: 4.8357, p_lat: 45.764, p_rayon_m: 3000 });
  if (z.error) throw new Error(z.error.message);
  const g = z.data as { geometry: unknown };
  const ins = await sb.from('custom_geo_zones').insert({
    org_id: org, name: '[ESSAI A5] Lyon 3 km', source_type: 'rayon', geometry: g.geometry,
    recette: { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 3000 },
  }).select('id').single();
  if (ins.error || !ins.data) throw new Error(ins.error?.message);
  zone = ins.data.id as string;
}, LONG);

afterAll(async () => {
  if (org) {
    const { error } = await sb.from('organizations').delete().eq('id', org);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('A5 — le réglage', () => {
  it('le minimum de la conversion est en base (11, secret statistique INSEE), borné 0 à 1 000 entier', () => {
    expect(MIN).toBe(11);
    const r = psqlBrut(`begin; update public.reglages_conversion set valeur = 2.5 where cle = 'min_menages_cible'; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('reglages_conversion_min_menages_borne');
  });

  it('min_menages_de_cible : 0 pour la population totale, le réglage pour toute autre cible', () => {
    expect(Number(psql(`select public.min_menages_de_cible('ind');`))).toBe(0);
    expect(Number(psql(`select public.min_menages_de_cible('men_pauv');`))).toBe(MIN);
  });
});

describe('A5 — rayon 3 km, cible « ménages pauvres » : le nombre de carreaux comptés diffère entre min 0 et min 11', () => {
  it('population totale : minimum 0, aucun carreau écarté ; ménages pauvres : minimum 11, des carreaux écartés, avant ≠ après', async () => {
    const ind = await couverture('ind', 'forme');
    const pauv = await couverture('men_pauv', 'forme');
    expect(ind.min_menages).toBe(0);
    expect(ind.carreaux_ecartes).toEqual({ n_carreaux: 0, population: 0 });
    expect(pauv.min_menages).toBe(MIN);
    expect(pauv.carreaux_ecartes.n_carreaux).toBeGreaterThan(0);
    // Avant (minimum 0) = tous les carreaux de la zone ; après (minimum 11) = ceux qui comptent.
    expect(pauv.n_carreaux + pauv.carreaux_ecartes.n_carreaux).toBe(ind.n_carreaux);
    expect(pauv.n_carreaux).toBeLessThan(ind.n_carreaux);
  }, LONG);

  it('les carreaux comptés sont ceux d’au moins 11 ménages, recomptés dans carreaux_filosofi (une autre table)', async () => {
    const pauv = await couverture('men_pauv', 'forme');
    const [n, p] = psql(`
      with z as materialized (select ST_Subdivide(ST_Transform(geometry, 3857), 256) g from public.custom_geo_zones where id = '${zone}'),
           c as materialized (select distinct on (cf.id) (cf.metadata->>'men')::numeric men, (cf.metadata->>'men_pauv')::numeric v
                                from public.carreaux_filosofi cf
                                join z on cf.geom_3857 && z.g and ST_Intersects(ST_Centroid(cf.geom_3857), z.g)
                               order by cf.id)
      select count(*) filter (where men >= ${MIN}) || '|' || round(coalesce(sum(v) filter (where men >= ${MIN}), 0)) from c;`).split('|').map(Number);
    expect(pauv.n_carreaux).toBe(n);
    expect(Math.abs(pauv.population - p)).toBeLessThanOrEqual(1);
  }, LONG);

  it('par CP : numérateur et dénominateur comptent les mêmes carreaux — part ≤ 100 %, dénominateur recompté à part', async () => {
    const pauv = await couverture('men_pauv', 'cp');
    expect(pauv.min_menages).toBe(MIN);
    expect(pauv.lignes.length).toBeGreaterThan(0);
    for (const l of pauv.lignes) expect(l.part ?? 0).toBeLessThanOrEqual(100);
    // Le plus gros CP : son dénominateur recompté sur carreau_couverture (ses carreaux d'au moins 11 ménages), par le
    // département (index), sans passer par la table de dénominateurs.
    const l = pauv.lignes[0]!;
    const attendu = Number(psql(`select round(coalesce(sum(cc.pops[(select rang_pop from public.cibles_exposition where code = 'men_pauv')]::numeric), 0))
                                   from public.carreau_couverture_e7 cc
                                  where cc.code_departement = '69' and cc.code_postal = '${l.code}'
                                    and cc.pops[(select rang_pop from public.cibles_exposition where code = 'men')] >= ${MIN};`));
    expect(Math.abs((l.pop_totale ?? 0) - attendu)).toBeLessThanOrEqual(1);
    // Sans minimum (population totale), la même zone garde le dénominateur de toujours.
    const ind = await couverture('ind', 'cp');
    const tot = Number(psql(`select round((populations->>'ind')::numeric) from public.cp_population_totale_e7 where code_postal = '${l.code}';`));
    expect(ind.lignes.find((x) => x.code === l.code)?.pop_totale).toBe(tot);
  }, LONG);

  it('la France de la cible (phrase de référence) compte les mêmes carreaux que le chiffre', async () => {
    const pauv = await couverture('men_pauv', 'forme');
    const attendu = Number(psql(`select round(sum((populations->>'men_pauv')::numeric)) from public.denominateur_menages_min_e7 where maille = 'departement';`));
    expect(pauv.reference.population_france).toBe(attendu);
  }, LONG);

  it('les cercles (paver_cercles) appliquent la même règle : même minimum, mêmes carreaux comptés', async () => {
    const forme = await couverture('men_pauv', 'forme');
    const { data, error } = await sb.rpc('paver_cercles', { p_zone_id: zone, p_org_id: org, p_cible: 'men_pauv', p_rayon_m: 1000, p_seuil: 20 });
    if (error) throw new Error(error.message);
    const c = data as { n_carreaux: number; min_menages: number; carreaux_ecartes: { n_carreaux: number }; population: number };
    expect(c.min_menages).toBe(MIN);
    expect(c.n_carreaux).toBe(forme.n_carreaux);
    expect(c.carreaux_ecartes.n_carreaux).toBe(forme.carreaux_ecartes.n_carreaux);
    expect(c.population).toBe(forme.population);
  }, LONG);

  it('la zone pays aussi : chiffres de la jumelle filtrée, carreaux écartés dits', async () => {
    const { data, error } = await sb.rpc('couverture_pays_jsonb', { p_code: 'METRO', p_cible: 'men_pauv', p_decoupage: 'forme' });
    if (error) throw new Error(error.message);
    const r = data as Couverture;
    expect(r.min_menages).toBe(MIN);
    expect(r.carreaux_ecartes.n_carreaux).toBeGreaterThan(0);
    const { data: d2, error: e2 } = await sb.rpc('couverture_pays_jsonb', { p_code: 'METRO', p_cible: 'ind', p_decoupage: 'forme' });
    if (e2) throw new Error(e2.message);
    const t = d2 as Couverture;
    expect(t.min_menages).toBe(0);
    expect(r.n_carreaux + r.carreaux_ecartes.n_carreaux).toBe(t.n_carreaux);
  }, LONG);
});

describe('A5 — le dénominateur filtré et le cache', () => {
  it('denominateur_menages_min est utilisable et compte, pour le Rhône, ses carreaux d’au moins 11 ménages', () => {
    expect(psql(`select coalesce(public.denominateur_menages_motif('cp'), 'ok');`)).toBe('ok');
    const [a, b] = psql(`select (select n_carreaux from public.denominateur_menages_min_e7 where maille = 'departement' and code = '69')
                         || '|' || (select count(*) from public.carreau_couverture_e7
                                     where code_departement = '69'
                                       and pops[(select rang_pop from public.cibles_exposition where code = 'men')] >= ${MIN});`).split('|').map(Number);
    expect(a).toBe(b);
  });

  it('un chiffrage en cache à un autre minimum n’est plus servi', async () => {
    const { data, error } = await sb.rpc('couverture_zone', { p_zone_id: zone, p_org_id: org, p_cible: 'men_pauv', p_decoupage: 'cp' });
    if (error) throw new Error(error.message);
    expect((data as Couverture).min_menages).toBe(MIN);
    const servi = () => psql(`select public.couverture_zone_en_cache('${zone}', '${org}', 'men_pauv', 'cp') is not null;`);
    expect(servi()).toBe('t');
    psql(`update public.couverture_zone_cache set resultat = resultat || '{"min_menages": 0}'::jsonb
           where zone_id = '${zone}' and cible = 'men_pauv' and decoupage = 'cp';`);
    expect(servi()).toBe('f');
    psql(`update public.couverture_zone_cache set resultat = resultat - 'min_menages'
           where zone_id = '${zone}' and cible = 'men_pauv' and decoupage = 'cp';`);
    expect(servi()).toBe('f');
  }, LONG);
});

describe('A5 — recettes « seuil sur carreaux » : un minimum explicite, plus de défaut implicite', () => {
  it('migration : aucune recette seuil_carreaux sans min_menages en base', () => {
    expect(Number(psql(`select count(*) from public.custom_geo_zones
                         where recette->>'type' = 'seuil_carreaux' and not (recette ? 'min_menages');`))).toBe(0);
  });

  it('la base refuse une recette seuil_carreaux sans min_menages ; une recette migrée (0) s’écrit et s’affiche « minimum de ménages : 0 »', async () => {
    const sans = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '69' } };
    const forme = { type: 'MultiPolygon', coordinates: [[[[4.8, 45.7], [4.9, 45.7], [4.9, 45.8], [4.8, 45.7]]]] };
    const refus = await sb.from('custom_geo_zones').insert({ org_id: org, name: '[ESSAI A5] sans minimum', source_type: 'seuil', geometry: forme, recette: sans });
    expect(refus.error?.code).toBe('23514');
    expect(refus.error?.message).toContain('custom_geo_zones_seuil_carreaux_min_menages');
    // La recette telle que la migration la laisse : `min_menages = 0` écrit.
    const migree = await sb.from('custom_geo_zones')
      .insert({ org_id: org, name: '[ESSAI A5] migrée', source_type: 'seuil', geometry: forme, recette: { ...sans, min_menages: 0 } })
      .select('recette').single();
    if (migree.error || !migree.data) throw new Error(migree.error?.message);
    const lue = lireRecette(migree.data.recette);
    expect(lue.ok).toBe(true);
    expect(libelleRecette((lue as { recette: Recette }).recette)).toBe('Carreaux où part des ménages pauvres ≥ 40 % · minimum de ménages : 0');
    // Le schéma refuse aussi une recette sans valeur : aucun chemin ne la rejoue avec un défaut caché.
    expect(lireRecette(sans).ok).toBe(false);
  }, LONG);
});

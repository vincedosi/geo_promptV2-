/**
 * `paver_cercles` (sql/276, lot 5, T4) — une zone pavée en cercles (grille HEXAGONALE, A-8), cellules retenues au
 * seuil, perte EXACTE sur l'union des cercles retenus : la maille « cercle » de Meta et de DV360.
 *
 * Ce que ce fichier prouve :
 *   - `cellule_hex` seule : tout point est à ≤ `pas` du centre de sa cellule, et jamais plus près d'un centre voisin ;
 *   - CIRFA Bretagne (≈ 5 000 km², copiée dans un espace de test) à 5 km, seuil 20 : moins de 141 cercles (la grille
 *     carrée du prototype M5), taux d'utile ≥ 85 % ; `couverte + manques = population`, `couverte + hors_zone = achetee` ;
 *   - tout carreau de la zone dont la cellule est retenue est à ≤ r (distance géodésique) du centre de son cercle ;
 *   - `p_pop_min` retire les cercles sous le seuil d'habitants (population du DISQUE, A6), et seulement eux ;
 *   - refus : `trop_de_cercles` (avec le nombre), `trop_de_candidates`, `zone_introuvable` (autre espace),
 *     `cible_inconnue`, `zone_trop_vaste` motif `rayon` (borne de coût : > 240 000 km² d'enveloppes de disques relues, A6) ; rayon hors
 *     [1 000, 200 000] → 22023 (borne de SÉCURITÉ, la règle de plateforme vient de `plateformes_geo`) ;
 *   - `motif_vide` : `territoire_non_carroye` (Guadeloupe), `aucun_carreau` (en mer), `aucune_cellule_au_seuil`.
 *
 * L'espace de test (et la copie de la zone) est supprimé en cascade en fin de fichier.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 180_000;
/** « CIRFA BRETAGNE », 4 999 km², la zone de la mesure M5 du plan. */
const CIRFA = 'f001b479-b870-4958-978d-e7a98b90de57';

interface Cercle { lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }
interface Resultat {
  refus?: string; motif?: string; n_cercles: number; plafond?: number; n_candidates: number; cercles: Cercle[];
  n_carreaux: number; motif_vide: string | null; territoires_non_carroyes: { code: string; nom: string }[];
  population: number; couverte: number; manques: number; hors_zone: number; achetee: number; taux_utile: number | null;
  reference: { grilles: { territoire: string; pas_3857: number }[] };
  /** B13 (sql/318) : les cellules au seuil écartées par le seul `p_pop_min`, et le plus peuplé de leurs disques. */
  ecartes_pop_min: { n_cercles: number; population_max: number | null };
}

let org = '';
let zone = '';
const zones: Record<string, string> = {};

async function paver(params: Record<string, unknown>, zoneId = zone): Promise<Resultat> {
  const { data, error } = await admin.rpc('paver_cercles', {
    p_zone_id: zoneId, p_org_id: org, p_cible: 'ind', p_rayon_m: 5000, p_seuil: 20, ...params,
  });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Resultat;
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI lot5 T4] paver cercles', slug: `essai-lot5-t4-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  org = data.id as string;
  zone = psql(`select public.creer_zone_recette('CIRFA (copie)', '${org}', null, '{"v":1,"type":"dessin"}',
                 ST_AsGeoJSON(geometry, 15))->>'id' from public.custom_geo_zones where id = '${CIRFA}';`);
  if (!zone) throw new Error(`zone CIRFA ${CIRFA} absente de la base`);
  zones.guadeloupe = psql(`select public.creer_zone_recette('Guadeloupe', '${org}', null, '{"v":1,"type":"dessin"}',
                             ST_AsGeoJSON(r.g))->>'id'
                             from public.resoudre_perimetre('departement', '971', null, 100000, array['departement']) r;`);
  // Un carré de 10 km dans le golfe de Gascogne : aucun carreau, aucun département.
  zones.mer = psql(`select public.creer_zone_recette('En mer', '${org}', null, '{"v":1,"type":"dessin"}',
                      ST_AsGeoJSON(ST_MakeEnvelope(-6.0, 45.0, -5.87, 45.09, 4326)))->>'id';`);
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe("cellule_hex / centre_hex — la cellule hexagonale d'un point", () => {
  it("tout point est à ≤ pas du centre de sa cellule, et aucun centre voisin n'est plus proche", () => {
    const r = psql(`with p as (select (random() - 0.5) * 2e6 as x, (random() - 0.5) * 2e6 + 6e6 as y,
                                      1000 + random() * 50000 as pas from generate_series(1, 20000)),
                         c as (select p.*, h.q, h.r, ((p.x - k.cx) ^ 2 + (p.y - k.cy) ^ 2) as d2
                                 from p cross join lateral public.cellule_hex(p.x, p.y, p.pas) h
                                 cross join lateral public.centre_hex(h.q, h.r, p.pas) k)
                    select max(sqrt(d2) / pas)::numeric(6, 4) || '|' ||
                           count(*) filter (where exists (
                             select 1 from (values (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)) v(dq, dr)
                              cross join lateral public.centre_hex(q + v.dq, r + v.dr, pas) n
                              where (x - n.cx) ^ 2 + (y - n.cy) ^ 2 < d2 - 1e-6))
                      from c;`);
    const [rapportMax, plusProches] = r.split('|').map(Number);
    expect(rapportMax).toBeLessThanOrEqual(1);
    expect(plusProches).toBe(0);
    expect(psql(`select row(h.*)::text from public.cellule_hex(0, 0, 1000) h;`)).toBe('(0,0)');
    expect(psql(`select row(h.*)::text from public.cellule_hex(1800, 100, 1000) h;`)).toBe('(1,0)');
    expect(psql(`select round(k.cx::numeric, 3) || ',' || k.cy from public.centre_hex(1, 0, 1000) k;`)).toBe('1732.051,0');
  });
});

describe('paver_cercles — CIRFA Bretagne (≈ 5 000 km², M5)', () => {
  it('5 km, seuil 20 : < 141 cercles, taux d\'utile ≥ 85 %, invariants de la perte', async () => {
    const r = await paver({});
    expect(r.refus).toBeUndefined();
    expect(r.n_cercles).toBe(r.cercles.length);
    expect(r.n_cercles).toBeGreaterThan(0);
    expect(r.n_cercles).toBeLessThan(141);
    expect(r.taux_utile!).toBeGreaterThanOrEqual(85);
    expect(Math.abs(r.couverte + r.manques - r.population)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.couverte + r.hors_zone - r.achetee)).toBeLessThanOrEqual(1);
    for (const c of r.cercles) {
      expect(c.part).toBeGreaterThanOrEqual(20);
      expect(c.part).toBeLessThanOrEqual(100);
      expect(c.pop_en_zone).toBeLessThanOrEqual(c.pop_totale);
    }
  }, LONG);

  it('tout carreau de la zone dont la cellule est retenue est à ≤ r du centre de son cercle', async () => {
    const r = await paver({});
    const pas = r.reference.grilles.find((g) => g.territoire === 'metropole')!.pas_3857;
    const centres = r.cercles.map((c) => `(${c.lon}, ${c.lat})`).join(',');
    const sortie = psql(`with c as (select h.q, h.r, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography as centre
                                      from (values ${centres}) v(lon, lat)
                                      cross join lateral (select ST_Transform(ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), 3857) as p) t
                                      cross join lateral public.cellule_hex(ST_X(t.p), ST_Y(t.p), ${pas}) h),
                              z as (select cc.centroide_3857
                                      from public.custom_geo_zones g
                                      cross join lateral public.carreaux_de_forme(g.geometry, 1) f
                                      join public.carreau_couverture cc using (carreau_id)
                                     where g.id = '${zone}')
                         select count(*) || '|' || coalesce(max(ST_Distance(ST_Transform(z.centroide_3857, 4326)::geography, c.centre)), 0)
                           from z
                           cross join lateral public.cellule_hex(ST_X(z.centroide_3857), ST_Y(z.centroide_3857), ${pas}) h
                           join c on c.q = h.q and c.r = h.r;`);
    const [n, distanceMax] = sortie.split('|').map(Number);
    expect(n).toBeGreaterThan(1000);
    expect(distanceMax).toBeLessThanOrEqual(5000);
  }, LONG);

  // A6 (sql/311) : la population d'un cercle est celle de son DISQUE (1,21 fois l'hexagone, voisins compris) — aucun
  // disque de la CIRFA n'a moins de 1 000 habitants (le plus petit : 1 367 le 01/11) ; 3 000 en retire quelques-uns.
  it('p_pop_min = 3 000 retire les cercles sous 3 000 habitants (population du disque), et seulement eux', async () => {
    const base = await paver({});
    const r = await paver({ p_pop_min: 3000 });
    expect(r.cercles.every((c) => c.pop_totale >= 3000)).toBe(true);
    expect(r.n_cercles).toBe(base.cercles.filter((c) => c.pop_totale >= 3000).length);
    expect(r.n_cercles).toBeLessThan(base.n_cercles);
    // B13 (règle 5) : ce que le minimum écarte est rendu — avant (base) = après + écartés ; le plus peuplé des écartés.
    const sous = base.cercles.filter((c) => c.pop_totale < 3000);
    expect(r.ecartes_pop_min).toEqual({ n_cercles: sous.length, population_max: Math.max(...sous.map((c) => c.pop_totale)) });
    expect(base.ecartes_pop_min).toEqual({ n_cercles: 0, population_max: null });
  }, LONG);

  it('p_max_cercles = 10 → trop_de_cercles, avec le nombre de cercles et le plafond', async () => {
    const base = await paver({});
    const r = await paver({ p_max_cercles: 10 });
    expect(r).toEqual({ refus: 'trop_de_cercles', n_cercles: base.n_cercles, plafond: 10 });
  }, LONG);

  it('p_max_candidates = 10 → trop_de_candidates', async () => {
    const r = await paver({ p_max_candidates: 10 });
    expect(r.refus).toBe('trop_de_candidates');
  }, LONG);
});

describe('paver_cercles — refus et bornes', () => {
  it('borne de coût : 80 km passe sur la CIRFA, 200 km balaierait > 240 000 km² (enveloppes de disques, A6) → zone_trop_vaste motif rayon', async () => {
    const r80 = await paver({ p_rayon_m: 80000 });
    expect(r80.refus).toBeUndefined();
    expect(r80.n_cercles).toBeGreaterThan(0);
    expect(await paver({ p_rayon_m: 200000 })).toEqual({
      refus: 'zone_trop_vaste', motif: 'rayon', n_candidates_max: 1, plafond_balaye_km2: 240000,
    });
  }, LONG);

  it('motif_vide : territoire non carroyé, aucun carreau, aucune cellule au seuil', async () => {
    const gp = await paver({}, zones.guadeloupe);
    expect(gp).toMatchObject({ n_carreaux: 0, n_cercles: 0, cercles: [], motif_vide: 'territoire_non_carroye' });
    expect(gp.territoires_non_carroyes).toEqual([{ code: '971', nom: 'Guadeloupe' }]);
    expect(await paver({}, zones.mer)).toMatchObject({ n_carreaux: 0, motif_vide: 'aucun_carreau', territoires_non_carroyes: [] });
    const seuil = await paver({ p_pop_min: 100_000_000 });
    expect(seuil).toMatchObject({ n_cercles: 0, motif_vide: 'aucune_cellule_au_seuil', couverte: 0, achetee: 0 });
    expect(seuil.manques).toBe(seuil.population);
    expect((await paver({})).motif_vide).toBeNull();
  }, LONG);

  it('rayon hors [1 000, 200 000] → 22023', async () => {
    for (const rayon of [500, 200001]) {
      const { error } = await admin.rpc('paver_cercles', {
        p_zone_id: zone, p_org_id: org, p_cible: 'ind', p_rayon_m: rayon, p_seuil: 20,
      });
      expect(error?.code, String(rayon)).toBe('22023');
    }
  });

  it('zone d\'un autre espace → zone_introuvable ; cible absente du catalogue → cible_inconnue', async () => {
    const { data, error } = await admin.rpc('paver_cercles', {
      p_zone_id: CIRFA, p_org_id: org, p_cible: 'ind', p_rayon_m: 5000, p_seuil: 20,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ refus: 'zone_introuvable' });
    expect(await paver({ p_cible: 'pas_une_cible' })).toEqual({ refus: 'cible_inconnue' });
  });
});

/**
 * A4 (plan de corrections du découpage des zones, 2026-10-31, lot 1) — l'unité à population totale INCONNUE (un
 * territoire que le carroyage Filosofi 2021 ne couvre pas : Guadeloupe 971, Guyane 973, Mayotte 976), traitée selon
 * ARB-3 (réponse A de Vincent, 31/10) : ACHETABLE, avec la mention « population inconnue », même règle pour le CP, la
 * commune, le département et le pays, et une ligne « diffusion à population inconnue » séparée dans le bilan.
 *
 * LA RÈGLE DE RÉTENTION (`estRetenue`, une fonction pour toutes les mailles). Le seuil de B11 compare une part ; une
 * unité sans population n'en a pas. Ce qui la retient : être dans la zone (`incluse`) — sa part vaut alors ≈ 100 % quelle
 * que soit sa population. Pour la zone nationale, c'est toute unité du territoire de la recette (sql/308) ; pour une
 * zone locale, la part de SA surface dans la zone atteint la tolérance `inclusion_surface_inconnue` de
 * `reglages_conversion` (0,95, `unite_inconnue_dans_zone`, sql/309 — tour 1 de relecture, I-1).
 *
 * Constat vérifié en base le 31/10, AVANT correctif : `couverture_pays_jsonb('FR', 'ind', 'departement')` rendait 98
 * lignes et 0 à population inconnue (les trois départements non carroyés étaient ABSENTS, pas « non retenus ») ; au CP,
 * 6 009 lignes, aucune de 971, 973 ou 976. Le brief annonce 101 lignes dont 3 inconnues : c'est le résultat attendu
 * (96 départements métropolitains + 5 DROM), confirmé par la base — les COM 975, 977, 978 de `ref_departements`, sans
 * région, ne sont pas dans le territoire « France entière » (`zone_pays_geometrie` unit les RÉGIONS).
 *
 * Deux espaces `[ESSAI A4]` sont créés puis supprimés ; zones, jeux et extractions partent avec eux.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { psql, psqlBrut, psqlLignes } from './_psql';
import { appliquerSeuil, estRetenue } from '@/lib/zones/conversion';
import type { LigneCouverture } from '@/lib/zones/couverture';

const sb = creerClientTest();
const LONG = 180_000;
const appelant = vi.hoisted(() => ({ org: '' }));

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAuth: async () => ({ id: '00000000-0000-4000-8000-0000000008a4', role: 'client', organization_id: appelant.org }),
}));
vi.mock('@/lib/api/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit')>()),
  createRateLimiter: () => async () => ({ ok: true, retrySec: 0 }),
  createQuota: () => async () => null,
}));

const extractions = await import('@/app/api/zones/jeux/[id]/extractions/route');

interface Couverture { population: number; lignes: (LigneCouverture & { incluse?: boolean })[]; n_territoires: number; n_inconnues: number }

/** Les trois départements non carroyés du territoire « France entière » (E10), et leurs codes pays. */
const INCONNUS = ['971', '973', '976'];
const PAYS_INCONNUS = ['GP', 'GF', 'YT'];

let org = '';

async function pays(code: 'FR' | 'METRO', decoupage: 'departement' | 'cp'): Promise<Couverture> {
  const { data, error } = await sb.rpc('couverture_pays_jsonb', { p_code: code, p_cible: 'ind', p_decoupage: decoupage });
  if (error) throw new Error(error.message);
  return data as Couverture;
}

const inconnues = (c: Couverture) => c.lignes.filter((l) => l.pop_totale === null);

async function nouvelleOrg(): Promise<string> {
  const { data, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI A4] population inconnue', slug: `essai-a4-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

beforeAll(async () => {
  org = await nouvelleOrg();
  appelant.org = org;
});

afterAll(async () => {
  if (org) {
    // Les jeux d'abord (clé étrangère vers la zone `on delete restrict`) ; leurs extractions partent en cascade.
    const jeux = await sb.from('zone_sets').delete().eq('org_id', org);
    if (jeux.error) throw new Error(`nettoyage des jeux : ${jeux.error.message}`);
    const { error } = await sb.from('organizations').delete().eq('id', org);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('A4 — « France entière » en maille département : 101 lignes, dont 3 à population inconnue', () => {
  it('101 lignes ; 971, 973, 976 sans population ni part, ENTIÈRES dans la zone ; la population de la zone inchangée', async () => {
    const r = await pays('FR', 'departement');
    expect(r.lignes).toHaveLength(101);
    expect(r.n_territoires).toBe(101);
    expect(r.n_inconnues).toBe(3);
    expect(inconnues(r).map((l) => l.code)).toEqual(INCONNUS);
    for (const l of inconnues(r)) {
      expect(l).toMatchObject({ pop_en_zone: null, pop_totale: null, part: null, part_brute: null, n_carreaux: 0, incluse: true });
    }
    // Les 98 lignes chiffrées sont celles d'avant A4 : leur somme est celle des dénominateurs départementaux (arrondis
    // ligne à ligne). Les lignes inconnues n'y ajoutent rien — aucun habitant inventé.
    const connue = r.lignes.filter((l) => l.pop_totale !== null).reduce((t, l) => t + (l.pop_en_zone ?? 0), 0);
    const denominateurs = Number(psql(`select sum((populations->>'ind')::numeric) from public.unite_population_totale where maille = 'departement';`));
    expect(Math.abs(connue - denominateurs)).toBeLessThanOrEqual(98 / 2);
  }, LONG);

  it('ARB-3 : au seuil le plus haut (100 %), les 101 sont retenues — les 3 inconnues par inclusion, pas par le seuil', async () => {
    const r = await pays('FR', 'departement');
    for (const l of inconnues(r)) expect(estRetenue(l, 100)).toBe(true);
    const bilan = appliquerSeuil(r.lignes, r.population, 100);
    expect(bilan).toMatchObject({ n_unites: 101, n_touchees: 101, n_inconnues: 3, hors_zone: 0, taux_utile: 100 });
  }, LONG);

  it('« France métropolitaine » : 96 lignes, aucune inconnue (aucun DROM dans le territoire)', async () => {
    const r = await pays('METRO', 'departement');
    expect(r.lignes).toHaveLength(96);
    expect(r.n_inconnues).toBe(0);
    expect(appliquerSeuil(r.lignes, r.population, 100)).not.toHaveProperty('n_inconnues');
  }, LONG);
});

describe('A4 — même résultat au CP pour ces territoires', () => {
  it('chaque unité CP de 971, 973, 976 (canonique de son groupe) est une ligne inconnue, entière, retenue à 100 %', async () => {
    // Compté À PART, par un autre chemin : les canoniques du référentiel dans ces trois départements.
    const attendu = Number(psql(`select count(*) from public.ref_codes_postaux r
                                  where r.code_dept in ('971', '973', '976')
                                    and not exists (select 1 from public.cp_groupe g
                                                     where g.code_postal = r.code_postal and g.code_canonique <> r.code_postal);`));
    expect(attendu).toBe(65);
    const r = await pays('FR', 'cp');
    const inc = inconnues(r);
    expect(inc).toHaveLength(attendu);
    expect(r.n_inconnues).toBe(attendu);
    expect(new Set(inc.map((l) => l.code.slice(0, 3)))).toEqual(new Set(INCONNUS));
    expect(inc.every((l) => l.incluse === true && l.part_brute === null && Array.isArray(l.membres))).toBe(true);
    // Les membres des groupes développés : 69 codes (33 + 25 + 11 au référentiel).
    expect(inc.reduce((t, l) => t + (l.membres?.length ?? 0), 0)).toBe(69);
    expect(appliquerSeuil(r.lignes, r.population, 100)).toMatchObject({ n_unites: r.lignes.length, n_inconnues: attendu });
  }, LONG);
});

describe('A4 — l’extraction « France entière » : département, CP et pays achètent les mêmes territoires inconnus', () => {
  it('TikTok au département, DV360 au CP (seuil 100 %), Meta au pays : unités retenues, `n_inconnues` figé au bilan', async () => {
    const { data: forme, error: e1 } = await sb.rpc('zone_pays_geometrie', { p_code: 'FR' });
    if (e1) throw new Error(e1.message);
    const { data: z, error: e2 } = await sb.rpc('creer_zone_recette', {
      p_nom: 'France entière (A4)', p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'pays', code: 'FR' },
      p_geometry_geojson: JSON.stringify((forme as { geometry: unknown }).geometry),
    });
    if (e2) throw new Error(e2.message);
    const { data: jeu, error: e3 } = await sb.from('zone_sets').insert({
      org_id: org, nom: 'France entière A4', type: 'zone', custom_geo_zone_id: (z as { id: string }).id, cible: 'ind',
      mode_plan: 'exclusif', brouillon: false, version: 1,
    }).select('id').single();
    if (e3 || !jeu) throw new Error(e3?.message);
    const choix = await sb.from('zone_set_plateformes').insert([
      { zone_set_id: jeu.id, plateforme: 'tiktok', maille: 'departement', seuil: 100, rayon_m: null },
      { zone_set_id: jeu.id, plateforme: 'dv360', maille: 'cp', seuil: 100, rayon_m: null },
      { zone_set_id: jeu.id, plateforme: 'meta', maille: 'pays', seuil: 0, rayon_m: null },
    ]);
    if (choix.error) throw new Error(choix.error.message);

    const rep = await extractions.POST(
      new NextRequest(`http://localhost/api/zones/jeux/${jeu.id}/extractions`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { params: Promise.resolve({ id: jeu.id as string }) },
    );
    expect(rep.status).toBe(201);
    const { id: x } = await rep.json() as { id: string };

    const { data: e, error: e4 } = await sb.from('zone_set_extractions').select('plateformes').eq('id', x).single();
    if (e4) throw new Error(e4.message);
    const bilans = Object.fromEntries((e!.plateformes as { plateforme: string; n_inconnues?: number; n_unites: number }[])
      .map((p) => [p.plateforme, p]));
    expect(bilans.tiktok).toMatchObject({ n_unites: 101, n_inconnues: 3 });
    expect(bilans.dv360.n_inconnues).toBe(65);
    expect(bilans.meta).toMatchObject({ n_unites: 6, n_inconnues: 3 });

    const { data: u, error: e5 } = await sb.from('zone_set_extraction_unites')
      .select('plateforme, code, pop_en_zone, retenu').eq('extraction_id', x).in('plateforme', ['tiktok', 'meta']);
    if (e5) throw new Error(e5.message);
    const sansPop = (p: string) => u!.filter((l) => l.plateforme === p && l.pop_en_zone === null);
    expect(sansPop('tiktok').map((l) => l.code).sort()).toEqual(INCONNUS);
    expect(sansPop('meta').map((l) => l.code).sort()).toEqual([...PAYS_INCONNUS].sort());
    expect([...sansPop('tiktok'), ...sansPop('meta')].every((l) => l.retenu)).toBe(true);

    // Au CP : les 69 codes des trois départements partent au plan, retenus, population inconnue (null, jamais 0).
    const { data: cp, error: e6 } = await sb.from('zone_set_extraction_cp')
      .select('code_postal, retenu, pop_totale').eq('extraction_id', x).or('code_postal.like.971*,code_postal.like.973*,code_postal.like.976*');
    if (e6) throw new Error(e6.message);
    expect(cp).toHaveLength(69);
    expect(cp!.every((l) => l.retenu && l.pop_totale === null)).toBe(true);
  }, LONG);
});

describe('A4 — une zone LOCALE sur un territoire non carroyé : retenue si la part de sa surface atteint la tolérance', () => {
  it('Pointe-à-Pitre et 300 m autour, à la commune : 97120 entière → retenue ; ses voisines touchées → non retenues', async () => {
    const geo = psql(`select ST_AsGeoJSON(ST_Buffer(geom::geography, 300)::geometry) from public.ref_communes where code_commune = '97120';`);
    const { data: z, error } = await sb.rpc('creer_zone_recette', {
      p_nom: 'Pointe-à-Pitre + 300 m (A4)', p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' }, p_geometry_geojson: geo,
    });
    if (error) throw new Error(error.message);
    const lire = async (decoupage: string) => {
      const r = await sb.rpc('couverture_geometrie', { p_zone_id: (z as { id: string }).id, p_org_id: org, p_decoupage: decoupage });
      if (r.error) throw new Error(r.error.message);
      return r.data as Couverture & { motif_vide: string | null };
    };
    const communes = await lire('commune');
    expect(communes.motif_vide).toBe('territoire_non_carroye');
    expect(communes.lignes.map((l) => [l.code, l.incluse])).toEqual([['97101', false], ['97103', false], ['97113', false], ['97120', true]]);
    expect(appliquerSeuil(communes.lignes, communes.population, 0)).toMatchObject({ n_unites: 1, n_touchees: 4, n_inconnues: 1 });
    // Au département, la Guadeloupe n'est que touchée : rien n'est retenu, quel que soit le seuil.
    const dep = await lire('departement');
    expect(dep.lignes.map((l) => [l.code, l.incluse])).toEqual([['971', false]]);
    expect(appliquerSeuil(dep.lignes, dep.population, 0).n_unites).toBe(0);
    // Au CP, 97110 (Pointe-à-Pitre) est entier dans la zone, ses voisins non ; 97142 n'est pas une ligne : membre du
    // groupe de 97139 (même contour, A2), il part avec lui. Quatre unités touchées, cinq codes.
    const cp = await lire('cp');
    expect(cp.lignes.map((l) => [l.code, l.incluse, l.membres])).toEqual([
      ['97110', true, ['97110']], ['97122', false, ['97122']], ['97139', false, ['97139', '97142']], ['97190', false, ['97190']],
    ]);
    expect(cp.n_inconnues).toBe(4);
    expect(cp.lignes.find((l) => l.code === '97110')?.part_surface).toBe(1);
  }, LONG);

  // Tour 1 (I-1) : zone = contour du département. Résultat VÉRIFIÉ EN BASE le 31/10 à la tolérance 0,95 : le département
  // est retenu sur les trois territoires, mais pas toutes ses communes ni tous ses CP — les contours du référentiel ne
  // viennent pas de la même source (Terre-de-Haut : 34 % de sa surface dans le contour de 971). À l'inclusion stricte
  // (sql/308), c'était 1/32, 3/22, 2/17 communes et 1/32, 3/22, 0/11 unités CP.
  it.each([
    ['971', [18, 32], [18, 32]],
    ['973', [21, 22], [21, 22]],
    ['976', [8, 17], [6, 11]],
  ])('zone = département %s : département retenu ; communes et CP retenus à la tolérance (comptes de la base)', async (dep, communes, cps) => {
    const geo = psql(`select ST_AsGeoJSON(ST_Multi(coalesce(geom_perimetre, geom))) from public.ref_departements where code_dept = '${dep}';`);
    const { data: z, error } = await sb.rpc('creer_zone_recette', {
      p_nom: `Département ${dep} (A4)`, p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' }, p_geometry_geojson: geo,
    });
    if (error) throw new Error(error.message);
    const compter = async (decoupage: string) => {
      const r = await sb.rpc('couverture_geometrie', { p_zone_id: (z as { id: string }).id, p_org_id: org, p_decoupage: decoupage });
      if (r.error) throw new Error(r.error.message);
      const c = r.data as Couverture & { tolerance_inclusion: number };
      expect(c.tolerance_inclusion).toBe(0.95);
      return [appliquerSeuil(c.lignes, c.population, 100).n_unites, c.lignes.length];
    };
    expect(await compter('departement')).toEqual([1, 1]);
    expect(await compter('commune')).toEqual(communes);
    expect(await compter('cp')).toEqual(cps);
  }, LONG);
});

describe('A4 — sql/308 et sql/309 : réglage, cache et rejeu', () => {
  const ORG = '00000000-0000-0000-0000-000000000001';
  const ZONE = 'a4a4a4a4-0000-4000-8000-000000000308';

  it('une ligne de cache département sans `n_inconnues` (d’avant sql/308) : NULL ; avec : servie (transaction annulée)', () => {
    const ecrire = (cles: string) => `
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      select g.id, 'ind', 'departement', g.updated_at, (select max(b.construit_le) from public.carreau_couverture_bandes b),
             -- A5 (sql/310) : un chiffrage porte aussi le minimum de ménages de sa cible (0 pour \`ind\`), sinon il n'est plus servi.
             jsonb_build_object('lignes', jsonb_build_array('{"code":"13","part":100,"part_brute":100}'::jsonb), 'min_menages', 0${cles}), now()
        from public.custom_geo_zones g where g.id = '${ZONE}'
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj, base_construite_le = excluded.base_construite_le, resultat = excluded.resultat;`;
    const servi = `(public.couverture_zone_en_cache('${ZONE}', '${ORG}', 'ind', 'departement') is not null)::text`;
    expect(psql(`select (public.carreau_couverture_complete() is null)::text;`)).toBe('true');
    const r = psql(`begin;
      insert into public.custom_geo_zones (id, name, org_id, source_type, geometry)
      select '${ZONE}', '[ESSAI A4] Bouches-du-Rhône', '${ORG}', 'test', ST_Multi(coalesce(d.geom_perimetre, d.geom))
        from public.ref_departements d where d.code_dept = '13';
      ${ecrire('')}
      create temp table a4_r on commit drop as select ${servi} as sans_cle;
      ${ecrire(", 'n_inconnues', 0")}
      select (select sans_cle from a4_r) || '|' || ${servi};
      rollback;`);
    expect(r).toBe('false|true');
  }, LONG);

  it('la tolérance est LUE en base : un réglage changé change la rétention ; absent → exception (transaction annulée)', () => {
    const juger = `select (public.unite_inconnue_dans_zone(z.g, c.geom)->>'incluse') || ':' || (public.unite_inconnue_dans_zone(z.g, c.geom)->>'part_surface')
                     from public.ref_communes c, (select coalesce(geom_perimetre, geom) g from public.ref_departements where code_dept = '971') z
                    where c.code_commune = '97131';`;
    expect(psql(`select valeur::text from public.reglages_conversion where cle = 'inclusion_surface_inconnue';`)).toBe('0.95');
    const r = psqlLignes(`begin;
      ${juger}
      update public.reglages_conversion set valeur = 0.3 where cle = 'inclusion_surface_inconnue';
      ${juger}
      rollback;`);
    expect(r.slice(-2)).toEqual(['false:0.340', 'true:0.340']);
    const absent = psqlBrut(`begin; delete from public.reglages_conversion; select public.reglage_conversion('inclusion_surface_inconnue'); rollback;`);
    expect(absent.status).not.toBe(0);
    expect(absent.stderr).toContain('reglage de conversion absent');
  }, LONG);

  it('cache : une zone locale à lignes inconnues jugées à une autre tolérance n’est plus servie (transaction annulée)', () => {
    const ecrire = (tolerance: string) => `
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      select g.id, 'ind', 'commune', g.updated_at, (select max(b.construit_le) from public.carreau_couverture_bandes b),
             jsonb_build_object('lignes', jsonb_build_array('{"code":"97120","part":null,"part_brute":null,"incluse":true}'::jsonb),
                                'n_inconnues', 1, 'min_menages', 0${tolerance}), now()
        from public.custom_geo_zones g where g.id = '${ZONE}'
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj, base_construite_le = excluded.base_construite_le, resultat = excluded.resultat;`;
    const servi = `(public.couverture_zone_en_cache('${ZONE}', '${ORG}', 'ind', 'commune') is not null)::text`;
    const r = psqlLignes(`begin;
      insert into public.custom_geo_zones (id, name, org_id, source_type, geometry)
      select '${ZONE}', '[ESSAI A4] Pointe-à-Pitre', '${ORG}', 'test', ST_Multi(c.geom) from public.ref_communes c where c.code_commune = '97120';
      ${ecrire('')}
      select ${servi};
      ${ecrire(", 'tolerance_inclusion', 0.5")}
      select ${servi};
      ${ecrire(", 'tolerance_inclusion', 0.95")}
      select ${servi};
      rollback;`);
    expect(r.slice(-3)).toEqual(['false', 'false', 'true']);
  }, LONG);

  // A5 : sql/310 redéfinit ensuite couverture_geometrie, couverture_pays_jsonb et couverture_zone_en_cache — la chaîne
  // rejouée jusqu'à elle est celle qui doit rendre la base. C18 : sql/323 redéfinit encore couverture_geometrie
  // (arrondi au plus fort reste), puis sql/324 couverture_pays_jsonb — rejouées en dernier ; C21 : sql/326 fait de
  // couverture_pays_jsonb l'enveloppe de couverture_pays_moins_jsonb — rejouée à la fin.
  it('les migrations rejouées deux fois (308, 309, 310, 323, 324 puis 326) : empreinte identique, et identique à la base', () => {
    const MIGRATION = ['308_population_inconnue.sql', '309_inclusion_tolerance.sql', '310_minimum_menages_conversion.sql',
      '323_arrondi_plus_fort_reste.sql', '324_arrondi_plus_fort_reste_pays.sql', '326_zone_pays_moins.sql',
      // C24 : sql/327 porte la dernière définition de `couverture_geometrie` (pop_totale_ind).
      '327_diffusion_population_totale.sql',
      // C24 round 1 : sql/330 redéfinit `couverture_geometrie` et `couverture_zone`.
      '330_minimums_population_totale.sql']
      .map((f) => readFileSync(join(process.cwd(), 'sql', f), 'utf8')).join('\n');
    const EMPREINTE = `select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)
                              || (select string_agg(t::text, ';' order by cle) from public.reglages_conversion t)) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('couverture_geometrie', 'couverture_pays_jsonb', 'couverture_zone_en_cache', 'reglage_conversion',
                          'unite_inconnue_dans_zone');`;
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${EMPREINTE}\n${MIGRATION}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  }, LONG);
});

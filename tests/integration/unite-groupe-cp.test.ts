/**
 * A2 (plan de corrections du découpage des zones, 2026-10-31) — le groupe de CP indiscernables est l'unité de la maille
 * CP (sql/304).
 *
 * Ce que ce fichier prouve, contre la base locale, sans rien y laisser (lectures, ou transactions ANNULÉES) :
 *   - une zone qui couvre Saint-Denis (93200, 93210, 93380 : un contour, sql/228) rend UNE ligne CP, d'identifiant
 *     93200, part unique, qui nomme ses trois membres ; la somme des populations des lignes et du hors-territoire
 *     égale la population de la zone ; les autres découpages ne portent pas `membres` ;
 *   - la couverture nationale par CP (`couverture_pays_jsonb`) porte `membres` sur chaque ligne, les groupes y compris ;
 *   - un chiffrage CP en cache d'avant sql/304 (lignes sans `membres`) n'est plus servi ; avec la clé, il l'est ;
 *   - le registre : `poids_groupe_cp = meme` et « à vérifier » sur les quatre lignes CP, NULL ailleurs ; les CHECK
 *     refusent une valeur ou un paramètre inconnus ; la migration se rejoue à empreinte identique.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMETRES_VERIFIABLES, POIDS_GROUPE_CP } from '@/lib/zones/plateformes';
import { psql, psqlBrut, psqlLignes } from './_psql';

const LONG = 180_000;
const ORG = '00000000-0000-0000-0000-000000000001';
const ZONE = 'a2a2a2a2-0000-4000-8000-000000000304';
const MIGRATION = readFileSync(join(process.cwd(), 'sql', '304_unite_groupe_cp.sql'), 'utf8');
/** sql/308 et sql/309 (A4) redéfinissent les fonctions de couverture : rejouées après 304, la base revient à son état courant. */
// A5 : sql/310 redéfinit à son tour les trois fonctions de couverture — la chaîne rejouée va jusqu'à elle.
// A7 : sql/312 redéfinit `plateformes_geo_parametres_valides` (bornes du polygone admises) ; B13 : sql/318 la redéfinit
// encore (comportements des minimums admis) — rejouée en dernier. C18 : sql/323 redéfinit `couverture_geometrie`
// (arrondi au plus fort reste) et sql/324 `couverture_pays_jsonb` ; C21 : sql/326 en fait l'enveloppe de
// `couverture_pays_moins_jsonb` — rejouées à la fin.
const MIGRATION_A4 = ['308_population_inconnue.sql', '309_inclusion_tolerance.sql', '310_minimum_menages_conversion.sql',
  '312_polygone_sommets_morceaux.sql', '318_minimums_population.sql', '323_arrondi_plus_fort_reste.sql',
  '324_arrondi_plus_fort_reste_pays.sql', '326_zone_pays_moins.sql',
  // C24 : sql/327 redéfinit `couverture_geometrie` ; C29 : sql/329 `plateformes_geo_parametres_valides` — en dernier.
  '327_diffusion_population_totale.sql', '329_categorie_speciale.sql',
  // C24 round 1 : sql/330 redéfinit `couverture_geometrie`, `paver_cercles` et `couverture_zone`.
  '330_minimums_population_totale.sql',
  // C29 round 1 : sql/331 met à jour `plateformes_geo` (borne Meta de catégorie spéciale « à vérifier »).
  '331_categorie_speciale_a_verifier.sql',
  // C25 : sql/332 redéfinit `couverture_geometrie` et `couverture_zone_en_cache` (vue E7, base_couverture_e7_le).
  '332_carreau_couverture_e7.sql',
  // D36 : sql/339 redéfinit `couverture_geometrie` (contours du référentiel) et `couverture_zone_en_cache` — en dernier.
  '339_contours_drom_referentiel.sql']
  .map((f) => readFileSync(join(process.cwd(), 'sql', f), 'utf8')).join('\n');

/** Une zone temporaire au contour de Saint-Denis (celui des trois codes), dans la transaction de l'appelant. */
const ZONE_SAINT_DENIS = `
  insert into public.custom_geo_zones (id, name, org_id, source_type, geometry)
  select '${ZONE}', '[ESSAI A2] Saint-Denis', '${ORG}', 'test', ST_Multi(r.geom)
    from public.ref_codes_postaux r where r.code_postal = '93200';`;

describe('couverture_geometrie — une ligne par unité CP, qui nomme ses membres (sql/304)', () => {
  it('Saint-Denis : une ligne 93200, part unique, trois membres ; lignes + hors territoire = population', () => {
    const r = psql(`begin;
      ${ZONE_SAINT_DENIS}
      with j as (select public.couverture_geometrie('${ZONE}', '${ORG}', 'ind', 'cp') j),
           l as (select e from j, jsonb_array_elements(j.j->'lignes') e)
      select (select count(*) from l where l.e->'membres' ? '93210' or l.e->'membres' ? '93380') || '|' ||
             (select l.e->>'code' || ':' || (l.e->>'part') || ':' || (l.e->'membres')::text from l where l.e->>'code' = '93200') || '|' ||
             (select count(*) from l where l.e->>'code' in ('93210', '93380')) || '|' ||
             (select count(*) from l where not l.e ? 'membres') || '|' ||
             (select ((select sum((l.e->>'pop_en_zone')::numeric) from l) + (j.j->'hors_territoire'->>'population')::numeric
                      = (j.j->>'population')::numeric)::text from j);
      rollback;`);
    expect(r).toBe('1|93200:100.0:["93200", "93210", "93380"]|0|0|true');
  }, LONG);

  it('les autres découpages ne portent pas membres', () => {
    const r = psql(`begin;
      ${ZONE_SAINT_DENIS}
      select count(*) filter (where e ? 'membres') || '|' || count(*)
        from jsonb_array_elements(public.couverture_geometrie('${ZONE}', '${ORG}', 'ind', 'commune')->'lignes') e;
      rollback;`);
    expect(r.split('|')[0]).toBe('0');
    expect(Number(r.split('|')[1])).toBeGreaterThan(0);
  }, LONG);
});

describe('couverture_pays_jsonb — membres sur chaque ligne CP (sql/304)', () => {
  it('France entière par CP : toutes les lignes portent membres, 67 groupes, 6 116 codes pour 6 010 unités', () => {
    // A4 (sql/308) : les unités à population inconnue (971, 973, 976) s'ajoutent aux lignes ; elles portent `membres`
    // aussi (premier chiffre, sur TOUTES les lignes), les autres chiffres restent ceux des lignes chiffrées d'A2.
    const r = psql(`
      select count(*) filter (where not e ? 'membres') || '|' ||
             count(*) filter (where jsonb_array_length(e->'membres') > 1 and e->'pop_totale' <> 'null') || '|' ||
             sum(jsonb_array_length(e->'membres')) filter (where e->'pop_totale' <> 'null') || '|' ||
             count(*) filter (where e->'pop_totale' <> 'null') || '|' ||
             count(*) filter (where not (e->'membres') ? (e->>'code'))
        from jsonb_array_elements(public.couverture_pays_jsonb('FR', 'ind', 'cp')->'lignes') e;`);
    // C25 (sql/332) : les carreaux sans contour CP vont au CP le plus proche — 29259 (2 hab.) gagne une population,
    // d'où une unité et un code de plus (6 115 / 6 009 avant).
    expect(r).toBe('0|67|6116|6010|0');
  }, LONG);
});

describe('couverture_zone_en_cache — un chiffrage CP sans membres n’est plus servi (sql/304)', () => {
  it('ligne de cache CP sans la clé : NULL ; avec la clé : servie (transaction annulée)', () => {
    // A4 (sql/308) : un chiffrage CP sans `n_inconnues` n'est plus servi non plus ; les deux écritures le portent, pour
    // que ce test ne regarde que `membres` (le refus sans `n_inconnues` est prouvé dans population-inconnue.test.ts).
    // A5 (sql/310) : de même `min_menages` (0 pour `ind`), prouvé dans minimum-menages-conversion.test.ts.
    const ecrire = (ligne: string) => `
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      select g.id, 'ind', 'cp', g.updated_at, public.base_couverture_e7_le(),  -- C25 (sql/332) : bandes ET lots E7
             jsonb_build_object('lignes', jsonb_build_array('${ligne}'::jsonb), 'n_inconnues', 0, 'min_menages', 0), now()
        from public.custom_geo_zones g where g.id = '${ZONE}'
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj, base_construite_le = excluded.base_construite_le, resultat = excluded.resultat;`;
    const servi = `(public.couverture_zone_en_cache('${ZONE}', '${ORG}', 'ind', 'cp') is not null)::text`;
    expect(psql(`select (public.carreau_couverture_complete() is null)::text;`)).toBe('true');
    const r = psql(`begin;
      ${ZONE_SAINT_DENIS}
      ${ecrire('{"code":"93200","part":100,"part_brute":100}')}
      create temp table a2_r on commit drop as select ${servi} as sans_cle;
      ${ecrire('{"code":"93200","part":100,"part_brute":100,"membres":["93200","93210","93380"]}')}
      select (select sans_cle from a2_r) || '|' || ${servi};
      rollback;`);
    expect(r).toBe('false|true');
  }, LONG);
});

describe('plateformes_geo — poids d’un groupe de CP, « à vérifier » par paramètre (sql/304)', () => {
  it('meme sur les quatre lignes CP, marqué à vérifier ; NULL et liste vide ailleurs', () => {
    expect(psql(`select count(*) from public.plateformes_geo
                  where maille = 'cp' and poids_groupe_cp = 'meme' and parametres_a_verifier @> '{poids_groupe_cp}';`)).toBe('4');
    // A7 (sql/312) : la ligne TTD polygone déclare ses deux bornes « à vérifier » ; B13 (sql/318) : la ligne DV360
    // cercle, le comportement de son minimum par cercle ; C28 (sql/328) : ses cercles par liste et son rayon maximal,
    // non relevés ; C29 round 1 (sql/331) : la borne Meta de catégorie spéciale — les seuls paramètres hors CP.
    expect(psql(`select count(*) from public.plateformes_geo
                  where maille <> 'cp' and (poids_groupe_cp is not null
                    or not parametres_a_verifier <@ '{polygone_sommets_max,polygone_morceaux_max,pop_min_unite_comportement,max_unites,rayon_max_m,rayon_min_categorie_speciale}');`)).toBe('0');
  });

  it('les listes de lib/zones/plateformes.ts sont celles des CHECK de la base', () => {
    const corps = psqlLignes(`select pg_get_functiondef('public.plateformes_geo_parametres_valides'::regproc);`).join(' ');
    for (const p of PARAMETRES_VERIFIABLES) expect(corps).toContain(`'${p}'`);
    expect((corps.match(/'[a-z_]+'/g) ?? []).filter((x) => x !== "'public'").length).toBe(PARAMETRES_VERIFIABLES.length);
    const check = psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'plateformes_geo_poids_groupe_cp_valide';`);
    for (const v of POIDS_GROUPE_CP) expect(check).toContain(`'${v}'`);
  });

  it.each([
    ['valeur inconnue', `poids_groupe_cp = 'moitie'`, 'cp', 'plateformes_geo_poids_groupe_cp_valide'],
    ['poids sur une maille non CP', `poids_groupe_cp = 'meme'`, 'cercle', 'plateformes_geo_poids_groupe_cp_valide'],
    ['paramètre inconnu', `parametres_a_verifier = '{plage_poids}'`, 'cp', 'plateformes_geo_parametres_a_verifier_valides'],
    ['paramètre en double', `parametres_a_verifier = '{max_unites,max_unites}'`, 'cp', 'plateformes_geo_parametres_a_verifier_valides'],
  ])('la base refuse : %s', (_cas, affectation, maille, contrainte) => {
    const r = psqlBrut(`begin; update public.plateformes_geo set ${affectation} where plateforme = 'meta' and maille = '${maille}'; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(contrainte);
  });

  it('la migration rejouée deux fois : registre et fonctions à empreinte identique, et identique à la base', () => {
    const EMPREINTE = `select md5(
      (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
      || (select string_agg(pg_get_functiondef(p.oid), '' order by p.proname) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('couverture_geometrie', 'couverture_pays_jsonb', 'couverture_zone_en_cache',
                               'plateformes_geo_parametres_valides')));`;
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${MIGRATION_A4}\n${EMPREINTE}\n${MIGRATION}\n${MIGRATION_A4}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  }, LONG);
});

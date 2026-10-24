/**
 * sql/277 — les jeux de ZONE à côté des jeux risque (lot 5, T6).
 *
 * Ce que ce fichier verrouille :
 * - la migration se rejoue deux fois à l'identique (base locale partagée) ;
 * - les jeux risque existants n'ont pas bougé : `type = 'risque'`, profil et empreinte de profil présents ;
 * - un jeu de zone porte UNE zone (A-1) et ne se crée pas sans elle ; un jeu risque ne se crée pas sans profil ;
 * - la zone d'un jeu ne se supprime pas (clé étrangère `on delete restrict`, en plus de `zone_referencee`) ;
 * - `zone_set_plateformes` : une plateforme une fois, un couple connu de `plateformes_geo`, un seuil en pourcentage,
 *   un rayon pour le cercle et pour lui seul ;
 * - `creer_extraction_jeu_zone` (A-11) : refus nommés, `forme` copiée, unités numérotées dans l'ordre reçu, empreinte
 *   indépendante de l'ordre (deux appels identiques → `deja_extraite`), unités immuables.
 * Tout ce qui écrit vit dans une transaction ANNULÉE : rien ne reste en base.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { psql, psqlBrut, psqlLignes } from './_psql';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '277_jeux_de_zone.sql'), 'utf8');

/** « CIRFA BRETAGNE », zone de l'espace interne présente dans le dump local. */
const ZONE = 'f001b479-b870-4958-978d-e7a98b90de57';
const ORG = '00000000-0000-0000-0000-000000000001';
/** « Seveso France — test phase 4 », jeu risque du filet T1. */
const JEU_RISQUE = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const JEU = 'aaaaaaaa-0000-4000-8000-000000000277';

/** Colonnes, contraintes, index et déclencheurs des quatre tables, plus le corps de la RPC. */
const EMPREINTE = `select md5(
  (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':'
                     || coalesce(column_default, ''), ';' order by table_name, column_name)
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('zone_sets', 'zone_set_plateformes', 'zone_set_extractions', 'zone_set_extraction_unites'))
  || (select string_agg(conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid), ';'
                        order by conrelid::regclass::text, conname)
        from pg_constraint
       where conrelid in ('public.zone_sets'::regclass, 'public.zone_set_plateformes'::regclass,
                          'public.zone_set_extractions'::regclass, 'public.zone_set_extraction_unites'::regclass))
  || (select string_agg(indexdef, ';' order by indexname) from pg_indexes
       where schemaname = 'public'
         and tablename in ('zone_sets', 'zone_set_plateformes', 'zone_set_extractions', 'zone_set_extraction_unites'))
  || (select string_agg(tgname, ';' order by tgname) from pg_trigger
       where not tgisinternal and tgrelid = 'public.zone_set_extraction_unites'::regclass)
  || (select md5(prosrc) from pg_proc where proname = 'creer_extraction_jeu_zone'));`;

/** Un jeu de zone sur ZONE avec trois choix : DV360 au CP, Meta en cercles de 10 km, TTD au polygone. */
const JEU_DE_ZONE = `
  insert into public.zone_sets (id, nom, org_id, type, custom_geo_zone_id)
  values ('${JEU}', 'T6 — schéma', '${ORG}', 'zone', '${ZONE}');
  insert into public.zone_set_plateformes (zone_set_id, plateforme, maille, seuil, rayon_m) values
    ('${JEU}', 'dv360', 'cp', 20, null), ('${JEU}', 'meta', 'cercle', 30, 10000), ('${JEU}', 'ttd', 'polygone', 0, null);`;

const CP = `'[{"code_postal":"29200","classe":"zone","retenu":true,"multiplicateur":1.2,"pop_en_zone":900,"pop_totale":1000,"part_en_zone":90},
              {"code_postal":"29000","classe":"hors","retenu":false,"multiplicateur":0.8,"pop_en_zone":10,"pop_totale":1000,"part_en_zone":1}]'::jsonb`;
const CERCLES = [
  '{"plateforme":"meta","maille":"cercle","lon":-4.486,"lat":48.39,"rayon_m":10000,"pop_en_zone":500,"pop_totale":800,"part":62.5,"retenu":true}',
  '{"plateforme":"meta","maille":"cercle","lon":-4.1,"lat":48.0,"rayon_m":10000,"pop_en_zone":10,"pop_totale":900,"part":1.1,"retenu":false}',
  '{"plateforme":"ttd","maille":"polygone","pop_en_zone":3000000,"pop_totale":3000000,"part":100,"retenu":true}',
];
const unites = (ordre: string[]) => `'[${ordre.join(',')}]'::jsonb`;
const RESUME = `'{"n_cp":2,"n_retenus":1,"taux_utile":90,"part_plan_en_zone":60,"population_exposee":900,
                  "plateformes":[{"plateforme":"meta","n_unites":2,"n_retenus":1},{"plateforme":"ttd","n_unites":1}]}'::jsonb`;
const extraire = (u: string, cp = CP) => `select public.creer_extraction_jeu_zone('${JEU}', ${cp}, ${u}, ${RESUME});`;

describe('sql/277 — jeux de zone', () => {
  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${EMPREINTE}\n${MIGRATION}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });

  it('les jeux risque existants sont restés risque, profil et empreinte de profil compris', () => {
    expect(psql(`select count(*) from public.zone_sets
                  where type <> 'risque' or profil is null or profil_hash is null;`)).toBe('0');
    expect(psql(`select type from public.zone_sets where id = '${JEU_RISQUE}';`)).toBe('risque');
  });

  it.each([
    ['un jeu de zone sans zone', 'zone_sets_zone_par_type',
     `insert into public.zone_sets (nom, org_id, type) values ('x', '${ORG}', 'zone');`],
    ['un jeu risque sans profil', 'zone_sets_profil_par_type',
     `insert into public.zone_sets (nom, org_id) values ('x', '${ORG}');`],
    ['un type inconnu', 'zone_sets_type_check',
     `insert into public.zone_sets (nom, org_id, type, profil, profil_hash) values ('x', '${ORG}', 'autre', '{}', 'h');`],
    ['une zone inexistante', 'zone_sets_custom_geo_zone_id_fkey',
     `insert into public.zone_sets (nom, org_id, type, custom_geo_zone_id) values ('x', '${ORG}', 'zone', gen_random_uuid());`],
  ])('la base refuse %s (%s)', (_cas, contrainte, insert) => {
    const r = psqlBrut(`begin; ${insert} rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(contrainte);
  });

  it('la zone d’un jeu ne se supprime pas (clé étrangère, on delete restrict)', () => {
    const r = psqlBrut(`begin; ${JEU_DE_ZONE} delete from public.custom_geo_zones where id = '${ZONE}'; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('zone_sets_custom_geo_zone_id_fkey');
  });

  it.each([
    ['une plateforme deux fois', 'zone_set_plateformes_pkey', `('${JEU}', 'dv360', 'cercle', 20, 5000)`],
    ['un couple absent de plateformes_geo', 'zone_set_plateformes_plateforme_maille_fkey',
     `('${JEU}', 'tiktok', 'polygone', 20, null)`],
    ['un seuil hors 0-100', 'zone_set_plateformes_seuil_check', `('${JEU}', 'tiktok', 'commune', 120, null)`],
    ['un cercle sans rayon', 'zsp_rayon_cercle', `('${JEU}', 'ttd', 'cercle', 20, null)`],
    ['un rayon hors cercle', 'zsp_rayon_cercle', `('${JEU}', 'tiktok', 'commune', 20, 5000)`],
  ])('zone_set_plateformes refuse %s (%s)', (_cas, contrainte, valeurs) => {
    const r = psqlBrut(`begin; ${JEU_DE_ZONE}
      delete from public.zone_set_plateformes where zone_set_id = '${JEU}' and plateforme <> 'dv360';
      insert into public.zone_set_plateformes (zone_set_id, plateforme, maille, seuil, rayon_m) values ${valeurs};
      rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(contrainte);
  });

  it('extraction : forme copiée, unités numérotées dans l’ordre reçu, ordre indifférent à l’empreinte', () => {
    const lignes = psqlLignes(`begin; ${JEU_DE_ZONE}
      ${extraire(unites(CERCLES))}
      ${extraire(unites([...CERCLES].reverse()))}
      select count(*) from public.zone_set_extractions where zone_set_id = '${JEU}';
      select ST_Equals(e.forme, z.geometry) from public.zone_set_extractions e, public.custom_geo_zones z
       where e.zone_set_id = '${JEU}' and z.id = '${ZONE}';
      select string_agg(u.plateforme || ':' || u.ordinal || ':' || coalesce(round(ST_X(u.centre)::numeric, 3)::text, '-'),
                        ',' order by u.plateforme, u.ordinal)
        from public.zone_set_extraction_unites u join public.zone_set_extractions e on e.id = u.extraction_id
       where e.zone_set_id = '${JEU}';
      select string_agg(c.code_postal || ':' || c.classe || ':' || c.multiplicateur, ',' order by c.code_postal)
        from public.zone_set_extraction_cp c join public.zone_set_extractions e on e.id = c.extraction_id
       where e.zone_set_id = '${JEU}';
      select e.seuil_couverture_cp || '|' || e.mode_plan || '|' || jsonb_path_query_array(e.plateformes, '$[*].plateforme')
             || '|' || (e.plateformes -> 1 ->> 'n_retenus') || '|' || (e.plateformes -> 1 ->> 'rayon_m')
        from public.zone_set_extractions e where e.zone_set_id = '${JEU}';
      rollback;`);
    const [premiere, seconde, n, forme, unitesLues, cps, entete] = lignes.slice(-7);
    const p = JSON.parse(premiere);
    const s = JSON.parse(seconde);
    expect(p).toMatchObject({ ok: true, deja_extraite: false, version: 1, lignes_ecrites: 2, unites_ecrites: 3 });
    expect(s).toMatchObject({ ok: true, deja_extraite: true, version: 1, id: p.id });
    expect(n).toBe('1');
    expect(forme).toBe('t');
    expect(unitesLues).toBe('meta:1:-4.486,meta:2:-4.100,ttd:1:-');
    expect(cps).toBe('29000:hors:0.800,29200:zone:1.200');
    // Seuil du choix CP, choix lus en base (et non dans le résumé), chiffres du résumé rattachés par plateforme.
    expect(entete).toBe('20|pondere|["dv360", "meta", "ttd"]|1|10000');
  });

  it('extraction : une unité changée → nouvelle version ; une unité ne se modifie pas', () => {
    const changee = CERCLES.map((u, i) => (i === 1 ? u.replace('"retenu":false', '"retenu":true') : u));
    const lignes = psqlLignes(`begin; ${JEU_DE_ZONE}
      ${extraire(unites(CERCLES))}
      ${extraire(unites(changee))}
      rollback;`);
    expect(JSON.parse(lignes.at(-1)!)).toMatchObject({ deja_extraite: false, version: 2 });

    const r = psqlBrut(`begin; ${JEU_DE_ZONE} ${extraire(unites(CERCLES))}
      update public.zone_set_extraction_unites set retenu = false; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('immuable');
  });

  it.each([
    ['jeu_introuvable', `select public.creer_extraction_jeu_zone(gen_random_uuid(), ${CP}, '[]', '{}');`],
    ['type_non_zone', `select public.creer_extraction_jeu_zone('${JEU_RISQUE}', ${CP}, '[]', '{}');`],
    ['plan_vide', `select public.creer_extraction_jeu_zone('${JEU}', '[]', '[]', '{}');`],
    ['plan_vide', `select public.creer_extraction_jeu_zone('${JEU}', null, '{"a":1}', '{}');`],
    ['unites_hors_choix', `select public.creer_extraction_jeu_zone('${JEU}', '[]',
       '[{"plateforme":"tiktok","maille":"commune","code":"29019","pop_en_zone":1,"pop_totale":2,"part":50,"retenu":true}]', '{}');`],
    ['unites_hors_choix', `select public.creer_extraction_jeu_zone('${JEU}', '[]',
       '[{"plateforme":"dv360","maille":"cp","code":"29200","pop_en_zone":1,"pop_totale":2,"part":50,"retenu":true}]', '{}');`],
  ])('extraction refusée : %s', (refus, appel) => {
    const r = JSON.parse(psql(`begin; ${JEU_DE_ZONE} ${appel} rollback;`));
    expect(r).toEqual({ ok: false, error: refus });
  });

  it('extraction : des CP sans choix au CP sont refusés', () => {
    const r = JSON.parse(psql(`begin; ${JEU_DE_ZONE}
      delete from public.zone_set_plateformes where zone_set_id = '${JEU}' and maille = 'cp';
      ${extraire(unites(CERCLES))} rollback;`));
    expect(r).toEqual({ ok: false, error: 'unites_hors_choix' });
  });
});

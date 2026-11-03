/**
 * `plateformes_geo` (sql/274, lot 5, T2) — le registre des mailles achetables, en base.
 *
 * Ce que ce fichier verrouille :
 * - le seed : une ligne par (plateforme, maille) relevée le 14/10, clé unique (T6 y pose une clé étrangère) ;
 * - aucune maille NATIVE sans lien vers sa doc officielle, sauf TTD (doc derrière connexion), alors « à vérifier » :
 *   l'écran promet un lien, il ne doit pas en manquer un en silence ;
 * - la migration se rejoue deux fois à l'identique (base locale partagée : rejouer ne doit rien changer) ;
 * - sql/300 (finitions de ⑤, T1) : la maille `pays`, une ligne par plateforme, et ses codes pays en base (`codes_pays`,
 *   un CHECK refuse une liste mal formée) ; rejouable à empreinte identique.
 * Le rejeu se fait dans une transaction ANNULÉE : rien ne reste.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAILLES, PLATEFORMES } from '@/lib/zones/plateformes';
import { unitesPays } from '@/lib/zones/conversion';
import { psql, psqlBrut, psqlLignes } from './_psql';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '274_plateformes_geo.sql'), 'utf8');
// sql/311 (A6) réécrit le commentaire de `zone_set_extraction_unites.pop_totale` posé par sql/300 : rejouée après elle,
// l'empreinte est celle de la base (reliquat A6 corrigé au tour 1 d'A7).
const MIGRATION_PAYS = ['300_maille_pays.sql', '311_cercle_population_disque.sql']
  .map((f) => readFileSync(join(process.cwd(), 'sql', f), 'utf8')).join('\n');
/** B13 : les minimums de population et leur comportement (et `paver_cercles`, recopié de sql/311). */
const MIGRATION_MINIMUMS = readFileSync(join(process.cwd(), 'sql', '318_minimums_population.sql'), 'utf8');

/** Empreinte du contenu ET des contraintes de la table : un rejeu qui en changerait l'un ou l'autre la changerait. */
const EMPREINTE = `select md5(
  (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
  || (select string_agg(pg_get_constraintdef(c.oid), ';' order by c.conname)
        from pg_constraint c where c.conrelid = 'public.plateformes_geo'::regclass));`;

describe('sql/274 — plateformes_geo', () => {
  it('le seed du relevé : 17 lignes, une par (plateforme, maille) — 13 de sql/274, 4 « pays » de sql/300', () => {
    expect(psql('select count(*) from public.plateformes_geo;')).toBe('17');
    expect(psql('select count(distinct (plateforme, maille)) from public.plateformes_geo;')).toBe('17');
  });

  it('la clé (plateforme, maille) est la clé primaire — T6 la référence', () => {
    expect(psql(`select pg_get_constraintdef(oid) from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and contype = 'p';`))
      .toBe('PRIMARY KEY (plateforme, maille)');
  });

  it('aucune maille native sans doc officielle, sauf TTD « à vérifier »', () => {
    expect(psqlLignes(`select coalesce(string_agg(plateforme || '.' || maille, ','), '') from public.plateformes_geo
                        where natif and doc_url is null and not (plateforme = 'ttd' and a_verifier);`)).toEqual(['']);
  });

  it('une maille indisponible dit pourquoi', () => {
    expect(psql('select count(*) from public.plateformes_geo where not disponible and coalesce(note, \'\') = \'\';'))
      .toBe('0');
  });

  it('l’ordre est total (l’écran trie par lui)', () => {
    expect(psql('select count(distinct ordre) = count(*) from public.plateformes_geo;')).toBe('t');
  });

  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${EMPREINTE}\n${MIGRATION}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });

  it('les listes de lib/zones/plateformes.ts sont celles des CHECK de la base', () => {
    // Le schéma Zod de la route refuse une ligne hors liste : une maille ajoutée d'un seul côté casserait ⑤.
    const valeurs = (colonne: string) => psql(`select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.plateformes_geo'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%(${colonne} = ANY%';`).match(/'([a-z0-9]+)'::text/g)!
      .map(v => v.slice(1, v.indexOf("'", 1)));
    expect(valeurs('plateforme')).toEqual([...PLATEFORMES]);
    expect(valeurs('maille')).toEqual([...MAILLES]);
  });

  it.each([
    ['une décimale', '{"max_unites": 1500.5}'],
    ['zéro', '{"max_unites": 0}'],
    ['un négatif', '{"rayon_min_m": -1}'],
    ['un texte', '{"max_unites": "200"}'],
    ['une clé inconnue', '{"max_cercles": 200}'],
    ['un tableau', '[200]'],
  ])('la base refuse des limites que Zod refuserait : %s', (_cas, limites) => {
    const r = psqlBrut(`begin;
      update public.plateformes_geo set limites = '${limites}'::jsonb where plateforme = 'meta' and maille = 'cercle';
      rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/plateformes_geo_limites_(connues|check)/);
  });

  it('la base accepte des limites valides (transaction annulée)', () => {
    expect(psql(`begin;
      update public.plateformes_geo set limites = '{"max_unites": 150, "max_sommets": 5000}'::jsonb
       where plateforme = 'meta' and maille = 'cercle';
      select limites->>'max_unites' from public.plateformes_geo where plateforme = 'meta' and maille = 'cercle';
      rollback;`)).toBe('150');
  });

  it('les droits : service_role seul', () => {
    expect(psql(`select has_table_privilege('anon', 'public.plateformes_geo', 'select')
                     or has_table_privilege('authenticated', 'public.plateformes_geo', 'select');`)).toBe('f');
    expect(psql(`select has_table_privilege('service_role', 'public.plateformes_geo', 'select');`)).toBe('t');
  });
});

/** Ce que sql/300 touche : le contenu et les contraintes de la table, et le commentaire de `pop_totale` (E7). */
const EMPREINTE_PAYS = `select md5(
  (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
  || (select string_agg(c.conname || ':' || pg_get_constraintdef(c.oid), ';' order by c.conname)
        from pg_constraint c where c.conrelid = 'public.plateformes_geo'::regclass)
  || coalesce(col_description('public.zone_set_extraction_unites'::regclass,
       (select attnum from pg_attribute where attrelid = 'public.zone_set_extraction_unites'::regclass
                                          and attname = 'pop_totale')), ''));`;

const CODES_PAYS = '{"METRO": ["FR"], "FR": ["FR", "GP", "MQ", "GF", "RE", "YT"]}';
/** « CIRFA BRETAGNE », zone de l'espace interne présente dans le dump local (comme jeux-de-zone-schema.test.ts). */
const ZONE = 'f001b479-b870-4958-978d-e7a98b90de57';
const ORG = '00000000-0000-0000-0000-000000000001';

describe('sql/300 — la maille pays', () => {
  it('quatre lignes « pays », natives et disponibles ; « à vérifier » chez TTD seulement', () => {
    expect(psql(`select string_agg(plateforme || ':' || natif::text || ':' || disponible::text || ':' || a_verifier::text,
                                   ',' order by plateforme)
                   from public.plateformes_geo where maille = 'pays';`))
      .toBe('dv360:true:true:false,meta:true:true:false,tiktok:true:true:false,ttd:true:true:true');
  });

  it('les codes pays : METRO → FR ; FR → FR et les cinq DROM ; aucune autre maille n’en porte', () => {
    expect(psql(`select count(*) from public.plateformes_geo
                  where maille = 'pays' and codes_pays = '${CODES_PAYS}'::jsonb;`)).toBe('4');
    expect(psql(`select count(*) from public.plateformes_geo where maille <> 'pays' and codes_pays is not null;`))
      .toBe('0');
  });

  it.each([
    ['une clé inconnue', `'{"METRO": ["FR"], "FR": ["FR"], "XX": ["FR"]}'`],
    ['un code en minuscules', `'{"METRO": ["fr"], "FR": ["FR"]}'`],
    ['un code de trois lettres', `'{"METRO": ["FRA"], "FR": ["FR"]}'`],
    ['une liste vide', `'{"METRO": [], "FR": ["FR"]}'`],
    ['une clé manquante', `'{"METRO": ["FR"]}'`],
    ['un tableau au lieu d’un objet', `'["FR"]'`],
    ['aucun code sur une ligne pays', 'null'],
  ])('la base refuse des codes pays mal formés : %s', (_cas, valeur) => {
    const r = psqlBrut(`begin;
      update public.plateformes_geo set codes_pays = ${valeur}::jsonb where plateforme = 'meta' and maille = 'pays';
      rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/plateformes_geo_codes_pays_(valides|maille)/);
  });

  it('une ligne qui n’est pas « pays » ne porte pas de codes pays', () => {
    const r = psqlBrut(`begin;
      update public.plateformes_geo set codes_pays = '${CODES_PAYS}'::jsonb where plateforme = 'meta' and maille = 'cp';
      rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('plateformes_geo_codes_pays_maille');
  });

  it('zone_set_plateformes accepte (dv360, pays) par la clé étrangère (transaction annulée)', () => {
    expect(psql(`begin;
      insert into public.zone_sets (id, nom, org_id, type, custom_geo_zone_id)
      values ('aaaaaaaa-0000-4000-8000-000000000300', 'T1 — pays', '${ORG}', 'zone', '${ZONE}');
      insert into public.zone_set_plateformes (zone_set_id, plateforme, maille, seuil, rayon_m)
      values ('aaaaaaaa-0000-4000-8000-000000000300', 'dv360', 'pays', 0, null);
      select maille from public.zone_set_plateformes where zone_set_id = 'aaaaaaaa-0000-4000-8000-000000000300';
      rollback;`)).toBe('pays');
  });

  it('pays_a_verifier (relecture 1) : {FR} sur les quatre lignes pays, METRO confirmé ; NULL ailleurs', () => {
    expect(psql(`select count(*) from public.plateformes_geo where maille = 'pays' and pays_a_verifier = '{FR}';`)).toBe('4');
    expect(psql(`select count(*) from public.plateformes_geo where maille <> 'pays' and pays_a_verifier is not null;`)).toBe('0');
  });

  it.each([
    ['un code de recette inconnu', `'{XX}'`, 'pays'],
    ['NULL sur une ligne pays', 'null', 'pays'],
    ['une valeur sur une ligne qui n’est pas pays', `'{FR}'`, 'cp'],
  ])('la base refuse pays_a_verifier : %s', (_cas, valeur, maille) => {
    const r = psqlBrut(`begin;
      update public.plateformes_geo set pays_a_verifier = ${valeur}::text[] where plateforme = 'meta' and maille = '${maille}';
      rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('plateformes_geo_pays_a_verifier_valide');
  });

  it('chaque code pays en base a son libellé et, hors FR, son département (NOMS_PAYS, DEPARTEMENT_DROM en dur)', () => {
    const codes = psqlLignes(`select distinct c from public.plateformes_geo,
        jsonb_each(codes_pays) e, jsonb_array_elements_text(e.value) c where maille = 'pays' order by 1;`);
    expect(codes.length).toBeGreaterThan(0);
    // Un département par DROM : chacun peuplé de 1 ici, un code sans département rendrait `null`.
    const departements = ['971', '972', '973', '974', '976'].map((code) => ({ code, pop_en_zone: 1, pop_totale: 1 }));
    for (const u of unitesPays(codes, 100, departements)) {
      expect(u.nom, u.code).not.toBe(u.code);
      expect(u.population, u.code).not.toBeNull();
    }
  });

  it('pop_totale des unités figées dit ce qu’elle compte (E7)', () => {
    const commentaire = psql(`select col_description('public.zone_set_extraction_unites'::regclass,
        (select attnum from pg_attribute where attrelid = 'public.zone_set_extraction_unites'::regclass
                                           and attname = 'pop_totale'));`);
    expect(commentaire).toMatch(/cellule/i);
    expect(commentaire).toMatch(/non carroy/i);
  });

  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const base = psql(EMPREINTE_PAYS);
    const lignes = psqlLignes(`begin;\n${MIGRATION_PAYS}\n${EMPREINTE_PAYS}\n${MIGRATION_PAYS}\n${EMPREINTE_PAYS}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });
});

describe('sql/318 (B13) — les minimums de population, chacun avec son comportement', () => {
  it('le relevé : DV360 cercle 1 000 par cercle en refus (comportement à vérifier), TikTok 1 000 par groupe en avertissement, Meta sans minimum', () => {
    expect(psqlLignes(`select plateforme || '.' || maille || '|' || coalesce(limites->>'pop_min_unite', '-') || '|'
                              || coalesce(pop_min_unite_comportement, '-') || '|' || coalesce(limites->>'pop_min_groupe', '-') || '|'
                              || coalesce(pop_min_groupe_comportement, '-') || '|' || ('pop_min_unite_comportement' = any (parametres_a_verifier))
                         from public.plateformes_geo
                        where limites ?| array['pop_min_unite', 'pop_min_groupe'] or plateforme = 'meta'
                        order by plateforme, maille;`)).toEqual([
      'dv360.cercle|1000|refus|-|-|true',
      'meta.cercle|-|-|-|-|false', 'meta.cp|-|-|-|-|false', 'meta.pays|-|-|-|-|false', 'meta.polygone|-|-|-|-|false',
      'tiktok.commune|-|-|1000|avertissement|false', 'tiktok.departement|-|-|1000|avertissement|false',
    ]);
  });

  it.each([
    ['un comportement sans minimum', `update public.plateformes_geo set pop_min_groupe_comportement = 'refus' where plateforme = 'meta' and maille = 'cercle'`],
    ['un comportement inconnu', `update public.plateformes_geo set pop_min_unite_comportement = 'filtre' where plateforme = 'dv360' and maille = 'cercle'`],
    ['un refus par unité hors cercle', `update public.plateformes_geo set limites = limites || '{"pop_min_unite": 500}', pop_min_unite_comportement = 'refus' where plateforme = 'tiktok' and maille = 'commune'`],
  ])('la base refuse %s', (_cas, ordre) => {
    const r = psqlBrut(`begin;\n${ordre};\nrollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/plateformes_geo_pop_min_comportements/);
  });

  it('chaque minimum du registre porte son comportement (la base l’admet sans, pour le rejeu du seed de sql/274)', () => {
    expect(psql(`select count(*) from public.plateformes_geo
                  where (limites ? 'pop_min_unite' and pop_min_unite_comportement is null)
                     or (limites ? 'pop_min_groupe' and pop_min_groupe_comportement is null);`)).toBe('0');
  });

  it('un avertissement par unité hors cercle est admis, et le comportement peut être « à vérifier » (transaction annulée)', () => {
    expect(psql(`begin;
      update public.plateformes_geo set limites = limites || '{"pop_min_unite": 500}', pop_min_unite_comportement = 'avertissement',
             parametres_a_verifier = parametres_a_verifier || '{pop_min_groupe_comportement}'::text[]
       where plateforme = 'tiktok' and maille = 'commune';
      select pop_min_unite_comportement from public.plateformes_geo where plateforme = 'tiktok' and maille = 'commune';
      rollback;`)).toBe('avertissement');
  });

  it('paver_cercles rend ecartes_pop_min (règle 5)', () => {
    expect(psql(`select pg_get_functiondef('public.paver_cercles'::regproc) like '%ecartes_pop_min%';`)).toBe('t');
  });

  it('la migration rejouée deux fois : empreinte identique, et identique à la base', () => {
    const empreinte = `select md5(${EMPREINTE.slice('select md5('.length, -');'.length)}
      || pg_get_functiondef('public.paver_cercles'::regproc)
      || pg_get_functiondef('public.plateformes_geo_parametres_valides'::regproc));`;
    const base = psql(empreinte);
    const lignes = psqlLignes(`begin;\n${MIGRATION_MINIMUMS}\n${empreinte}\n${MIGRATION_MINIMUMS}\n${empreinte}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });
});

describe('sql/328 (C28) — DV360 : les bornes non relevées sont dites « à vérifier », sans valeur inventée', () => {
  it('CP : nombre maximal de CP par liste ; cercle : cercles par liste de proximité et rayon maximal — aucune valeur, à vérifier', () => {
    expect(psqlLignes(`select maille || '|' || coalesce(limites->>'max_unites', '-') || '|' || coalesce(limites->>'rayon_max_m', '-')
                              || '|' || ('max_unites' = any (parametres_a_verifier))
                              || '|' || ('rayon_max_m' = any (parametres_a_verifier)) || '|' || (note like '%C28%')
                         from public.plateformes_geo where plateforme = 'dv360' and maille in ('cp', 'cercle')
                        order by maille;`)).toEqual(['cercle|-|-|true|true|true', 'cp|-|-|true|false|true']);
  });

  it('la migration se rejoue à l’identique (transaction annulée)', () => {
    const migration = readFileSync(join(process.cwd(), 'sql', '328_dv360_bornes_a_verifier.sql'), 'utf8');
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${migration}\n${EMPREINTE}\n${migration}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });
});

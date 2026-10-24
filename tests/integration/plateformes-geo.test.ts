/**
 * `plateformes_geo` (sql/274, lot 5, T2) — le registre des mailles achetables, en base.
 *
 * Ce que ce fichier verrouille :
 * - le seed : une ligne par (plateforme, maille) relevée le 14/10, clé unique (T6 y pose une clé étrangère) ;
 * - aucune maille NATIVE sans lien vers sa doc officielle, sauf TTD (doc derrière connexion), alors « à vérifier » :
 *   l'écran promet un lien, il ne doit pas en manquer un en silence ;
 * - la migration se rejoue deux fois à l'identique (base locale partagée : rejouer ne doit rien changer).
 * Le rejeu se fait dans une transaction ANNULÉE : rien ne reste.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAILLES, PLATEFORMES } from '@/lib/zones/plateformes';
import { psql, psqlBrut, psqlLignes } from './_psql';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '274_plateformes_geo.sql'), 'utf8');

/** Empreinte du contenu ET des contraintes de la table : un rejeu qui en changerait l'un ou l'autre la changerait. */
const EMPREINTE = `select md5(
  (select string_agg(t::text, ';' order by plateforme, maille) from public.plateformes_geo t)
  || (select string_agg(pg_get_constraintdef(c.oid), ';' order by c.conname)
        from pg_constraint c where c.conrelid = 'public.plateformes_geo'::regclass));`;

describe('sql/274 — plateformes_geo', () => {
  it('le seed du relevé : 13 lignes, une par (plateforme, maille)', () => {
    expect(psql('select count(*) from public.plateformes_geo;')).toBe('13');
    expect(psql('select count(distinct (plateforme, maille)) from public.plateformes_geo;')).toBe('13');
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

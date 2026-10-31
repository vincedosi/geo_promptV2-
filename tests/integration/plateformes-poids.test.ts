/**
 * A1 (plan de corrections du découpage des zones, 2026-10-31) — le registre des MÉCANISMES DE POIDS (amendement E2,
 * sql/305), contre la base locale, sans rien y laisser (lectures, ou transactions ANNULÉES) :
 *   - le seed : DV360 multiplicateur 0,1 à 10 « à vérifier » sur ses deux bornes (E9 : par paramètre), DV360 script
 *     2 000 entrées par envoi, TTD budget_ligne au mécanisme « à vérifier », Meta et TikTok sans poids ; la règle d'un
 *     groupe de CP (`meme`) portée plateforme par plateforme et « à vérifier » partout ;
 *   - la lecture du serveur (`lirePoids`, PostgREST) rend des lignes que le schéma accepte ;
 *   - les CHECK refusent une plage incomplète ou inversée, un mécanisme ou un paramètre inconnus, un poids pour
 *     « aucun », une règle de groupe hors CP ;
 *   - les listes de `lib/zones/plateformes.ts` sont celles des CHECK ; la migration se rejoue à empreinte identique.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lirePoids } from '@/lib/zones/conversion-serveur';
import { MECANISMES_POIDS, PARAMETRES_POIDS_VERIFIABLES } from '@/lib/zones/plateformes';
import { psql, psqlBrut, psqlLignes } from './_psql';
import { creerClientTest } from './_client';

const MIGRATION = readFileSync(join(process.cwd(), 'sql', '305_plateformes_poids.sql'), 'utf8');

describe('plateformes_poids — le seed du 31/10 (sql/305)', () => {
  it('cinq lignes au CP : DV360 multiplicateur et script, TTD budget_ligne, Meta et TikTok aucun', () => {
    expect(psqlLignes(`select plateforme || ':' || mecanisme || ':' || coalesce(valeur_min::text, '-') || ':' ||
                              coalesce(valeur_max::text, '-') || ':' || coalesce(nb_max_entrees::text, '-') || ':' ||
                              poids_groupe_cp || ':' || branche || ':' || array_to_string(parametres_a_verifier, ',')
                         from public.plateformes_poids order by plateforme, mecanisme;`)).toEqual([
      'dv360:multiplicateur:0.1:10:-:meme:false:valeur_min,valeur_max,poids_groupe_cp',
      'dv360:script:-:-:2000:meme:false:nb_max_entrees,poids_groupe_cp',
      'meta:aucun:-:-:-:meme:false:mecanisme,poids_groupe_cp',
      'tiktok:aucun:-:-:-:meme:false:mecanisme,poids_groupe_cp',
      'ttd:budget_ligne:-:-:-:meme:false:mecanisme,poids_groupe_cp',
    ]);
  });

  it('la colonne de plateformes_geo reste en place, documentée comme remplacée', () => {
    expect(psql(`select col_description('public.plateformes_geo'::regclass,
                   (select attnum from pg_attribute where attrelid = 'public.plateformes_geo'::regclass and attname = 'poids_groupe_cp'));`))
      .toMatch(/^REMPLACEE par plateformes_poids\.poids_groupe_cp/);
  });

  it('lirePoids (PostgREST, service_role) : les lignes de DV360 au CP, validées par le schéma', async () => {
    const lignes = await lirePoids(creerClientTest() as never, ['dv360'], 'cp');
    expect(lignes.map((l) => [l.mecanisme, l.valeur_min, l.valeur_max, l.nb_max_entrees])).toEqual([
      ['multiplicateur', 0.1, 10, null], ['script', null, null, 2000],
    ]);
  });
});

describe('plateformes_poids — les CHECK (sql/305)', () => {
  it('les listes de lib/zones/plateformes.ts sont celles des CHECK de la base', () => {
    const corps = psqlLignes(`select pg_get_functiondef('public.plateformes_poids_parametres_valides'::regproc);`).join(' ');
    for (const p of PARAMETRES_POIDS_VERIFIABLES) expect(corps).toContain(`'${p}'`);
    expect((corps.match(/'[a-z_]+'/g) ?? []).filter((x) => x !== "'public'").length).toBe(PARAMETRES_POIDS_VERIFIABLES.length);
    const check = psqlLignes(`select pg_get_constraintdef(oid) from pg_constraint
                               where conrelid = 'public.plateformes_poids'::regclass and contype = 'c';`).join(' ');
    for (const m of MECANISMES_POIDS) expect(check).toContain(`'${m}'`);
  });

  it.each([
    ['plage incomplète', `valeur_max = null`, 'multiplicateur', 'plateformes_poids_plage_valide'],
    ['plage inversée', `valeur_min = 20`, 'multiplicateur', 'plateformes_poids_plage_valide'],
    ['plage au-delà de numeric(6,3)', `valeur_max = 1000`, 'multiplicateur', 'plateformes_poids_plage_valide'],
    ['entrées nulles', `nb_max_entrees = 0`, 'script', 'plateformes_poids_nombres_valides'],
    ['règle de groupe inconnue', `poids_groupe_cp = 'moitie'`, 'script', 'plateformes_poids_groupe_cp_valide'],
    ['paramètre inconnu', `parametres_a_verifier = '{plage}'`, 'script', 'plateformes_poids_parametres_a_verifier_valides'],
    ['mécanisme inconnu', `mecanisme = 'paliers'`, 'script', 'plateformes_poids_mecanisme_check'],
  ])('la base refuse : %s', (_cas, affectation, mecanisme, contrainte) => {
    const r = psqlBrut(`begin; update public.plateformes_poids set ${affectation}
                         where plateforme = 'dv360' and maille = 'cp' and mecanisme = '${mecanisme}'; rollback;`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(contrainte);
  });

  it('la base refuse un poids pour « aucun », et une règle de groupe hors CP', () => {
    const aucun = psqlBrut(`begin; update public.plateformes_poids set valeur_min = 1, valeur_max = 2
                              where plateforme = 'meta' and mecanisme = 'aucun'; rollback;`);
    expect(aucun.stderr).toContain('plateformes_poids_aucun_sans_valeur');
    const horsCp = psqlBrut(`begin; insert into public.plateformes_poids (plateforme, maille, mecanisme, poids_groupe_cp, releve_le)
                               values ('meta', 'cercle', 'aucun', 'meme', '2026-10-31'); rollback;`);
    expect(horsCp.stderr).toContain('plateformes_poids_groupe_cp_valide');
  });
});

describe('plateformes_poids — rejouable (sql/305)', () => {
  it('la migration rejouée deux fois : registre et fonction à empreinte identique, et identique à la base', () => {
    const EMPREINTE = `select md5(
      (select string_agg(t::text, ';' order by plateforme, maille, mecanisme) from public.plateformes_poids t)
      || pg_get_functiondef('public.plateformes_poids_parametres_valides'::regproc)
      || (select string_agg(pg_get_constraintdef(oid), ';' order by conname) from pg_constraint
           where conrelid = 'public.plateformes_poids'::regclass));`;
    const base = psql(EMPREINTE);
    const lignes = psqlLignes(`begin;\n${MIGRATION}\n${EMPREINTE}\n${MIGRATION}\n${EMPREINTE}\nrollback;`);
    const [premiere, seconde] = lignes.slice(-2);
    expect(premiere).toBe(seconde);
    expect(seconde).toBe(base);
  });

  it('un rejeu n’écrase pas une correction faite par update (on conflict do nothing)', () => {
    const r = psql(`begin;
      update public.plateformes_poids set valeur_min = 0.2, parametres_a_verifier = '{}'
       where plateforme = 'dv360' and mecanisme = 'multiplicateur';
      ${MIGRATION}
      select valeur_min || ':' || cardinality(parametres_a_verifier) from public.plateformes_poids
       where plateforme = 'dv360' and mecanisme = 'multiplicateur';
      rollback;`);
    expect(r).toBe('0.2:0');
  });
});

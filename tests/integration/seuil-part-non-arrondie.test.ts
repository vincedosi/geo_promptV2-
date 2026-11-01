/**
 * B11 (plan de corrections du découpage des zones, 2026-10-31) — le seuil compare la part NON arrondie (sql/303).
 *
 * Ce que ce fichier prouve, contre la base locale, sans rien y écrire (lectures, ou transactions ANNULÉES) :
 *   - `couverture_geometrie` rend, sur chaque ligne, `part_brute` (la part sans arrondi) à côté de `part` (le dixième
 *     affiché), et `round(part_brute, 1) = part` ; sur la composite (`919ca65d…`, celle de la fixture unitaire), les
 *     trois CP affichés 20,0 % qui ne passent plus un seuil de 20 % sont bien sous 20 % ;
 *   - un chiffrage en cache d'avant sql/303 (lignes sans `part_brute`) n'est plus servi ; avec la clé, il l'est ;
 *   - `paver_cercles` ne compare plus la part arrondie, et n'admet jamais une cellule sans habitant en zone.
 */
import { describe, expect, it } from 'vitest';
import { psql } from './_psql';

const LONG = 180_000;
/** « Cible composite (2 zones) », espace par défaut : la zone de `tests/unit/zones/fixtures/couverture-composite-cp.json`. */
const COMPOSITE = '919ca65d-665a-43f6-834e-ea9f2eb68c72';
const ORG = '00000000-0000-0000-0000-000000000001';

describe('couverture_geometrie — part_brute à côté de part (sql/303)', () => {
  it('chaque ligne porte part_brute, et part en est l’arrondi au dixième ; 19,96 % s’affiche 20,0 %', () => {
    const r = psql(`
      with l as (select e from jsonb_array_elements(
                   public.couverture_geometrie('${COMPOSITE}', '${ORG}', 'ind', 'cp')->'lignes') e)
      select count(*) || '|' ||
             count(*) filter (where e->>'part' is null) || '|' ||
             count(*) filter (where not e ? 'part_brute') || '|' ||
             count(*) filter (where round((e->>'part_brute')::numeric, 1) is distinct from (e->>'part')::numeric) || '|' ||
             coalesce(string_agg(e->>'code', ',' order by e->>'code')
                        filter (where (e->>'part')::numeric >= 20 and (e->>'part_brute')::numeric < 20), '')
        from l;`);
    // A4 (sql/308-309) : 901 lignes CP = 895 de population connue + 6 de 971/973 à population inconnue (part NULLE, ligne
    // distincte). Les 895 connues portent toutes part_brute et passent le contrôle d'arrondi ; l'écart de lecture reste les trois CP.
    expect(r).toBe('901|6|0|0|06130,57230,79180');
  }, LONG);
});

describe('couverture_zone_en_cache — un chiffrage sans part_brute n’est plus servi (sql/303)', () => {
  it('ligne de cache sans la clé : NULL ; la même avec la clé : servie (transaction annulée)', () => {
    const ecrire = (ligne: string) => `
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      select g.id, 'ind', 'iris', g.updated_at, (select max(b.construit_le) from public.carreau_couverture_bandes b),
             -- A5 (sql/310) : un chiffrage porte le minimum de ménages de sa cible (0 pour \`ind\`), sinon il n'est plus servi.
             jsonb_build_object('lignes', jsonb_build_array('${ligne}'::jsonb), 'min_menages', 0), now()
        from public.custom_geo_zones g where g.id = '${COMPOSITE}'
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj, base_construite_le = excluded.base_construite_le, resultat = excluded.resultat;`;
    const servi = `(public.couverture_zone_en_cache('${COMPOSITE}', '${ORG}', 'ind', 'iris') is not null)::text`;
    const r = psql(`begin;
      ${ecrire('{"code":"x","part":20}')}
      create temp table b11_r on commit drop as select ${servi} as sans_cle;
      ${ecrire('{"code":"x","part":20,"part_brute":19.96}')}
      select (select sans_cle from b11_r) || '|' || ${servi};
      rollback;`);
    // La base certifiée complète est un prérequis du cache : si elle ne l'est pas, les deux lectures sont NULL.
    expect(psql(`select (public.carreau_couverture_complete() is null)::text;`)).toBe('true');
    expect(r).toBe('false|true');
  }, LONG);
});

describe('paver_cercles — la part NON arrondie, jamais une cellule vide (sql/303)', () => {
  it('la définition en base ne compare plus round(…, 1) au seuil et exige pop_en_zone > 0', () => {
    const def = psql(`select replace(pg_get_functiondef('public.paver_cercles'::regproc), E'\\n', ' ');`);
    expect(def).not.toContain('round(100 * tot.pop_en_zone / tot.pop_totale, 1) >= p_seuil');
    expect(def).toContain('and tot.pop_en_zone > 0');
    expect(def).toContain('and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil');
  });
});

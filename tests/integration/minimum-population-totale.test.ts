/**
 * C24 round 1 (I-1, plan de corrections du découpage des zones) — les minimums de plateforme se comparent à la
 * POPULATION TOTALE, jamais à la cible (sql/330). Lectures seules contre la base locale.
 *
 * Le faux refus fermé : DV360 en cercles, cible 18-24 ans, minimum 1 000 par cercle — un disque de 3 000 habitants
 * (≈ 250 jeunes) était écarté parce que sa population DANS LA CIBLE était sous 1 000.
 */
import { describe, expect, it } from 'vitest';
import { psql } from './_psql';

const LONG = 180_000;
/** « CIRFA BRETAGNE », 4 999 km² (la zone de la mesure M5, `paver-cercles.test.ts`). */
const CIRFA = 'f001b479-b870-4958-978d-e7a98b90de57';
const org = () => psql(`select org_id from public.custom_geo_zones where id = '${CIRFA}';`);

describe('paver_cercles — p_pop_min compare la population TOTALE du disque (sql/330)', () => {
  it('cible 18-24 ans, minimum 1 000 : des cercles sous 1 000 jeunes restent, aucun sous 1 000 habitants', () => {
    const r = psql(`
      with p as (select public.paver_cercles('${CIRFA}', '${org()}', 'ind_18_24', 5000, 0, 1000) j),
           c as (select e from p, jsonb_array_elements(p.j->'cercles') e)
      select (select (j->>'n_cercles')::int > 0 from p)::text
             || '|' || (count(*) filter (where (e->>'pop_totale')::numeric < 1000) > 0)::text
             || '|' || count(*) filter (where (e->>'pop_totale_ind')::numeric < 1000)
             || '|' || count(*) filter (where not e ? 'pop_totale_ind')
        from c;`);
    expect(r).toBe('true|true|0|0');
  }, LONG);

  it('les cellules écartées par le minimum sont dites en population TOTALE (population_max < 1 000)', () => {
    const r = psql(`select coalesce((j->'ecartes_pop_min'->>'population_max')::numeric < 1000, true)::text
                      from (select public.paver_cercles('${CIRFA}', '${org()}', 'ind_18_24', 5000, 0, 1000) j) p;`);
    expect(r).toBe('true');
  }, LONG);
});

describe('couverture_geometrie — population_ind, la population totale de la forme (sql/330)', () => {
  it('cible 18-24 ans : population_ind > population (cible) ; ind : pas de clé', () => {
    const r = psql(`select ((j->>'population_ind')::numeric > (j->>'population')::numeric)::text || '|'
                           || (public.couverture_geometrie('${CIRFA}', '${org()}', 'ind', 'forme') ? 'population_ind')::text
                      from (select public.couverture_geometrie('${CIRFA}', '${org()}', 'ind_18_24', 'forme') j) p;`);
    expect(r).toBe('true|false');
  }, LONG);
});

/**
 * C18 (plan de corrections du découpage des zones, 2026-10-31, lot 3) — les lignes d'une couverture se somment au total
 * affiché (sql/323).
 *
 * L'ORIGINE DE LA DÉRIVE. Les populations des carreaux Filosofi sont des DEMI-habitants (aucune autre fraction : 0 carreau
 * sur la composite). Une somme par CP finit donc en ,0 ou en ,5 — 461 des 895 CP de la composite en ,5 — et `round()`
 * arrondit ,5 en s'éloignant de zéro : chaque ligne en ,5 gagnait ½. Σ round(pop_en_zone) = 11 221 886 contre une somme
 * brute de 11 221 655,5 : +230,5, soit les −230 habitants de `manques` contre « CP écartés + hors territoire ». Aucun
 * `floor`, `trunc` ni cast entier : un biais de l'arrondi au plus proche sur des valeurs à mi-chemin, pas une troncature.
 *
 * Ce que ce fichier prouve, contre la base locale, sans rien y écrire : sur la composite (`919ca65d…`, celle de la
 * fixture unitaire), au CP et à la commune, Σ `pop_en_zone` des lignes + `hors_territoire.population` = `population`,
 * et chaque ligne vaut l'arrondi par défaut ou par excès de sa somme brute (répartition au plus fort reste).
 */
import { describe, expect, it } from 'vitest';
import { psql } from './_psql';

const LONG = 180_000;
/** « Cible composite (2 zones) », espace par défaut : la zone de `tests/unit/zones/fixtures/couverture-composite-cp.json`. */
const COMPOSITE = '919ca65d-665a-43f6-834e-ea9f2eb68c72';
const ORG = '00000000-0000-0000-0000-000000000001';

/** `lignes|écart (Σ lignes + hors − population)` d'un appel direct (hors cache) à `couverture_geometrie`. */
function ecart(decoupage: string): string {
  return psql(`
    with r as (select public.couverture_geometrie('${COMPOSITE}', '${ORG}', 'ind', '${decoupage}') as j)
    select (select count(*) from jsonb_array_elements(r.j->'lignes') e where e->>'pop_en_zone' is not null) || '|' ||
           ((select coalesce(sum((e->>'pop_en_zone')::numeric), 0) from jsonb_array_elements(r.j->'lignes') e)
            + (r.j->'hors_territoire'->>'population')::numeric - (r.j->>'population')::numeric)
      from r;`);
}

describe('couverture_geometrie — Σ lignes + hors territoire = population (sql/323, C18)', () => {
  it('composite au CP : 895 lignes chiffrées, écart 0 (+230 avant, ,5 arrondis vers le haut)', () => {
    expect(ecart('cp')).toBe('895|0');
  }, LONG);

  it('composite à la commune : écart 0', () => {
    expect(ecart('commune').split('|')[1]).toBe('0');
  }, LONG);

  it('composite au CP sous un minimum de ménages (men_pauv, v_min > 0) : écart 0', () => {
    const r = psql(`
      with r as (select public.couverture_geometrie('${COMPOSITE}', '${ORG}', 'men_pauv', 'cp') as j)
      select ((r.j->>'min_menages')::numeric > 0)::text || '|' ||
             ((select coalesce(sum((e->>'pop_en_zone')::numeric), 0) from jsonb_array_elements(r.j->'lignes') e)
              + (r.j->'hors_territoire'->>'population')::numeric - (r.j->>'population')::numeric)
        from r;`);
    expect(r).toBe('true|0');
  }, LONG);

  it('composite telle quelle (forme, aucun groupe) : aucune ligne, hors territoire 0, la clé arrondi_lignes', () => {
    const r = psql(`
      with r as (select public.couverture_geometrie('${COMPOSITE}', '${ORG}', 'ind', 'forme') as j)
      select jsonb_array_length(r.j->'lignes') || '|' || (r.j->'hors_territoire'->>'population') || '|' ||
             (r.j->>'arrondi_lignes') || '|' || ((r.j->>'population')::numeric > 0) from r;`);
    expect(r).toBe('0|0|plus_fort_reste|true');
  }, LONG);

  it('chaque ligne CP vaut floor ou ceil de sa somme brute de carreaux', () => {
    const r = psql(`
      with z as (select geometry g from public.custom_geo_zones where id = '${COMPOSITE}'),
           k as (select rang_pop from public.cibles_exposition where code = 'ind'),
           brut as (select f.code_postal as code, sum(f.pop) as p
                      from z, k, public.carreaux_de_forme_menages(z.g, k.rang_pop, k.rang_pop) f
                     where f.code_postal is not null group by f.code_postal),
           l as (select e->>'code' as code, (e->>'pop_en_zone')::numeric as v
                   from jsonb_array_elements(public.couverture_geometrie('${COMPOSITE}', '${ORG}', 'ind', 'cp')->'lignes') e
                  where e->>'pop_en_zone' is not null)
      select count(*) || '|' || count(*) filter (where l.v not in (floor(b.p), ceil(b.p)))
        from l join brut b on b.code = l.code;`);
    expect(r).toBe('895|0');
  }, LONG);
});

/**
 * C18, round 1 (sql/324) : la zone nationale. `couverture_pays_jsonb` arrondissait aussi ligne à ligne (`round(t.p)`) :
 * France entière au CP, « manqués −1 504 » (−1 489 en METRO). Au CP, Σ lignes = `population` (même dénominateur) ; au
 * département, les lignes se somment à l'arrondi de LEUR total brut — l'écart restant à `population` est I-2 (carreaux
 * sans CP, rattaché à C25), égal à round(Σ départements) − round(Σ CP), hors de ce ticket.
 */
describe('couverture_pays_jsonb — lignes au plus fort reste (sql/324, C18 round 1)', () => {
  // C25 (sql/332) : les dénominateurs lus sont les jumeaux `_e7`, ceux que `couverture_pays_jsonb` lit désormais.
  /** `lignes|écart à population|écart à l'arrondi du total brut|lignes hors floor/ceil|pop_totale ≠ pop_en_zone`. */
  function pays(code: string, cible: string, decoupage: 'cp' | 'departement'): string {
    const brut = decoupage === 'cp'
      ? `select cp.code_postal as code, case when v.m > 0 then coalesce((dm.populations->>'${cible}')::numeric, 0)
                                              else (cp.populations->>'${cible}')::numeric end as p
           from public.cp_population_totale_e7 cp
           left join public.denominateur_menages_min_e7 dm on v.m > 0 and dm.maille = 'cp' and dm.code = cp.code_postal
          where public.pays_contient_code('${code}', cp.code_postal)`
      : `select u.code, case when v.m > 0 then coalesce((dm.populations->>'${cible}')::numeric, 0)
                              else (u.populations->>'${cible}')::numeric end as p
           from public.unite_population_totale_e7 u
           left join public.denominateur_menages_min_e7 dm on v.m > 0 and dm.maille = 'departement' and dm.code = u.code
          where u.maille = 'departement' and public.pays_contient_code('${code}', u.code)`;
    return psql(`
      with v as (select public.min_menages_de_cible('${cible}') as m),
           j as (select public.couverture_pays_jsonb('${code}', '${cible}', '${decoupage}') as j),
           l as (select e->>'code' as code, (e->>'pop_en_zone')::numeric as v, (e->>'pop_totale')::numeric as t
                   from j, jsonb_array_elements(j.j->'lignes') e where e->>'pop_en_zone' is not null),
           b as (${brut.replace(/v\.m/g, '(select m from v)')})
      select (select count(*) from l) || '|' ||
             ((select sum(l.v) from l) - (select (j.j->>'population')::numeric from j)) || '|' ||
             ((select sum(l.v) from l) - (select round(sum(b.p)) from b)) || '|' ||
             (select count(*) from l join b using (code) where l.v not in (floor(b.p), ceil(b.p))) || '|' ||
             (select count(*) from l where l.t is distinct from l.v);`);
  }

  it.each([['FR'], ['METRO']])('%s au CP (ind) : Σ lignes = population, chaque ligne floor ou ceil', (code) => {
    const [, ecart, ecartBrut, horsBornes, totales] = pays(code, 'ind', 'cp').split('|');
    expect([ecart, ecartBrut, horsBornes, totales]).toEqual(['0', '0', '0', '0']);
  }, LONG);

  it('FR au CP sous un minimum (men_pauv) : Σ lignes = population', () => {
    const [, ecart, ecartBrut, horsBornes] = pays('FR', 'men_pauv', 'cp').split('|');
    expect([ecart, ecartBrut, horsBornes]).toEqual(['0', '0', '0']);
  }, LONG);

  it.each([['FR', 'ind'], ['METRO', 'ind'], ['FR', 'men_pauv']])('%s au département (%s) : Σ lignes = arrondi du total brut des départements', (code, cible) => {
    const [, , ecartBrut, horsBornes, totales] = pays(code, cible, 'departement').split('|');
    expect([ecartBrut, horsBornes, totales]).toEqual(['0', '0', '0']);
  }, LONG);
});

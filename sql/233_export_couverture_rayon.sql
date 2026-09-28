-- 233 — Données de l'export Excel de l'onglet Rayon (2026-09-28)
--
-- ── CE QUE L'EXPORT A BESOIN, ET POURQUOI TOUT D'UN COUP ────────────────────
--
-- Le classeur est INTERACTIF : le seuil Seveso, le territoire, les natures et
-- le rayon s'y choisissent APRÈS l'export, et Excel recalcule seul. Il porte
-- donc la table ENTIÈRE et non une courbe déjà filtrée — 1 293 combinaisons
-- (département × gravité × nature) × 100 paliers, soit quelques centaines de
-- Ko. `lire_couverture_rayon` (sql/199) rend une courbe pour UN filtre ; il
-- faudrait l'appeler des centaines de fois.
--
-- ⚠ On rend les INCRÉMENTS par palier (format creux), pas les cumuls : le cumul se calcule
-- côté TypeScript, avec la MÊME convention que sql/199 — le palier `b` regroupe
-- [b, b+100), donc « à moins de r mètres » est la somme des paliers < r.
--
-- ⚠ Les lignes `gravite='*'` et `nature='*'` sont celles de la table : elles
-- viennent du MINIMUM par carreau (sql/198) et ne sont PAS la somme des autres.
-- L'export les transporte telles quelles, jamais recalculées.
--
-- Les dénominateurs viennent d'`unite_population_totale` (sql/221), la même
-- source que la part affichée par `population_par_classe` : un prorata dont les
-- deux termes ne comptent pas la même chose ne veut rien dire.

create or replace function public.export_couverture_rayon(p_cible text default 'ind')
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_result jsonb;
begin
  -- Même barrière que sql/199 : la cible est un nom de clé jsonb, validé
  -- contre le catalogue avant toute lecture.
  if not exists (select 1 from public.cibles_exposition where code = p_cible and actif) then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false);
  end if;

  with
  base as materialized (
    select r.code_departement as d, r.gravite as g, r.nature as n, r.rayon_m,
           coalesce((r.populations->>p_cible)::numeric, 0) as pop
      from public.couverture_rayon_risque r
  ),
  -- Une ligne par combinaison, ses paliers en objet CREUX {indice: pop}, où
  -- l'indice vaut rayon_m / 100 (0 à 99). La grille dense des 100 paliers se
  -- complète côté TypeScript : la construire ici par une jointure sur une
  -- grille coûtait 12 s, quand un seul `group by` en prend quelques centaines
  -- de millisecondes. Un palier absent vaut 0 — aucun carreau à cette
  -- distance, un incrément réellement nul.
  lignes as (
    select d, g, n,
           jsonb_object_agg((rayon_m / 100)::text, round(pop, 2)) as inc
      from base
     group by d, g, n
  ),
  -- Les départements présents, lus UNE fois. Des `exists` sur `base` la
  -- relisaient pour chaque département et chaque région : 5 s au lieu de <1.
  presents as materialized (select distinct d from base)
  select jsonb_build_object(
    'calculable', true,
    'cible', p_cible,
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'g', g, 'n', n, 'inc', inc)
                                         order by d, g, n), '[]'::jsonb) from lignes),
    'departements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', dp.code_dept, 'nom', dp.nom_dept, 'region', dp.code_region,
               'pop', (u.populations->>p_cible)::numeric)
             order by dp.code_dept), '[]'::jsonb)
        from public.ref_departements dp
        left join public.unite_population_totale u
               on u.maille = 'departement' and u.code = dp.code_dept
       where dp.code_dept in (select d from presents)),
    'regions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', rg.code_region, 'nom', rg.nom_region,
               'pop', (u.populations->>p_cible)::numeric)
             order by rg.code_region), '[]'::jsonb)
        from public.ref_regions rg
        left join public.unite_population_totale u
               on u.maille = 'region' and u.code = rg.code_region
       where rg.code_region in (select dp.code_region from public.ref_departements dp
                                  where dp.code_dept in (select d from presents))),
    'calcule_le', (select max(construit_le) from public.couverture_rayon_bandes)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.export_couverture_rayon(text) from public, anon, authenticated;
grant execute on function public.export_couverture_rayon(text) to service_role;

-- ============================================================================
-- sql/171_dispersion_parent_departement.sql — 2026-09-15
--
-- `alignement_dispersion_cp` (sql/165) filtrait son parent ainsi :
--
--     where p_parent is null or code_dept = p_parent or code_region = p_parent
--
-- Les deux nomenclatures INSEE SE RECOUVRENT : 18 codes designent a la fois
-- un departement et une region. Mesure en base (2026-09-15) :
--
--     select array_agg(d.code_dept) from ref_departements d
--      where d.code_dept in (select code_region from ref_regions);
--     -> {01,02,03,04,06,11,24,27,28,32,44,52,53,75,76,84,93,94}
--
-- Effet sur la campagne demo (dccc0000-0000-4000-8000-000000000002), mesure
-- avant correctif : `p_parent = '75'` (Paris, 21 CP dans cette campagne)
-- rendait **164 CP**, dont 143 en Nouvelle-Aquitaine (code_region '75').
-- `p_parent = '11'` (Aude, 7 CP) rendait 407 CP, dont 400 en Ile-de-France.
--
-- Le chemin est VIVANT : `SuiviV2` n'appelle `/alignement/dispersion` qu'en
-- maille `cp` et lui passe `session.parent`, qui est alors un code de
-- DEPARTEMENT (le fil d'Ariane est region -> departement -> CP). Un media
-- planner qui descend sur Paris pour lire la dispersion de ses 21 CP lisait
-- un histogramme construit sur 164 : un departement sous-livre pouvait y
-- paraitre conforme, ou l'inverse.
--
-- ── Le correctif : aligner sur les deux RPC soeurs ─────────────────────────
-- `alignement_par_maille` (sql/165:198-202) et les trois branches de
-- `alignement_par_maille_geo` conditionnent deja ce predicat a la MAILLE
-- demandee (`p_maille='cp'` -> `code_dept`, `p_maille='departement'` ->
-- `code_region`). Celle-ci l'avait oublie parce qu'elle ne prend pas de
-- `p_maille` : elle ne sert QUE la maille CP, donc son parent ne peut etre
-- qu'un code de DEPARTEMENT. Le `or code_region = p_parent` disparait.
--
-- La permissivite assumee dans l'en-tete de la route (« ou, a titre
-- permissif, une region ») est retiree du meme geste : ce n'etait pas une
-- tolerance, c'etait une confusion entre deux nomenclatures qui se recouvrent.
--
-- ⚠ TOUT LE RESTE DU CORPS EST INCHANGE, y compris le ruling qui importe le
-- plus ici : les totaux de normalisation (`tot`) restent calcules sur
-- `situe`, le PERIMETRE COMPLET de la campagne, jamais sur le sous-ensemble
-- `filtre` (meme ruling que T6-2). Les recopier depuis `filtre` rendrait tout
-- drill-down departemental muet par construction.
--
-- Verifie apres application (campagne demo), somme des `n_cp` de toutes les
-- bandes contre un `count(distinct postal_code)` ecrit a part :
--   p_parent='75'  -> 21 CP  (etait 164) · attendu 21
--   p_parent='11'  ->  7 CP  (etait 407) · attendu  7
--   p_parent='13'  -> 102 CP (inchange)  · attendu 102
--   p_parent=null  -> 2041 CP (inchange) · attendu 2041
--
-- Cout mesure, EXPLAIN (ANALYZE, BUFFERS), p_parent='75' :
--   30,6 ms · shared hit=7551 · 0 lecture disque
-- (sql/165 mesurait 30 ms / 7552 buffers sur la vue nationale : le predicat
-- ne change rien au cout, il balaye le meme `situe`.)
-- ============================================================================

create or replace function alignement_dispersion_cp(
  p_campaign_id uuid,
  p_parent      text default null,   -- code de DEPARTEMENT ; cette RPC ne sert que la maille CP
  p_tolerance   numeric default null -- accepte pour la parite d'interface (Tache 12) ; sans effet : les bandes sont universelles (BORNES_DIVERGENTES)
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with situe as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           max(r.planned_share)::numeric as part,
           rcp.code_dept
      from campaign_cp_rollup r
      join ref_codes_postaux rcp on rcp.code_postal = r.postal_code
      join ref_departements  rd  on rd.code_dept   = rcp.code_dept
     where r.campaign_id = p_campaign_id
     group by r.postal_code, rcp.code_dept
  ),
  -- Totaux sur le PERIMETRE COMPLET -- jamais sur `filtre`. Voir sql/165.
  tot as (select sum(reel) tr, sum(part) tp from situe),
  filtre as (
    -- sql/171 : `code_dept` SEUL. 18 codes de departement sont aussi des
    -- codes de region ('75' = Paris ET Nouvelle-Aquitaine) : un `or
    -- code_region = p_parent` ramenait la region homonyme entiere.
    select * from situe
     where p_parent is null or code_dept = p_parent
  ),
  ecarts as (
    select f.postal_code, f.reel,
           ((f.reel / nullif((f.part / nullif(t.tp,0)) * t.tr, 0)) - 1) * 100 as ecart
      from filtre f cross join tot t
  ),
  classe as (
    select width_bucket(ecart, array[-50,-25,-10,10,25,50]) as tranche,
           count(*) n_cp, sum(reel) impressions
      from ecarts group by 1
  ),
  -- 7 bandes (index 0-6) pour 6 bornes -- meme decoupe que BORNES_DIVERGENTES
  -- / RAMPE_MAPLIBRE / LIBELLES_TRANCHES (lib/campagne/palette-divergente.ts).
  -- NULL = borne ouverte (extremite de l'echelle).
  bornes(i, basse, haute) as (
    values (0, null::numeric, -50::numeric), (1, -50, -25), (2, -25, -10),
           (3, -10, 10), (4, 10, 25), (5, 25, 50), (6, 50, null)
  )
  select jsonb_build_object('tranches', coalesce(jsonb_agg(
    jsonb_build_object(
      'borne_basse', b.basse, 'borne_haute', b.haute,
      'n_cp', c.n_cp, 'impressions', c.impressions
    ) order by c.tranche nulls last
  ), '[]'::jsonb))
  from classe c
  left join bornes b on b.i = c.tranche;
$$;

revoke all on function alignement_dispersion_cp(uuid, text, numeric) from public, anon, authenticated;
grant execute on function alignement_dispersion_cp(uuid, text, numeric) to service_role;

comment on function alignement_dispersion_cp is
  'Histogramme de dispersion des ecarts au plan par CP (7 bandes fixes, BORNES_DIVERGENTES), maille CP uniquement. p_parent est un code de DEPARTEMENT et rien d autre (sql/171 : 18 codes de departement sont aussi des codes de region, le predicat permissif ramenait la region homonyme). Totaux normalises sur le perimetre COMPLET de la campagne (ruling T6-2), jamais sur le seul p_parent filtre.';

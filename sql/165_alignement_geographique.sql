-- sql/165_alignement_geographique.sql
-- Score d'alignement geographique. TOUJOURS calcule au code postal, jamais a
-- la maille affichee : agreger d abord lisserait les ecarts internes et le
-- score monterait mecaniquement quand l utilisateur dezoome.

create or replace function calculer_alignement_geo(
  p_campaign_id uuid,
  p_tolerance   numeric default null,   -- null => lit dsp_campaigns
  p_poids       numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tol         numeric;
  v_poids       numeric;
  v_divergent   boolean;
  v_res         jsonb;
begin
  select coalesce(p_tolerance, c.tolerance_pct) / 100.0,
         coalesce(p_poids, c.overpressure_weight)
    into v_tol, v_poids
    from dsp_campaigns c where c.id = p_campaign_id;

  if v_tol is null then
    return jsonb_build_object('error', 'campagne_introuvable');
  end if;

  -- GARDE-FOU. Le plan est cense etre une propriete du CODE POSTAL, simplement
  -- recopiee sur chaque ligne acteur (verifie le 2026-09-14 : 2041 CP, une
  -- seule valeur distincte partout). Si ce n est plus vrai, moyenner en
  -- silence rendrait un score faux que rien ne signalerait.
  select exists (
    select 1 from campaign_cp_rollup
    where campaign_id = p_campaign_id
    group by postal_code
    having count(distinct planned_share) > 1
  ) into v_divergent;

  with cp as (
    -- Sommer sur les acteurs AVANT tout calcul : la PK est
    -- (campaign_id, postal_code, actor), un CP apparait jusqu a 5 fois.
    select r.postal_code,
           sum(r.impressions)::numeric      as reel,
           sum(r.imps_prev7d)::numeric      as reel_prev,
           max(r.planned_share)::numeric    as part_plan,
           sum(r.spend)::numeric            as depense
      from campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  tot as (
    select sum(reel) t_reel, sum(reel_prev) t_prev, sum(depense) t_dep,
           sum(part_plan) t_part
      from cp
  ),
  calc as (
    select cp.postal_code,
           cp.reel, cp.reel_prev, cp.depense,
           -- Re-normaliser la part : elle vaut 1 par acteur, mais `max()`
           -- ci-dessus en a pris UNE seule, donc la somme vaut deja ~1.
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_reel as plan_imps,
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_prev as plan_imps_prev
      from cp cross join tot t
  ),
  agg as (
    select
      sum(greatest(0, plan_imps * (1 - v_tol) - reel))  filter (where plan_imps > 0) as manque,
      sum(greatest(0, reel - plan_imps * (1 + v_tol)))                                as trop,
      count(*) filter (
        where plan_imps > 0
          and reel between plan_imps * (1 - v_tol) and plan_imps * (1 + v_tol)
      ) as conformes,
      count(*) as n_cp,
      -- Le meme calcul sur la fenetre 7 jours precedente, pour la variation.
      sum(greatest(0, plan_imps_prev * (1 - v_tol) - reel_prev)) filter (where plan_imps_prev > 0) as manque_prev,
      sum(greatest(0, reel_prev - plan_imps_prev * (1 + v_tol)))                                   as trop_prev,
      -- Cout du desequilibre : la part de depense correspondant au volume en trop.
      sum(greatest(0, reel - plan_imps * (1 + v_tol)) / nullif(reel, 0) * depense) as eur_deplacables
      from calc
  )
  select jsonb_build_object(
    'maille_calcul',       'cp',
    'tolerance_pct',       round(v_tol * 100, 2),
    'overpressure_weight', v_poids,
    'plan_divergent',      v_divergent,
    'n_cp',                a.n_cp,
    'conformes_pct',       round((a.conformes::numeric / nullif(a.n_cp, 0)) * 100, 1),
    'sous_pression_imps',  round(coalesce(a.manque, 0)),
    'sur_pression_imps',   round(coalesce(a.trop, 0)),
    'sous_pression_pct',   round(coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_pct',    round(coalesce(a.trop, 0)   / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_eur',    round(coalesce(a.eur_deplacables, 0), 2),
    'impressions_totales', t.t_reel,
    'depense_totale',      t.t_dep,
    'score', greatest(0, round(100
      - coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100
      - v_poids * coalesce(a.trop, 0) / nullif(t.t_reel, 0) * 100)),
    'score_prev_7j', greatest(0, round(100
      - coalesce(a.manque_prev, 0) / nullif(t.t_prev, 0) * 100
      - v_poids * coalesce(a.trop_prev, 0) / nullif(t.t_prev, 0) * 100))
  ) into v_res
  from agg a cross join tot t;

  return coalesce(v_res, jsonb_build_object('error', 'aucune_donnee'));
end;
$$;

revoke all on function calculer_alignement_geo(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function calculer_alignement_geo(uuid, numeric, numeric) to service_role;

comment on function calculer_alignement_geo is
  'Score d alignement geographique 0-100, TOUJOURS calcule au code postal. Jumeau TS : lib/campagne/alignement.ts';

-- ---------------------------------------------------------------------------
-- alignement_par_maille — Tache 6. Rend les memes ecarts que
-- calculer_alignement_geo, mais AGREGES a la maille demandee (region /
-- departement / cp) pour le tableau, les tuiles carte et le fil d'Ariane. Le
-- score lui-meme ne change JAMAIS avec la maille (il reste calcule au CP) ;
-- seule la liste rendue ici change de granularite.
--
-- Jointure INSEE reelle, jamais campaign_cp_rollup.dept (LEFT(postal_code,2) :
-- tous les DROM s effondrent sur '97' et la colonne ne porte aucun nom) —
-- sql/117_campaign_derive_map.sql:34-42 emprunte deja cette jointure :
-- campaign_cp_rollup -> ref_codes_postaux.code_dept -> ref_departements -> ref_regions.
--
-- PV-2 : mesure le 2026-09-14, 3 departements (975, 977, 978 — collectivites
-- d'outre-mer sans region de rattachement) ont code_region NULL dans
-- ref_departements. ref_regions est joint en LEFT JOIN : sans traitement, ces
-- lignes se retrouveraient dans un seau 'null' anonyme en maille Region. Ici,
-- coalesce() les regroupe explicitement sous le code 'HORS' / nom
-- 'Hors region' plutot que de les laisser en null ou de les exclure.
--
-- T6-4 : p_parent est TOUJOURS le niveau immediatement au-dessus de p_maille
-- (parent d'une maille 'departement' = code_region, parent d'une maille 'cp'
-- = code_dept). Region est la racine de la hierarchie : elle n'a pas de
-- parent. Passer p_parent avec p_maille='region' est refuse EN AMONT par la
-- route (400 explicite), avant meme d'appeler cette RPC -- sans quoi aucune
-- branche du `where` de `filtre` ne correspond et le tableau revient vide en
-- silence, indiscernable d'une campagne sans donnees.
create or replace function alignement_par_maille(
  p_campaign_id uuid,
  p_maille      text default 'departement',   -- 'region' | 'departement' | 'cp'
  p_parent      text default null,
  p_tolerance   numeric default null,
  p_limite      int default 500
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tol numeric;
  v_res jsonb;
begin
  if p_maille not in ('region', 'departement', 'cp') then
    raise exception 'maille inconnue: %', p_maille;
  end if;

  select coalesce(p_tolerance, c.tolerance_pct) / 100.0 into v_tol
    from dsp_campaigns c where c.id = p_campaign_id;
  if v_tol is null then return jsonb_build_object('error', 'campagne_introuvable'); end if;

  with cp as (
    -- Sommer sur les acteurs AVANT tout calcul : la PK de campaign_cp_rollup
    -- est (campaign_id, postal_code, actor), un CP apparait jusqu a 5 fois.
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           max(r.planned_share)::numeric as part_plan,
           sum(r.spend)::numeric         as depense
      from campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  -- Jointure INSEE reelle. JAMAIS `campaign_cp_rollup.dept`.
  situe as (
    select cp.*, rcp.code_dept, rd.nom_dept,
           -- PV-2 : jamais de code_region/nom_region NULL en sortie.
           coalesce(rd.code_region, 'HORS')      as code_region,
           coalesce(rr.nom_region, 'Hors region') as nom_region
      from cp
      join ref_codes_postaux rcp on rcp.code_postal = cp.postal_code
      join ref_departements  rd  on rd.code_dept   = rcp.code_dept
      left join ref_regions  rr  on rr.code_region = rd.code_region
  ),
  filtre as (
    select * from situe
     where p_parent is null
        or (p_maille = 'departement' and code_region = p_parent)
        or (p_maille = 'cp'          and code_dept   = p_parent)
  ),
  -- T6-2 : totaux calcules sur `situe` (le perimetre COMPLET de la
  -- campagne), JAMAIS sur `filtre` (le seul sous-ensemble du parent). Sinon,
  -- descendre dans un parent rebase le plan sur la LIVRAISON REELLE de ce
  -- parent : la somme des ecarts de ses enfants vaut alors zero par
  -- construction, et le tableau ne peut plus jamais expliquer pourquoi le
  -- parent derape. `filtre` ne sert plus qu'a choisir les LIGNES affichees.
  tot as (select sum(reel) t_reel, sum(part_plan) t_part from situe),
  groupe as (
    select
      case p_maille when 'region' then code_region when 'departement' then code_dept else postal_code end as code,
      case p_maille when 'region' then max(nom_region) when 'departement' then max(nom_dept) else max(postal_code) end as nom,
      sum(reel) as reel, sum(part_plan) as part_plan, sum(depense) as depense
      from filtre
     group by 1
  )
  select jsonb_build_object(
    'maille', p_maille,
    'parent', p_parent,
    'n_total', (select count(*) from groupe),
    'unites', coalesce(jsonb_agg(u order by u.volume_deplace desc), '[]'::jsonb)
  ) into v_res
  from (
    select g.code, g.nom,
           g.reel::bigint                                       as impressions,
           round(g.depense, 2)                                  as spend,
           round(g.depense / nullif(g.reel, 0) * 1000, 2)       as cpm,
           round((g.part_plan / nullif(t.t_part, 0)) * t.t_reel) as plan,
           -- T6-3 : aucun pourcentage n'est definissable quand le plan vaut
           -- zero (400 CP sur 2041, 19,6 %, mesures le 2026-09-14 : plan NUL
           -- avec des impressions reelles). NULL explicite plutot qu'une
           -- division qui rendrait NULL en silence.
           case when g.part_plan > 0
                then round(((g.reel / ((g.part_plan / nullif(t.t_part,0)) * t.t_reel)) - 1) * 100, 1)
           end                                                  as ecart_pct,
           (g.part_plan = 0 and g.reel > 0)                     as hors_plan,
           -- CLE DE TRI : le volume MAL PLACE (en impressions), jamais le
           -- ratio -- ecart_pct est NULL sur ces 400 CP, et PostgreSQL trie
           -- NULL en tete en DESC : ces unites blanches auraient occupe le
           -- haut du tableau « zones les plus deregleees ». volume_deplace
           -- est defini PARTOUT, actionnable (un CP a +300 % sur 10
           -- impressions ne vaut pas un CP a +40 % sur 500 000) et
           -- convertible en euros.
           abs(g.reel - (g.part_plan / nullif(t.t_part,0)) * t.t_reel) as volume_deplace
      from groupe g cross join tot t
     order by volume_deplace desc nulls last
     limit p_limite
  ) u;

  return v_res;
end;
$$;

revoke all on function alignement_par_maille(uuid, text, text, numeric, int) from public, anon, authenticated;
grant execute on function alignement_par_maille(uuid, text, text, numeric, int) to service_role;

comment on function alignement_par_maille is
  'Agregation d alignement par maille (region/departement/cp) via la jointure INSEE reelle (jamais campaign_cp_rollup.dept). Jumeau du score CP de calculer_alignement_geo.';


-- ---------------------------------------------------------------------------
-- alignement_dispersion_cp — Tache 12. En maille CP, une courbe de 2000
-- points ne raconte rien (contrairement a la maille region/departement, ou
-- la courbe plan/reel garde un sens) : cette RPC remplace le trace par un
-- HISTOGRAMME de la dispersion des ecarts au plan, dans les 7 bandes FIXES
-- et UNIVERSELLES de `BORNES_DIVERGENTES` (lib/campagne/palette-divergente.ts)
-- -- jamais la tolerance propre a la campagne, qui reste un reglage du
-- SCORE (`calculer_alignement_geo`), pas de cette echelle de lecture.
--
-- CORRECTION apres relecture (meme defaut que T6-2 ci-dessus, dans ce meme
-- fichier) : les totaux de normalisation (tr, tp) DOIVENT etre calcules sur
-- le PERIMETRE COMPLET de la campagne (`situe`), jamais sur le seul
-- sous-ensemble filtre par `p_parent`. Verifie sur la campagne demo
-- (dccc0000-0000-4000-8000-000000000002, departement '13') : ce departement
-- ne recoit que 51,6 % de son plan national (119 160 sur 230 933 impressions
-- prevues). Calculer `tot` sur le seul departement filtre renormalise
-- mecaniquement le plan sur la livraison REELLE du departement -- la somme
-- des ecarts a l'interieur du departement vaudrait alors zero par
-- construction (98 CP se repartiraient en petits ecarts plausibles autour de
-- zero), et l'histogramme ne pourrait plus jamais montrer qu'un departement
-- ENTIER est sous-livre par rapport au plan national : exactement le defaut
-- que T6-2 corrige deja une fois plus haut dans ce fichier pour
-- `alignement_par_maille`. Avec les totaux calcules sur le perimetre
-- complet, le meme departement '13' place desormais 98 de ses 102 CP dans
-- les deux bandes de sous-pression la plus severe -- le signal qu'un
-- calcul sur le sous-ensemble filtre aurait entierement efface.
--
-- Les 400 CP a plan nul (19,6 % de la campagne demo, meme trou de donnee que
-- T6-3 pour `alignement_par_maille`) ont un ecart NULL (reel / NULL) donc un
-- `width_bucket` NULL : `group by 1` les rassemble dans UNE ligne a
-- `tranche` (et donc `borne_basse`/`borne_haute`) NULL plutot que de les
-- perdre -- ils restent comptes dans `n_cp` et `impressions`, mais hors des
-- 7 bandes numerotees. Au consommateur de decider s'il les affiche a part.
create or replace function alignement_dispersion_cp(
  p_campaign_id uuid,
  p_parent      text default null,
  p_tolerance   numeric default null  -- accepte pour la parite d'interface (Tache 12) ; les bandes de l'histogramme sont universelles (BORNES_DIVERGENTES), pas la tolerance de la campagne -- non utilise ici
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with situe as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           max(r.planned_share)::numeric as part,
           rcp.code_dept,
           rd.code_region
      from campaign_cp_rollup r
      join ref_codes_postaux rcp on rcp.code_postal = r.postal_code
      join ref_departements  rd  on rd.code_dept   = rcp.code_dept
     where r.campaign_id = p_campaign_id
     group by r.postal_code, rcp.code_dept, rd.code_region
  ),
  -- Totaux sur le PERIMETRE COMPLET -- jamais sur `filtre`. Voir commentaire ci-dessus.
  tot as (select sum(reel) tr, sum(part) tp from situe),
  filtre as (
    select * from situe
     where p_parent is null or code_dept = p_parent or code_region = p_parent
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
  'Histogramme de dispersion des ecarts au plan par CP (7 bandes fixes, BORNES_DIVERGENTES), maille CP uniquement. Totaux normalises sur le perimetre COMPLET de la campagne (meme ruling que alignement_par_maille), jamais sur le seul p_parent filtre.';

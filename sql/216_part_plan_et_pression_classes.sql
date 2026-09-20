-- sql/216 — `part_plan_pct` sur les vignettes carte, et la pression par classe
--           (2026-09-20)
--
-- ── 1. LA VIGNETTE DU MILIEU DOIT MONTRER LE PLAN ────────────────────────
--
-- `alignement_par_maille_geo` rend `variable_valeur` : la valeur d'un
-- indicateur INSEE par unite. C'est ce qui a servi a BATIR le plan — quand
-- le plan vient d'un indicateur.
--
-- Un plan bati sur un JEU DE ZONES n'a aucun indicateur derriere lui. La
-- route retombait alors sur `abstention_pres_2022`, affichee sous le titre
-- « la variable qui a servi a batir le plan ». Un ecran qui nomme faux est
-- pire qu'un ecran muet.
--
-- La fonction rend desormais AUSSI `part_plan_pct`. Ce n'est pas un proxy du
-- plan, c'est le plan.
--
-- ⚠ AJOUT PUREMENT ADDITIF : signature inchangee, `variable_valeur` toujours
-- rendue, meme champ dans les trois branches (region / departement / cp).
--
-- ⚠ Le defaut `p_variable_code text DEFAULT 'abstention_pres_2022'` est
-- CONSERVE tel quel. Il est inerte — la route passe toujours la valeur
-- explicitement — et le changer modifierait le comportement de tout appel
-- qui omettrait l'argument, ce qu'aucune mesure ne justifie ici.

CREATE OR REPLACE FUNCTION public.alignement_par_maille_geo(p_campaign_id uuid, p_maille text DEFAULT 'departement'::text, p_parent text DEFAULT NULL::text, p_tolerance numeric DEFAULT NULL::numeric, p_variable_code text DEFAULT 'abstention_pres_2022'::text, p_bbox_xmin double precision DEFAULT '-5.5'::numeric, p_bbox_ymin double precision DEFAULT 41.2, p_bbox_xmax double precision DEFAULT 9.8, p_bbox_ymax double precision DEFAULT 51.2, p_limite integer DEFAULT 3000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tol             numeric;
  v_xmin            float8;
  v_ymin            float8;
  v_xmax            float8;
  v_ymax            float8;
  v_tolerance_geom  numeric;
  v_res             jsonb;
begin
  if p_maille not in ('region', 'departement', 'cp') then
    raise exception 'maille inconnue: %', p_maille;
  end if;

  select coalesce(p_tolerance, c.tolerance_pct) / 100.0 into v_tol
    from dsp_campaigns c where c.id = p_campaign_id;
  if v_tol is null then return jsonb_build_object('error', 'campagne_introuvable'); end if;

  -- T13A-1 : bbox absente OU explicitement NULL -> repli sur la bbox
  -- metropolitaine standard du depot (meme defaut que `suivi/map`).
  v_xmin := coalesce(p_bbox_xmin, -5.5);
  v_ymin := coalesce(p_bbox_ymin, 41.2);
  v_xmax := coalesce(p_bbox_xmax, 9.8);
  v_ymax := coalesce(p_bbox_ymax, 51.2);

  -- T13A-1 : tolerance de simplification DERIVEE DE L'ETENDUE DE LA BBOX,
  -- jamais une constante. Voir commentaire au-dessus de la fonction.
  v_tolerance_geom := greatest((v_xmax - v_xmin) / 1000.0, 0.0001);

  -- T13A-3 (relecture, 2026-09-15) : trois formes de requete, UNE PAR MAILLE,
  -- chacune avec une VRAIE jointure vers sa table de geometrie -- remplace une
  -- sous-requete scalaire CORRELEE par ligne dans un `CASE p_maille WHEN ...`.
  -- p_maille est CONSTANT pour tout l'appel, mais un `CASE` contenant une
  -- sous-requete correlee sur `g.code` empeche Postgres de la replier en
  -- jointure ensembliste : il execute un sous-plan PAR TUPLE. Mesure avant
  -- correctif : 13 lignes/86,8 ms, 96 lignes/137,5 ms, 1879 lignes/972,8 ms --
  -- ~0,45 ms/ligne, lineaire, la courbe d'une boucle et non d'une jointure.
  -- Les cinq CTE (cp/situe/filtre/tot/groupe) sont dupliquees dans les trois
  -- branches plutot que factorisees : c'est le prix de laisser Postgres choisir
  -- une jointure par hachage/index sur l'ensemble plutot qu'une boucle.
  --
  -- CORRECTION APRES MESURE (meme passe) : remplacer la sous-requete par une
  -- jointure NE SUFFISAIT PAS -- rejoue seule, la jointure ne gagnait rien
  -- (972,8 -> 975,6 ms). Cause reelle : `geom_raw` (ST_Simplify appliquee a
  -- `geom_simplified`, une colonne large) est referencee TROIS FOIS en aval
  -- (le `select` GeoJSON, le filtre `is not null`, le filtre `&&` bbox) --
  -- et une CTE non MATERIALIZED est INLINEE depuis PG12 : Postgres recalculait
  -- ST_Simplify a CHACUNE des trois references, PAR LIGNE (confirme par
  -- EXPLAIN : `Filter` contenait deux appels `st_simplify(...)` litteraux et
  -- 3 `SubPlan`/`Index Scan ... loops=~2000` distincts). Meme defaut, memes
  -- symptomes, que celui deja rencontre sur le Voronoi de ce depot. `avecgeom`
  -- est donc `MATERIALIZED` : ST_Simplify s'execute UNE SEULE FOIS par ligne,
  -- le resultat est reutilise aux trois references. Mesure : 625 -> 62 ms en
  -- SQL nu (~10x), la jointure du T13A-3 n'etant utile qu'AVEC ce blocage.
  if p_maille = 'cp' then
    with cp as (
      -- Sommer sur les acteurs AVANT tout calcul : la PK de campaign_cp_rollup
      -- est (campaign_id, postal_code, actor), un CP apparait jusqu a 5 fois.
      select r.postal_code,
             sum(r.impressions)::numeric   as reel,
             max(r.planned_share)::numeric as part_plan
        from campaign_cp_rollup r
       where r.campaign_id = p_campaign_id
       group by r.postal_code
    ),
    -- Jointure INSEE reelle + variable du plan. JAMAIS `campaign_cp_rollup.dept`.
    situe as (
      select cp.*, rcp.code_dept, rd.nom_dept,
             coalesce(rd.code_region, 'HORS')       as code_region,
             coalesce(rr.nom_region, 'Hors region') as nom_region,
             icv.value as variable_valeur
        from cp
        join ref_codes_postaux rcp on rcp.code_postal = cp.postal_code
        join ref_departements  rd  on rd.code_dept   = rcp.code_dept
        left join ref_regions  rr  on rr.code_region = rd.code_region
        left join indicator_cp_values icv
               on icv.postal_code = cp.postal_code and icv.indicator_code = p_variable_code
    ),
    filtre as (
      select * from situe where p_parent is null or code_dept = p_parent
    ),
    -- Totaux sur le PERIMETRE COMPLET (`situe`), jamais sur `filtre` -- meme
    -- ruling T6-2 que `alignement_par_maille` plus haut dans ce fichier.
    tot as (select sum(reel) t_reel, sum(part_plan) t_part from situe),
    groupe as (
      select postal_code as code, max(postal_code) as nom,
             sum(reel) as reel, sum(part_plan) as part_plan,
             avg(variable_valeur) as variable_valeur
        from filtre
       group by 1
    ),
    -- Vraie jointure ensembliste (T13A-3) + MATERIALIZED : sans lui, la CTE est
    -- inlinee (PG12+) et ST_Simplify(geom_raw) est recalculee a chacune des
    -- trois references en aval (select GeoJSON + 2 filtres) -- voir le
    -- commentaire au-dessus de l'aiguillage `if p_maille = ...`.
    avecgeom as materialized (
      select g.code, g.nom, g.reel, g.part_plan, g.variable_valeur, t.t_reel, t.t_part,
             ST_Simplify(rcp2.geom_simplified, v_tolerance_geom) as geom_raw
        from groupe g
        cross join tot t
        join ref_codes_postaux rcp2 on rcp2.code_postal = g.code
    )
    select jsonb_build_object(
      'maille', p_maille,
      'parent', p_parent,
      'variable_code', p_variable_code,
      'n_total', (select count(*) from groupe),
      'features', coalesce(jsonb_agg(u.feature order by u.tri desc nulls last), '[]'::jsonb)
    ) into v_res
    from (
      select
        jsonb_build_object(
          'code', x.code,
          'nom', x.nom,
          'impressions', x.reel::bigint,
          'ecart_pct', case when x.part_plan > 0
            then round(((x.reel / ((x.part_plan / nullif(x.t_part,0)) * x.t_reel)) - 1) * 100, 1)
          end,
          'hors_plan', (x.part_plan = 0 and x.reel > 0),
          -- La PART DU PLAN de l'unite, en pourcentage du plan total.
          -- C'est le plan LUI-MEME, et non un indicateur qui l'approche.
          -- Denominateur = le PERIMETRE COMPLET (`t_part`), jamais le seul
          -- parent filtre : meme ruling que T6-2, sinon la somme des parts
          -- vaudrait 100 dans chaque drill-down et aucun departement ne
          -- pourrait plus apparaitre sous ou sur-livre.
          'part_plan_pct', round(100 * x.part_plan / nullif(x.t_part, 0), 3),
          'variable_valeur', round(x.variable_valeur, 2),
          'geometry', ST_AsGeoJSON(x.geom_raw)::jsonb
        ) as feature,
        abs(x.reel - (x.part_plan / nullif(x.t_part,0)) * x.t_reel) as tri
        from avecgeom x
       where x.geom_raw is not null
         and x.geom_raw && ST_MakeEnvelope(v_xmin, v_ymin, v_xmax, v_ymax, 4326)
       order by tri desc nulls last
       limit p_limite
    ) u;

  elsif p_maille = 'region' then
    with cp as (
      select r.postal_code,
             sum(r.impressions)::numeric   as reel,
             max(r.planned_share)::numeric as part_plan
        from campaign_cp_rollup r
       where r.campaign_id = p_campaign_id
       group by r.postal_code
    ),
    situe as (
      select cp.*, rcp.code_dept, rd.nom_dept,
             coalesce(rd.code_region, 'HORS')       as code_region,
             coalesce(rr.nom_region, 'Hors region') as nom_region,
             icv.value as variable_valeur
        from cp
        join ref_codes_postaux rcp on rcp.code_postal = cp.postal_code
        join ref_departements  rd  on rd.code_dept   = rcp.code_dept
        left join ref_regions  rr  on rr.code_region = rd.code_region
        left join indicator_cp_values icv
               on icv.postal_code = cp.postal_code and icv.indicator_code = p_variable_code
    ),
    -- Region est la racine de la hierarchie : aucun `p_parent` valide ne la
    -- filtre (garde 400 deja cote route, T6-4) -- si p_parent est neanmoins
    -- fourni, `filtre` est VIDE, meme comportement que la version precedente
    -- (l'ancien `CASE` ne matchait aucune branche pour la maille 'region').
    filtre as (
      select * from situe where p_parent is null
    ),
    tot as (select sum(reel) t_reel, sum(part_plan) t_part from situe),
    groupe as (
      select code_region as code, max(nom_region) as nom,
             sum(reel) as reel, sum(part_plan) as part_plan,
             avg(variable_valeur) as variable_valeur
        from filtre
       group by 1
    ),
    -- Vraie jointure ensembliste (T13A-3). INNER JOIN : un `code_region`
    -- synthetique 'HORS' (PV-2, DROM sans region de rattachement) n'a pas de
    -- ligne dans `ref_regions` et disparait ici -- meme resultat net que
    -- l'ancien filtre `geom_raw is not null`, qui l'excluait deja en aval.
    -- MATERIALIZED : sans lui, la CTE est inlinee (PG12+) et ST_Simplify est
    -- recalculee a chacune des trois references en aval -- voir le
    -- commentaire au-dessus de l'aiguillage `if p_maille = ...`.
    avecgeom as materialized (
      select g.code, g.nom, g.reel, g.part_plan, g.variable_valeur, t.t_reel, t.t_part,
             ST_Simplify(rr2.geom, v_tolerance_geom) as geom_raw
        from groupe g
        cross join tot t
        join ref_regions rr2 on rr2.code_region = g.code
    )
    select jsonb_build_object(
      'maille', p_maille,
      'parent', p_parent,
      'variable_code', p_variable_code,
      'n_total', (select count(*) from groupe),
      'features', coalesce(jsonb_agg(u.feature order by u.tri desc nulls last), '[]'::jsonb)
    ) into v_res
    from (
      select
        jsonb_build_object(
          'code', x.code,
          'nom', x.nom,
          'impressions', x.reel::bigint,
          'ecart_pct', case when x.part_plan > 0
            then round(((x.reel / ((x.part_plan / nullif(x.t_part,0)) * x.t_reel)) - 1) * 100, 1)
          end,
          'hors_plan', (x.part_plan = 0 and x.reel > 0),
          -- La PART DU PLAN de l'unite, en pourcentage du plan total.
          -- C'est le plan LUI-MEME, et non un indicateur qui l'approche.
          -- Denominateur = le PERIMETRE COMPLET (`t_part`), jamais le seul
          -- parent filtre : meme ruling que T6-2, sinon la somme des parts
          -- vaudrait 100 dans chaque drill-down et aucun departement ne
          -- pourrait plus apparaitre sous ou sur-livre.
          'part_plan_pct', round(100 * x.part_plan / nullif(x.t_part, 0), 3),
          'variable_valeur', round(x.variable_valeur, 2),
          'geometry', ST_AsGeoJSON(x.geom_raw)::jsonb
        ) as feature,
        abs(x.reel - (x.part_plan / nullif(x.t_part,0)) * x.t_reel) as tri
        from avecgeom x
       where x.geom_raw is not null
         and x.geom_raw && ST_MakeEnvelope(v_xmin, v_ymin, v_xmax, v_ymax, 4326)
       order by tri desc nulls last
       limit p_limite
    ) u;

  else -- 'departement'
    with cp as (
      select r.postal_code,
             sum(r.impressions)::numeric   as reel,
             max(r.planned_share)::numeric as part_plan
        from campaign_cp_rollup r
       where r.campaign_id = p_campaign_id
       group by r.postal_code
    ),
    situe as (
      select cp.*, rcp.code_dept, rd.nom_dept,
             coalesce(rd.code_region, 'HORS')       as code_region,
             coalesce(rr.nom_region, 'Hors region') as nom_region,
             icv.value as variable_valeur
        from cp
        join ref_codes_postaux rcp on rcp.code_postal = cp.postal_code
        join ref_departements  rd  on rd.code_dept   = rcp.code_dept
        left join ref_regions  rr  on rr.code_region = rd.code_region
        left join indicator_cp_values icv
               on icv.postal_code = cp.postal_code and icv.indicator_code = p_variable_code
    ),
    filtre as (
      select * from situe where p_parent is null or code_region = p_parent
    ),
    tot as (select sum(reel) t_reel, sum(part_plan) t_part from situe),
    groupe as (
      select code_dept as code, max(nom_dept) as nom,
             sum(reel) as reel, sum(part_plan) as part_plan,
             avg(variable_valeur) as variable_valeur
        from filtre
       group by 1
    ),
    -- Vraie jointure ensembliste (T13A-3) + MATERIALIZED : sans lui, la CTE est
    -- inlinee (PG12+) et ST_Simplify(geom_raw) est recalculee a chacune des
    -- trois references en aval (select GeoJSON + 2 filtres) -- voir le
    -- commentaire au-dessus de l'aiguillage `if p_maille = ...`.
    avecgeom as materialized (
      select g.code, g.nom, g.reel, g.part_plan, g.variable_valeur, t.t_reel, t.t_part,
             ST_Simplify(rd2.geom, v_tolerance_geom) as geom_raw
        from groupe g
        cross join tot t
        join ref_departements rd2 on rd2.code_dept = g.code
    )
    select jsonb_build_object(
      'maille', p_maille,
      'parent', p_parent,
      'variable_code', p_variable_code,
      'n_total', (select count(*) from groupe),
      'features', coalesce(jsonb_agg(u.feature order by u.tri desc nulls last), '[]'::jsonb)
    ) into v_res
    from (
      select
        jsonb_build_object(
          'code', x.code,
          'nom', x.nom,
          'impressions', x.reel::bigint,
          'ecart_pct', case when x.part_plan > 0
            then round(((x.reel / ((x.part_plan / nullif(x.t_part,0)) * x.t_reel)) - 1) * 100, 1)
          end,
          'hors_plan', (x.part_plan = 0 and x.reel > 0),
          -- La PART DU PLAN de l'unite, en pourcentage du plan total.
          -- C'est le plan LUI-MEME, et non un indicateur qui l'approche.
          -- Denominateur = le PERIMETRE COMPLET (`t_part`), jamais le seul
          -- parent filtre : meme ruling que T6-2, sinon la somme des parts
          -- vaudrait 100 dans chaque drill-down et aucun departement ne
          -- pourrait plus apparaitre sous ou sur-livre.
          'part_plan_pct', round(100 * x.part_plan / nullif(x.t_part, 0), 3),
          'variable_valeur', round(x.variable_valeur, 2),
          'geometry', ST_AsGeoJSON(x.geom_raw)::jsonb
        ) as feature,
        abs(x.reel - (x.part_plan / nullif(x.t_part,0)) * x.t_reel) as tri
        from avecgeom x
       where x.geom_raw is not null
         and x.geom_raw && ST_MakeEnvelope(v_xmin, v_ymin, v_xmax, v_ymax, 4326)
       order by tri desc nulls last
       limit p_limite
    ) u;
  end if;

  return v_res;
end;
$function$

;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA PRESSION PAR CLASSE DE ZONE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- « La campagne presse-t-elle plus, ou moins, les abords des sites classes
-- que le plan ne le prevoyait ? »
--
-- ── L'INDICE ─────────────────────────────────────────────────────────────
--
-- Part des impressions rapportee a la part du PLAN, x100.
--   100 -> la classe recoit exactement ce que le plan lui destinait ;
--   150 -> la moitie en plus ;
--    60 -> 40 % de moins.
--
-- ⚠ Le denominateur est le PLAN, et non la population. L'onglet Diffusion
-- supprime le meme jour comparait a la population, faute de plan : c'etait la
-- seule reponse possible alors, mais elle melange deux questions — « la zone
-- est-elle sur-pressee par rapport a son poids demographique ? » et « la
-- campagne tient-elle son plan ? ». Seule la seconde est actionnable : on ne
-- corrige pas une demographie, on corrige une enchere.
--
-- ── AUCUNE VENTILATION ───────────────────────────────────────────────────
--
-- Les deux tables sont au MEME grain, le code postal : `campaign_cp_rollup`
-- pour la diffusion, `zone_set_cp` pour la classe. Pas de prorata, pas
-- d'hypothese de repartition a l'interieur d'un code postal. C'est ce qui
-- rend ce bloc plus juste que ce qu'il remplace, et non seulement moins cher.
--
-- ⚠ `campaign_cp_rollup` a pour cle (campagne, code postal, ACTEUR) : un code
-- postal y apparait jusqu'a cinq fois. Les impressions sont donc SOMMEES et
-- la part de plan prise au `max` — c'est une propriete du code postal, pas de
-- l'acteur. Meme regle que `calculer_alignement_geo`.

create or replace function public.pression_par_classe(
  p_campaign_id uuid,
  p_zone_set_id uuid
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_res jsonb;
begin
  if not exists (select 1 from public.zone_sets where id = p_zone_set_id) then
    return jsonb_build_object('error', 'jeu_introuvable', 'calculable', false);
  end if;

  with cp as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           sum(r.spend)::numeric         as depense,
           max(r.planned_share)::numeric as part_plan
      from public.campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  -- `left join` et non `join` : un code postal qui a recu des impressions
  -- SANS appartenir au jeu doit apparaitre, c'est meme le chiffre que
  -- l'ecran doit montrer en premier — ce qui a diffuse hors zone.
  joint as (
    select c.postal_code, c.reel, c.depense, coalesce(c.part_plan, 0) as part_plan,
           coalesce(z.classe, 'hors') as classe,
           coalesce(z.retenu, false) as retenu
      from cp c
      left join public.zone_set_cp z
        on z.zone_set_id = p_zone_set_id and z.code_postal = c.postal_code
  ),
  tot as (select sum(reel) t_reel, sum(part_plan) t_plan, sum(depense) t_eur from joint),
  par_classe as (
    select j.classe,
           count(*)             as n_cp,
           sum(j.reel)          as reel,
           sum(j.depense)       as depense,
           sum(j.part_plan)     as part_plan,
           count(*) filter (where j.retenu) as n_cp_retenus
      from joint j group by j.classe
  )
  select jsonb_build_object(
    'calculable', true,
    'impressions_totales', (select round(t_reel) from tot),
    'depense_totale', (select round(t_eur, 2) from tot),
    'n_cp', (select count(*) from joint),
    -- Ce qui a diffuse en dehors du jeu de zones. Le chiffre que l'ecran doit
    -- montrer en premier : une campagne peut tenir son plan classe par classe
    -- et avoir verse l'essentiel de son budget ailleurs.
    'part_hors_zone_pct', (
      select round(100 * coalesce(sum(reel) filter (where classe = 'hors'), 0)
                   / nullif((select t_reel from tot), 0), 1) from joint),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'classe', c.classe,
        'n_cp', c.n_cp,
        'n_cp_retenus', c.n_cp_retenus,
        'impressions', round(c.reel),
        'depense', round(c.depense, 2),
        'part_impressions_pct', round(100 * c.reel / nullif(t.t_reel, 0), 2),
        'part_plan_pct', round(100 * c.part_plan / nullif(t.t_plan, 0), 2),
        -- `null` et NON zero quand la classe n'a aucun plan : un indice
        -- incalculable n'est pas un indice nul. Zero se lirait « la campagne
        -- ignore completement cette classe », alors que la verite est « le
        -- plan ne lui destinait rien, il n'y a rien a comparer ».
        'indice', case when c.part_plan > 0 and t.t_plan > 0 and t.t_reel > 0
          then round((c.reel / t.t_reel) / (c.part_plan / t.t_plan) * 100, 1)
          else null end,
        'cpm', case when c.reel > 0
          then round(c.depense / c.reel * 1000, 2) else null end
      ) order by c.part_plan desc, c.reel desc)
      from par_classe c cross join tot t), '[]'::jsonb)
  ) into v_res;

  -- Une campagne sans diffusion ne rend PAS un tableau de zeros : elle rend
  -- « pas calculable ». Des indices a zero se liraient comme une campagne
  -- catastrophique, alors qu'il n'y a simplement rien a mesurer.
  if coalesce((v_res ->> 'impressions_totales')::numeric, 0) <= 0 then
    return jsonb_build_object('error', 'aucune_donnee', 'calculable', false);
  end if;

  return v_res;
end;
$fn$;

comment on function public.pression_par_classe is
  'Part des impressions contre part du PLAN, par classe de zone. Aucune '
  'ventilation : campaign_cp_rollup et zone_set_cp sont au meme grain, le code '
  'postal. L''indice est null et jamais zero quand la classe n''a pas de plan — '
  'un indice incalculable n''est pas un indice nul.';

revoke all on function public.pression_par_classe(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pression_par_classe(uuid, uuid) to service_role;

-- ============================================================================
-- sql/172_alignement_cas_degenere.sql — 2026-09-15
--
-- Le score d'alignement sur une campagne SANS DONNEES DE DIFFUSION.
--
-- Mesure en base avant correctif, campagne 441caa70-… (0 ligne dans
-- `campaign_cp_rollup`) :
--
--   {"n_cp":0,"score":0,"conformes_pct":null,"score_prev_7j":0,
--    "depense_totale":null,"sur_pression_pct":null,"sous_pression_pct":null,
--    "impressions_totales":null, …}
--
-- Deux defauts distincts dans cette seule sortie.
--
-- ── 1. « 0 / 100 » est un verdict INVENTE ─────────────────────────────────
-- Aucune campagne n'a un alignement de 0 parce qu'elle n'a pas encore
-- diffuse : le vrai verdict est « pas calculable ». Le 0 vient d'un accident
-- d'agregation — `greatest(0, round(100 - NULL - NULL))` vaut 0, GREATEST
-- ignorant les NULL — et non d'un calcul. Un media planner qui ouvre l'onglet
-- Suivi d'une campagne creee le matin lisait « alignement catastrophique ».
--
-- Le jumeau TypeScript (`lib/campagne/alignement.ts`) rendait 100 pour la
-- MEME entree. Aucun des deux n'avait raison, et ARCHITECTURE.md affirmait
-- « accord exact » entre les jumeaux : vrai du chemin nominal (verifie sur la
-- campagne demo, 2041 CP, score 93 des deux cotes), faux du cas degenere —
-- celui qu'un jumeau sert justement a cadrer.
--
-- L'intention etait DEJA ecrite dans sql/165 : la derniere ligne du corps est
-- `return coalesce(v_res, jsonb_build_object('error', 'aucune_donnee'))`.
-- Elle ne se declenchait jamais, parce qu'une agregation sur un ensemble vide
-- rend UNE ligne de NULL, jamais zero ligne : `v_res` n'etait donc jamais
-- NULL. Le correctif teste ce qui compte reellement — aucun CP, ou aucune
-- impression a repartir — plutot que la non-nullite d'un objet JSON toujours
-- construit.
--
-- ── 2. Cinq champs types `number` recevaient `null` ───────────────────────
-- `conformes_pct`, `impressions_totales`, `depense_totale`,
-- `sous_pression_pct` et `sur_pression_pct` sont declares `number` cote
-- client (`ReponseAlignement`). La RPC rendait `null` pour les cinq, et le
-- compilateur avait ete convaincu qu'ils ne pouvaient pas manquer : toute
-- arithmetique dessus produisait `NaN` sans qu'aucune garde ne le voie.
--
-- Le garde-fou du point 1 en ferme quatre par construction (ils ne sont NULL
-- que quand `n_cp = 0` ou `t_reel = 0`, cas desormais rendu comme une erreur
-- metier). Le cinquieme, `depense_totale`, pouvait rester NULL MEME AVEC DES
-- DONNEES — une campagne dont aucune ligne ne porte de `spend` : il est
-- desormais `coalesce(…, 0)`. Zero euro enregistre, c'est ce que la base sait.
--
-- ── 3. « +93 points en 7 jours » sur une campagne d'une semaine ───────────
-- Meme famille : `score_prev_7j` retombait a 0 quand la fenetre precedente
-- etait vide (`t_prev` NULL ou 0, meme accident `greatest(0, NULL)`), et la
-- route derivait `variation_7j = score - 0`, soit une progression fabriquee
-- de toutes pieces le jour ou il n'y a rien a comparer. Le payload porte
-- desormais `prev_7j_calculable` ; la route n'emet `variation_7j` que s'il
-- est vrai. `score_prev_7j` reste un nombre (0), pour ne pas rouvrir le
-- defaut 2 sur un champ que personne ne lit.
--
-- ⚠ Le CALCUL NOMINAL est inchange, a la virgule : memes CTE, memes filtres,
-- memes arrondis, meme garde-fou `plan_divergent`. Verifie apres application
-- sur la campagne demo — score 93, conformes 72,5 %, sous 150 971, sur
-- 132 000, n_cp 2041, identiques a la mesure du 2026-09-14.
-- ============================================================================

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
    -- sql/172 : jamais NULL dans un champ declare `number` cote client. Une
    -- campagne dont aucune ligne ne porte de `spend` a 0 euro enregistre.
    'depense_totale',      coalesce(t.t_dep, 0),
    'score', greatest(0, round(100
      - coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100
      - v_poids * coalesce(a.trop, 0) / nullif(t.t_reel, 0) * 100)),
    'score_prev_7j', greatest(0, round(100
      - coalesce(a.manque_prev, 0) / nullif(t.t_prev, 0) * 100
      - v_poids * coalesce(a.trop_prev, 0) / nullif(t.t_prev, 0) * 100)),
    -- sql/172 : la fenetre precedente existe-t-elle ? Sans ce drapeau, une
    -- campagne d'une semaine (t_prev vide) voyait `score_prev_7j` retomber a
    -- 0 par le meme accident `greatest(0, NULL)`, et la route annoncait une
    -- progression de tout le score « en 7 jours », fabriquee de toutes pieces.
    'prev_7j_calculable',  coalesce(t.t_prev, 0) > 0,
    -- Pas de division a faire : `n_cp > 0` et `t_reel > 0` sont garantis par
    -- le garde-fou ci-dessous. Le drapeau existe pour que l'appelant n'ait
    -- pas a rededuire la calculabilite de l'absence de champs.
    'calculable',          true
  ) into v_res
  from agg a cross join tot t;

  -- sql/172 : « pas calculable » n'est pas « 0 ». Une agregation sur un
  -- ensemble vide rend UNE ligne de NULL (jamais zero ligne), donc `v_res`
  -- n'etait jamais NULL et le `coalesce` final de sql/165 ne se declenchait
  -- jamais. On teste ce qui compte : aucun code postal en rollup, ou aucune
  -- impression a repartir entre eux.
  if v_res is null
     or coalesce((v_res ->> 'n_cp')::int, 0) = 0
     or coalesce((v_res ->> 'impressions_totales')::numeric, 0) <= 0
  then
    return jsonb_build_object(
      'error', 'aucune_donnee',
      'calculable', false,
      'n_cp', coalesce((v_res ->> 'n_cp')::int, 0)
    );
  end if;

  return v_res;
end;
$$;

revoke all on function calculer_alignement_geo(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function calculer_alignement_geo(uuid, numeric, numeric) to service_role;

comment on function calculer_alignement_geo is
  'Score d alignement geographique 0-100, TOUJOURS calcule au code postal. Jumeau TS : lib/campagne/alignement.ts. sql/172 : une campagne sans donnees de diffusion rend {error: aucune_donnee, calculable: false} — jamais un score de 0, qui venait d un greatest(0, NULL) et non d un calcul. Aucun des champs numeriques du payload calculable n est NULL.';

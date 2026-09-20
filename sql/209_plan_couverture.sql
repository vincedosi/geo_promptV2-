-- sql/209 — « Pas de plan » n'est pas « plan parfaitement tenu »
--           (2026-09-20)
--
-- Corrige `calculer_alignement_geo` (sql/165, corrigée sql/172), qui rendait
-- **score 100 sur une campagne sans aucun plan**.
--
-- ── LE DÉFAUT, LIGNE À LIGNE ──────────────────────────────────────────────
--
-- Avec `planned_share` NULL sur tous les codes postaux :
--
--     part_plan = max(planned_share)                    -- NULL
--     t_part    = sum(part_plan)                        -- NULL
--     plan_imps = (part_plan / nullif(t_part,0)) * reel -- NULL
--
--     manque = sum(...) FILTER (WHERE plan_imps > 0)
--              -- prédicat NULL → AUCUNE ligne → NULL → coalesce → 0
--     trop   = sum(greatest(0, reel - plan_imps*(1+tol)))
--              -- ⚠ GREATEST IGNORE les NULL : greatest(0, NULL) = 0
--
--     score = 100 - 0 - 0 = 100
--
-- **Zéro écart à un plan qui n'existe pas.** Les deux `coalesce(…, 0)` sont
-- corrects pris isolément — ils protègent du cas « aucune sous-pression » —
-- mais ensemble ils transforment « incalculable » en « parfait ».
--
-- Le garde-fou de sql/172 teste `n_cp = 0` et `impressions_totales <= 0`.
-- Mesuré le 2026-09-20 sur la campagne de démonstration : 2 000 CP et
-- 1 196 332 538 impressions. Les deux conditions sont fausses, et la fonction
-- se déclarait `calculable: true`.
--
-- La contradiction était déjà LISIBLE dans le payload : `score: 100` et
-- `conformes_pct: 0.0`. Un score parfait suppose tous les CP conformes ; zéro
-- conforme suppose un score nul. C'est cet invariant que
-- `tests/unit/campagne/alignement-plan.test.ts` verrouille désormais.
--
-- ── DEUX CAS, ET ILS NE SE TRAITENT PAS PAREIL ────────────────────────────
--
-- **Couverture NULLE** — aucun code postal ne porte de plan. Il n'y a pas de
-- score à rendre : ni 0 ni 100, mais « non calculable », avec la raison.
-- Rendre 0 serait aussi trompeur que rendre 100 : cela se lirait « campagne
-- catastrophique » là où il faut lire « campagne sans plan ».
--
-- **Couverture PARTIELLE** — une partie des codes postaux a un plan, l'autre
-- non. Le score reste calculable, mais le volume parti sur des codes postaux
-- HORS PLAN compte EN TOTALITÉ en sur-pression : ces impressions n'étaient
-- prévues nulle part.
--
-- ⚠ Ce n'est pas une invention : c'est déjà la règle du jumeau TypeScript
-- `lib/campagne/alignement.ts`, dont le commentaire dit « la sur-pression
-- reste mesurable : du volume y est bien parti », et c'est le **ruling T11-2**
-- que `ARCHITECTURE.md` documente pour `alignement/constats` (« compte aussi
-- EN TOTALITÉ les unités hors_plan »).
--
-- Les deux implémentations DIVERGEAIENT donc sur ce cas : le TypeScript
-- rendait 0, le SQL rendait 100, et `ARCHITECTURE.md` affirmait leur accord
-- « sur le chemin nominal et sur le cas dégénéré ». Ce cas-ci — des unités,
-- des impressions, mais aucun plan — n'avait jamais été croisé.
--
-- ── CE QUI NE CHANGE PAS ──────────────────────────────────────────────────
--
-- La sous-pression garde son `FILTER (WHERE plan_imps > 0)` : une unité sans
-- plan ne peut pas être « en retard sur son plan ». Seule la sur-pression est
-- mesurable pour elle.
--
-- Vérifié après migration sur la campagne élections (plan complet) : score 93,
-- conformes 72,5 %, 2 041 CP — identiques à la mesure du 2026-09-14.

create or replace function public.calculer_alignement_geo(
  p_campaign_id uuid,
  p_tolerance   numeric default null,
  p_poids       numeric default null
) returns jsonb
language plpgsql stable parallel safe security definer set search_path to 'public' as $fn$
declare
  v_tol       numeric;
  v_poids     numeric;
  v_divergent boolean;
  v_res       jsonb;
begin
  select coalesce(p_tolerance, c.tolerance_pct) / 100.0,
         coalesce(p_poids, c.overpressure_weight)
    into v_tol, v_poids
    from public.dsp_campaigns c
   where c.id = p_campaign_id;

  if v_tol is null then
    return jsonb_build_object('error', 'campagne_introuvable', 'calculable', false);
  end if;

  -- Garde-fou de sql/165 : `planned_share` est censé être une propriété du
  -- seul CODE POSTAL. S'il diffère entre acteurs d'un même CP, le moyenner en
  -- silence rendrait un score faux sans le signaler.
  select exists (
    select 1 from public.campaign_cp_rollup
     where campaign_id = p_campaign_id
     group by postal_code
    having count(distinct planned_share) > 1
  ) into v_divergent;

  with cp as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           sum(r.imps_prev7d)::numeric   as reel_prev,
           max(r.planned_share)::numeric as part_plan,
           sum(r.spend)::numeric         as depense
      from public.campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  tot as (
    select sum(reel) t_reel, sum(reel_prev) t_prev, sum(depense) t_dep,
           sum(part_plan) t_part,
           count(*) n_total,
           -- LA COUVERTURE DU PLAN : combien de codes postaux en portent un.
           -- C'est la troisième condition qui manquait au garde-fou.
           count(*) filter (where part_plan is not null and part_plan > 0) n_plan
      from cp
  ),
  calc as (
    select cp.postal_code,
           cp.reel, cp.reel_prev, cp.depense,
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_reel as plan_imps,
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_prev as plan_imps_prev
      from cp cross join tot t
  ),
  agg as (
    select
      -- Une unité SANS plan ne peut pas être « en retard sur son plan ».
      sum(greatest(0, plan_imps * (1 - v_tol) - reel)) filter (where plan_imps > 0) as manque,
      -- ⚠ `coalesce(plan_imps, 0)` et non `plan_imps` : sans lui,
      -- `greatest(0, reel - NULL)` vaut 0 et le volume parti sur un code postal
      -- hors plan disparaît du calcul. Il doit compter EN TOTALITÉ — ces
      -- impressions n'étaient prévues nulle part. Même règle que le jumeau
      -- TypeScript et que le ruling T11-2 d'`alignement/constats`.
      sum(greatest(0, reel - coalesce(plan_imps, 0) * (1 + v_tol)))                 as trop,
      count(*) filter (
        where plan_imps > 0
          and reel between plan_imps * (1 - v_tol) and plan_imps * (1 + v_tol)
      ) as conformes,
      count(*) as n_cp,
      sum(greatest(0, plan_imps_prev * (1 - v_tol) - reel_prev)) filter (where plan_imps_prev > 0) as manque_prev,
      sum(greatest(0, reel_prev - coalesce(plan_imps_prev, 0) * (1 + v_tol)))                      as trop_prev,
      sum(greatest(0, reel - coalesce(plan_imps, 0) * (1 + v_tol)) / nullif(reel, 0) * depense)    as eur_deplacables
      from calc
  )
  select jsonb_build_object(
    'maille_calcul',       'cp',
    'tolerance_pct',       round(v_tol * 100, 2),
    'overpressure_weight', v_poids,
    'plan_divergent',      v_divergent,
    'n_cp',                a.n_cp,
    -- Combien de codes postaux portent un plan, et quelle part cela fait. Un
    -- score calculé sur 12 % des codes postaux touchés n'a pas la même valeur
    -- qu'un score calculé sur 100 % : l'écran doit pouvoir le dire.
    'n_cp_plan',           t.n_plan,
    'plan_couverture_pct', round((t.n_plan::numeric / nullif(t.n_total, 0)) * 100, 1),
    'conformes_pct',       round((a.conformes::numeric / nullif(a.n_cp, 0)) * 100, 1),
    'sous_pression_imps',  round(coalesce(a.manque, 0)),
    'sur_pression_imps',   round(coalesce(a.trop, 0)),
    'sous_pression_pct',   round(coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_pct',    round(coalesce(a.trop, 0)   / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_eur',    round(coalesce(a.eur_deplacables, 0), 2),
    'impressions_totales', t.t_reel,
    'depense_totale',      coalesce(t.t_dep, 0),
    'score', greatest(0, round(100
      - coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100
      - v_poids * coalesce(a.trop, 0) / nullif(t.t_reel, 0) * 100)),
    'score_prev_7j', greatest(0, round(100
      - coalesce(a.manque_prev, 0) / nullif(t.t_prev, 0) * 100
      - v_poids * coalesce(a.trop_prev, 0) / nullif(t.t_prev, 0) * 100)),
    'prev_7j_calculable',  coalesce(t.t_prev, 0) > 0,
    'calculable',          true
  ) into v_res
  from agg a cross join tot t;

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

  -- LA TROISIÈME CONDITION. Aucun code postal ne porte de plan : il n'y a pas
  -- de score à rendre. Ni 0 ni 100 — « non calculable », avec la raison.
  -- Rendre 0 serait aussi trompeur que rendre 100 : cela se lirait « campagne
  -- catastrophique » là où il faut lire « campagne sans plan ».
  if coalesce((v_res ->> 'n_cp_plan')::int, 0) = 0 then
    return jsonb_build_object(
      'error', 'plan_absent',
      'calculable', false,
      'n_cp', (v_res ->> 'n_cp')::int,
      'n_cp_plan', 0,
      'plan_couverture_pct', 0,
      'impressions_totales', (v_res ->> 'impressions_totales')::numeric
    );
  end if;

  return v_res;
end;
$fn$;

comment on function public.calculer_alignement_geo is
  'Score d''alignement geographique 0-100, TOUJOURS calcule au code postal. '
  'TROIS cas de non-calcul : campagne introuvable, aucune donnee de diffusion, et '
  '— depuis sql/209 — AUCUN PLAN. Ce dernier rendait 100 : zero ecart a un plan qui '
  'n''existe pas. Les impressions parties sur un code postal hors plan comptent en '
  'TOTALITE en sur-pression (meme regle que le jumeau TypeScript et que le ruling '
  'T11-2), sans quoi une couverture partielle pourrait encore rendre un score parfait.';

revoke all on function public.calculer_alignement_geo(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.calculer_alignement_geo(uuid, numeric, numeric)
  to service_role;

-- sql/212 — Un plan peut venir d'un JEU DE ZONES
--           (2026-09-20)
--
-- ── POURQUOI ÉLARGIR LA CONTRAINTE PLUTÔT QUE RÉUTILISER UNE VALEUR ──────
--
-- `bidding_strategies.weighting_mode` admettait cinq valeurs : `uniform`,
-- `by_tier`, `by_subzone`, `by_cp_csv`, `by_insee_variable`. Un plan issu d'un
-- jeu de zones n'en est aucune.
--
-- `by_cp_csv` était tentant — c'est bien un poids par code postal venu d'une
-- source externe — et c'est exactement pour cela qu'il fallait l'écarter : la
-- valeur serait devenue un mensonge dans une colonne sur laquelle du code
-- branche. `app/api/bidding/strategies/[id]/export/route.ts` lit
-- `weighting_mode` et le passe à `resolveWeightingTarget` ; un jour, quelqu'un
-- ajoutera une branche `by_cp_csv` et le plan de zones y tombera sans que
-- personne ne l'ait voulu.
--
-- ── CE QUE `by_zone_set` FAIT AUJOURD'HUI ────────────────────────────────
--
-- `resolveWeightingTarget` (`lib/bidding-ml/metric-labels.ts:143`) ne branche
-- que sur `by_insee_variable` et retombe sinon sur `{ variableCode: null,
-- targetLabel: 'zones cibles' }`. C'est le comportement JUSTE pour un jeu de
-- zones : il n'y a pas de variable INSEE derrière, et prétendre le contraire
-- ferait afficher « taux d'abstention » sur un plan qui n'en parle pas — le
-- défaut même que ce chantier ferme.
--
-- ── L'ASYMÉTRIE ASSUMÉE AVEC LE WIZARD ───────────────────────────────────
--
-- ⚠ `app/api/bidding/strategies/route.ts:53` porte un `z.enum` des cinq
-- valeurs d'origine, et il n'est PAS étendu. C'est délibéré : le wizard ne sait
-- pas créer un plan de zones — il lui manquerait `in_zone_weights.zone_set_id`
-- — et l'y autoriser produirait une stratégie `by_zone_set` sans jeu derrière,
-- donc un plan vide qui se présenterait comme configuré.
--
-- Seule `/api/zones/jeux/[id]/rattacher` émet cette valeur, et elle écrit
-- toujours le `zone_set_id` avec.

alter table public.bidding_strategies
  drop constraint if exists bidding_strategies_weighting_mode_check;

alter table public.bidding_strategies
  add constraint bidding_strategies_weighting_mode_check
  check (weighting_mode = any (array[
    'uniform', 'by_tier', 'by_subzone', 'by_cp_csv', 'by_insee_variable',
    -- 2026-09-20 : plan issu d'un jeu de zones de risque (sql/210).
    -- `in_zone_weights` porte alors `{mode:'zone_set', zone_set_id, version}`.
    'by_zone_set'
  ]));

comment on column public.bidding_strategies.weighting_mode is
  'Comment le plan pondere les codes postaux. ''by_zone_set'' (sql/212) designe un plan '
  'issu d''un jeu de zones de risque : in_zone_weights porte alors zone_set_id et la '
  'version figee. Le wizard ne cree PAS cette valeur — il lui manquerait le jeu, et la '
  'strategie se presenterait comme configuree avec un plan vide.';

-- ═══════════════════════════════════════════════════════════════════════════
-- L'ALGORITHME « JEU DE ZONES », POUR QUE LA CLÉ ÉTRANGÈRE TIENNE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `bidding_strategies.algorithm_code` référence `bidding_algorithms`, un
-- catalogue d'algorithmes d'apprentissage (Hoeffding, LinUCB, Thompson…).
-- Un plan issu d'un jeu de zones n'en est aucun : il ne s'entraîne pas, il ne
-- dérive pas, il ne s'adapte pas. C'est un plan FIGÉ.
--
-- ⚠ Détourner `baseline_random` aurait tenu la clé étrangère et menti sur la
-- nature du plan — un écran de comparaison d'algorithmes y aurait rangé nos
-- zones parmi les tirages aléatoires.
--
-- `is_enabled = false` : la ligne existe pour que la clé étrangère tienne, et
-- le wizard ne la propose PAS. Le seul émetteur est
-- `/api/zones/jeux/[id]/rattacher`.

insert into public.bidding_algorithms (
  code, display_name, display_name_fr, description, family, library,
  config_schema, supports_drift_detection, supports_online_learning,
  is_baseline, is_enabled, display_order
) values (
  'zone_set',
  'Zone Set Plan',
  'Plan par jeu de zones',
  'Plan geographique fige, issu d''un jeu de zones de risque. Aucun apprentissage : '
  || 'les multiplicateurs viennent de la population exposee par classe et des poids '
  || 'choisis a la main. Non propose par le wizard.',
  'static', 'none',
  '{}'::jsonb,
  false, false, false, false, 900
)
on conflict (code) do update
  set description = excluded.description,
      is_enabled  = false;

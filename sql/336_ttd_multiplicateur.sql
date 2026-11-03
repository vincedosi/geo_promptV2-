-- ============================================================================
-- sql/336_ttd_multiplicateur.sql — D34 : The Trade Desk au CP passe au mécanisme « multiplicateur » dans le registre
-- des mécanismes de poids `plateformes_poids` (sql/305) — plan de corrections du découpage des zones, lot 4, réponse
-- de Vincent du 03/11/2026.
--
-- LE CONSTAT. sql/305 avait posé TTD au CP en `budget_ligne`, mécanisme lui-même « à vérifier » (« TTD ? » du brief :
-- des bid lists géo en feraient un multiplicateur). La décision du 03/11 tranche : multiplicateur.
--
-- CE QUE FAIT CETTE MIGRATION.
--   - la ligne (ttd, cp, multiplicateur) : plage (valeur_min, valeur_max) et plafond d'entrées (nb_max_entrees)
--     INCONNUS — aucune valeur sourcée, donc NULL, et « à vérifier » PARAMÈTRE PAR PARAMÈTRE (règle 4, E9), avec la
--     règle de groupe (`poids_groupe_cp = meme`, valeur de sql/305, toujours non confirmée). Le mécanisme lui-même
--     n'est plus « à vérifier » : c'est une décision. `branche` = false (aucune poussée de poids TTD).
--   - la ligne (ttd, cp, budget_ligne) est retirée. « budget_ligne » RESTE dans l'énumération (CHECK
--     `plateformes_poids_mecanisme_check`, `MECANISMES_POIDS`), sans ligne qui l'emploie.
--
-- L'EFFET (mesuré, D34). Une plage inconnue n'entre pas dans `reglageDuPlan` (lib/zones/plan-jeu-zone.ts) : le plan
-- propre de TTD reste borné aux bornes techniques de numeric(6,3), et le plan commun à la plage de DV360. Aucun
-- écrêtage n'est attribué à TTD (`sortiesPoids` cherche SA borne, inconnue). Le mode de poussée par défaut (B16,
-- `modePoussee`) ne change pas : mécanisme autre que « aucun », non branché → « ciblage_api », comme avant.
--
-- REJOUABLE, Y COMPRIS APRÈS sql/305. L'insertion est `on conflict do nothing` (une ligne corrigée plus tard par
-- dentsu n'est pas remise à NULL par un rejeu) ; la suppression de `budget_ligne` est inconditionnelle, de sorte que
-- la chaîne sql/305 → sql/336 rejouée redonne la même table (sql/305 réinsère `budget_ligne`, sql/336 la retire).
-- Aucun DROP. Pas de begin/commit : appliquer par `psql -1`.
-- ============================================================================

insert into public.plateformes_poids
  (plateforme, maille, mecanisme, valeur_min, valeur_max, pas, nb_max_entrees, nb_paliers_max, poids_groupe_cp,
   branche, parametres_a_verifier, note, releve_le)
values
  ('ttd', 'cp', 'multiplicateur', null, null, null, null, null, 'meme', false,
   '{valeur_min,valeur_max,nb_max_entrees,poids_groupe_cp}',
   'Multiplicateur (bid lists geo), decision du 03/11 (D34). Plage et plafond d''entrees non releves : a verifier par dentsu.',
   '2026-11-03')
on conflict (plateforme, maille, mecanisme) do nothing;

delete from public.plateformes_poids
 where plateforme = 'ttd' and maille = 'cp' and mecanisme = 'budget_ligne';

notify pgrst, 'reload schema';

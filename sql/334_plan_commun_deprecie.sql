-- ============================================================================
-- sql/334_plan_commun_deprecie.sql — D32 : le plan CP COMMUN d'une extraction de jeu de ZONE est DÉPRÉCIÉ (plan de
-- corrections du découpage des zones, lot 4, réponse de Vincent du 03/11/2026).
--
-- LE CONTEXTE (B12, sql/317). Une extraction de jeu de zone fige deux plans CP :
--   - le plan de CHAQUE plateforme au CP, à SON seuil et à la plage de SES mécanismes de poids, dans
--     `zone_set_extraction_cp_plateforme` — la source de vérité ;
--   - le plan COMMUN (seuil le plus bas des plateformes au CP, plage la plus étroite), dans `zone_set_extraction_cp`,
--     gardé parce que ⑥ Plan campagne, le rattachement, l'export, `/cp` et la simulation le lisent encore.
--
-- LA DÉCISION (D32). Le plan commun d'un jeu de ZONE est déprécié MAINTENANT. Il sera retiré dans le commit qui fait
-- lire le plan par plateforme à ⑥ et ⑦ (côté dentsu, passation à coordonner). Les extractions déjà produites gardent
-- leur plan commun figé, en lecture seule. Pas deux sources de vérité au-delà de cette transition.
--
-- CE QUE FAIT CETTE MIGRATION. Des commentaires, rien d'autre : aucune colonne, aucune fonction, aucune ligne touchée.
-- `zone_set_extraction_cp` sert AUSSI les jeux RISQUE (`creer_zone_set_extraction`, sql/231) : pour eux, ce plan est
-- LE plan, il n'est pas déprécié — les commentaires le disent. Le trigger d'immuabilité (`trg_zse_cp_immuable`,
-- sql/231) reste en place : une extraction produite n'est jamais réécrite.
--
-- Rejouable : `comment on` remplace le texte à l'identique. Aucun DROP. Pas de begin/commit : appliquer par `psql -1`.
-- ============================================================================

comment on table public.zone_set_extraction_cp is
  'Un multiplicateur par code postal, figé. ⚠ UNE LIGNE PAR CODE POSTAL et non '
  'par (code postal x grappe) comme `zone_set_cp` : le DSP ne sait porter qu''un '
  'multiplicateur par code postal, et `genererPlanCp` a déjà replié les grappes. '
  'Les membres d''un groupe indiscernable (sql/228) ont chacun leur ligne, au '
  'multiplicateur divisé — le plan achète tout le groupe. '
  'DÉPRÉCIÉ pour un jeu de ZONE (D32, sql/334) : ce plan COMMUN (seuil le plus bas des plateformes au CP) n''est gardé '
  'que parce que (6)/(7) le lisent encore ; la source de vérité est zone_set_extraction_cp_plateforme (B12, sql/317). '
  'Retiré dans le commit qui fait lire le plan par plateforme à (6) et (7) (côté dentsu) ; les extractions déjà '
  'produites gardent leur plan commun figé, en lecture seule. Un jeu RISQUE n''a que ce plan : non déprécié pour lui.';

comment on table public.zone_set_extraction_cp_plateforme is
  'B12 (sql/317) : le plan CP de CHAQUE plateforme au CP d''une extraction de jeu de zone, a SON seuil et a la plage de '
  'SES mecanismes (plateformes_poids) ; unites retenues seulement, developpees en codes ; populations sur le canonique, '
  'NULL sur un membre. Le plan COMMUN (seuil le plus bas) reste dans zone_set_extraction_cp, lu par (6)/(7). Immuable. '
  'D32 (sql/334) : SOURCE DE VERITE du plan CP d''un jeu de zone ; le plan commun est deprecie, retire quand (6)/(7) '
  'liront cette table.';

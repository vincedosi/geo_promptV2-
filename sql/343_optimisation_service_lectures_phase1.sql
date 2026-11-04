-- =============================================================================
-- 343 — optimisation_service : les lectures de la phase 1 (méthode A, mesures par maille)
-- =============================================================================
--
-- Complète sql/342 (« droits limités à ce qui existe au 04/11, complétés à chaque phase », plan
-- 2026-11-04-optimisation-python-architecture.md § 6). Les lecteurs psycopg de la phase 1 lisent :
--
--   - custom_geo_zone_codes  : les codes `cp` d'une zone (apply_zone_weights_to_strategy, sql/106) ;
--   - indicator_cp_values    : la valeur de l'indicateur par code (courbe de pression, sql/106) ;
--   - ref_departements       : département → région, nom (alignement_par_maille) ;
--   - ref_regions            : nom de région (alignement_par_maille).
--
-- SELECT seulement, aucune écriture. Idempotent (un GRANT déjà accordé ne fait rien), aucun REVOKE, aucun DROP.
-- `optimisation_service` est BYPASSRLS (sql/342) : la policy de lecture d'indicator_cp_values (source_visible) ne
-- s'applique pas à lui ; le cloisonnement reste applicatif, comme pour les autres tables héritées.

grant select on table
  public.custom_geo_zone_codes,
  public.indicator_cp_values,
  public.ref_departements,
  public.ref_regions
to optimisation_service;

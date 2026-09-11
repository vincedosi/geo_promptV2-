-- =============================================================================
-- 133 — Ménage : tables, vues et vues matérialisées sans aucun lecteur
-- Appliqué le 2026-09-11 via MCP Supabase (apply_migration).
-- =============================================================================
--
-- Méthode, pour CHAQUE objet, avant de le retirer :
--   1. aucune référence dans le code applicatif — vérifié en cherchant les
--      accès PostgREST `.from('<objet>')` puis par un grep intégral du dépôt.
--      Attention au faux positif : `types/database.types.ts` cite TOUTES les
--      tables. Un objet qui n'apparaît QUE là n'a aucun lecteur ;
--   2. aucune fonction, vue ou vue matérialisée de `public` ne le nomme
--      (pg_proc.prosrc, pg_views.definition, pg_matviews.definition) ;
--   3. aucune clé étrangère ne le référence, aucune vue n'en dépend
--      (information_schema + pg_depend) ;
--   4. sa définition vit dans une migration versionnée : le restaurer est une
--      opération git, pas une restauration de sauvegarde. Le chemin est cité
--      sous chaque objet.
--
-- ── Ce qui N'EST PAS retiré, et pourquoi ────────────────────────────────────
--
--   `geography_zones` (93 lignes, 5 Mo) n'a elle non plus aucun lecteur, et
--   elle RESTE : ce sont les 93 zones CIRFA d'avril 2026, la donnée métier sur
--   laquelle le plan média a été construit. De la géométrie façonnée, pas un
--   cache dérivé. Les migrer vers `custom_geo_zones` ou les abandonner est un
--   arbitrage produit, pas un ménage technique.
--
--   `smart_ville_stats` reste : `smart_demographie_top_villes` la lit, et cette
--   RPC est appelée par `lib/smart-prompt/agents/demographie.ts`.
--
--   `laposte_hexasmal` (vide) et ses trois fonctions restent : `sql/119-120` les
--   ont durcies après avoir découvert qu'un appel pouvait effacer les 6 187
--   codes postaux de `ref_codes_postaux`. Les retirer supprimerait ce risque,
--   mais aussi le seul chemin de reconstruction du référentiel. À trancher.
-- =============================================================================

-- ── 1. carreaux_commune_lookup — 227 Mo, 2 199 999 lignes ───────────────────
-- Le gros morceau. Correspondance carreau → commune plus cinq colonnes de
-- population : un CACHE DÉRIVÉ de `carreaux_filosofi` et `ref_communes`, pas une
-- source. Son unique lecteur est `get_equity_analysis`, qui n'a elle-même aucun
-- appelant — code mort lisant un cache mort.
-- Restauration : supabase/migrations/20260409_geo_equity_v2.sql
DROP TABLE IF EXISTS public.carreaux_commune_lookup;

-- ── 2. iris_metrics_mv — 10 Mo, 49 448 lignes ───────────────────────────────
-- Vue matérialisée dérivée d'`iris`. Personne ne la lit ; sa seule mention est
-- `refresh_iris_metrics_mv`, qui la rafraîchit et n'a aucun appelant. Une vue
-- matérialisée dont le seul lecteur est son propre rafraîchisseur est morte par
-- construction — et comme toute vue matérialisée, elle se reconstruit depuis sa
-- définition.
-- Restauration : sql/071_iris_poi_counts.sql
DROP MATERIALIZED VIEW IF EXISTS public.iris_metrics_mv;

-- ── 3. poi_metadata_index — 2 Mo, 0 ligne ───────────────────────────────────
-- Index applicatif clé/valeur sur les métadonnées de POI. Jamais peuplé : les
-- métadonnées vivent dans la colonne `jsonb` de `poi_france`. Les 2 Mo sont du
-- ballonnement d'index sur une table vide.
-- Restauration : sql/010_security_hardening.sql
DROP TABLE IF EXISTS public.poi_metadata_index;

-- ── 4. isochrone_carreaux_coverage — 0 ligne ────────────────────────────────
-- Déjà proposée à la suppression le 2026-05-07 (sql/cleanup/DROPS_PROPOSED.sql),
-- jamais exécutée. Le constat tient toujours : zéro écriture depuis la création,
-- zéro lecteur. Le calcul de couverture se fait en ligne.
DROP TABLE IF EXISTS public.isochrone_carreaux_coverage;

-- ── 5. radio_couvertures_agg — vue matérialisée, 0 ligne ────────────────────
-- Agrégat de couverture radio jamais rafraîchi ni lu. La couverture se calcule
-- désormais par `get_radio_coverage_geometry` (sql/121).
-- Restauration : supabase/migrations/20260401_radio_tables.sql
DROP MATERIALIZED VIEW IF EXISTS public.radio_couvertures_agg;

-- ── 6. data_sources_view — vue, doublon de data_sources ─────────────────────
-- Vue qui rend exactement les mêmes 5 lignes que `data_sources`, sans filtre ni
-- calcul ajouté. Aucun appelant : toutes les routes lisent la table.
-- Restauration : sql/010_security_hardening.sql
DROP VIEW IF EXISTS public.data_sources_view;

-- ── 7 & 8. Vestiges de Pilotage ML ──────────────────────────────────────────
-- L'overlay Pilotage ML et son wizard de stratégie A4.7 ont été retirés le
-- 2026-09-08 avec 22 routes. Ces deux tables en restaient : `bidding_init_presets`
-- (5 lignes de configuration que plus rien ne lit) et
-- `bidding_zone_config_proposals` (0 ligne, propositions de l'agent jamais
-- écrites). Les autres tables `bidding_*` servent encore le wizard de campagne
-- et ne sont PAS touchées.
-- Restauration : supabase/migrations/20260430_chantier_a4_7_*.sql
--                supabase/migrations/20260429_chantier_a4_3_execution_modes.sql
DROP TABLE IF EXISTS public.bidding_init_presets;
DROP TABLE IF EXISTS public.bidding_zone_config_proposals;

-- ── 9. get_equity_analysis — le seul lecteur de la table n° 1 ───────────────
-- Retirée avec elle : sans `carreaux_commune_lookup` elle ne peut plus rien
-- faire, et elle n'a aucun appelant.
-- Restauration : supabase/migrations/20260409_geo_equity_v2.sql
-- Signature relevée en base, pas devinée :
DROP FUNCTION IF EXISTS public.get_equity_analysis(uuid, text, text, double precision[], boolean, text);

-- ── 10. refresh_iris_metrics_mv — le rafraîchisseur de la vue n° 2 ──────────
DROP FUNCTION IF EXISTS public.refresh_iris_metrics_mv();

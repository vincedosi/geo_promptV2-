-- sql/182 — Retirer l'exécution ANONYME sur les RPC du chantier risque
--
-- ── CE QUE `get_advisors` A TROUVÉ LE 2026-09-18 ──────────────────────────
--
-- Cinq fonctions `SECURITY DEFINER` du chantier risque étaient exécutables par
-- le rôle **`anon`**, donc par quiconque possède la clé publique de l'app —
-- laquelle est, par construction, dans le bundle JavaScript servi à tout
-- visiteur.
--
--   consolider_geo_icpe()              ÉCRIT dans poi_france
--   pprt_importer_partition(text,jsonb) DELETE + INSERT dans pprt_perimetres
--   pprt_consolider_departement()       ÉCRIT dans pprt_perimetres
--   pprt_perimetres_carte(...)          lecture
--   risques_industriels_carte(...)      lecture
--
-- Les trois premières ne sont pas des lectures : `pprt_importer_partition`
-- SUPPRIME les zones d'une partition avant de les réinsérer. Un appel anonyme
-- sur `/rest/v1/rpc/pprt_importer_partition` avec une partition existante et un
-- tableau vide effaçait donc des servitudes, sans authentification.
--
-- ── POURQUOI CE N'ÉTAIT PAS VU ───────────────────────────────────────────
--
-- Le projet a durci 67 fonctions en 07/2026 avec exactement ce patron. Les
-- migrations sql/173 à sql/179 l'ont simplement OUBLIÉ — PostgreSQL accorde
-- `EXECUTE` à `PUBLIC` par défaut sur toute fonction créée, donc ne rien écrire
-- suffit à ouvrir la porte. C'est l'inverse du réflexe habituel : ici, le
-- silence est permissif.
--
-- Seule sql/180 (`population_exposee_site`) portait déjà le revoke, parce
-- qu'elle a été écrite après la relecture de la convention.
--
-- ── CE QUE ÇA NE CASSE PAS ───────────────────────────────────────────────
--
-- Aucune des 205 routes de l'application n'instancie de client Supabase avec la
-- clé anon : toutes passent par `createAdminClient()`, donc par `service_role`.
-- Mesuré le 2026-09-16 et redit dans ARCHITECTURE.md (« RLS — DORMANTES »).
-- Retirer `anon` et `authenticated` ne retire donc aucun appel réel.
--
-- ── CE QUI RESTE OUVERT, ET N'EST PAS TRAITÉ ICI ─────────────────────────
--
-- Trois autres fonctions sont exécutables par `anon` pour la même raison, mais
-- elles sont HORS de ce chantier et deux d'entre elles reconstruisent des
-- tables entières (coût I/O majeur si appelées en boucle) :
--
--   compute_filosofi_profiles_batch_2km(jsonb, numeric)
--   construire_iris_agg(text)
--   construire_iris_bornes()
--
-- Signalées plutôt que corrigées au passage : elles méritent leur propre
-- vérification d'appelants. À trancher.
--
-- Restent INTENTIONNELLEMENT ouvertes (documenté en 07/2026) :
-- `get_user_org`, `get_user_role` (appelées par les policies RLS) et les trois
-- surcharges de `st_estimatedextent` (fournies par PostGIS).

revoke all on function public.consolider_geo_icpe()
  from public, anon, authenticated;
grant execute on function public.consolider_geo_icpe()
  to service_role;

revoke all on function public.pprt_importer_partition(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pprt_importer_partition(text, jsonb)
  to service_role;

revoke all on function public.pprt_consolider_departement()
  from public, anon, authenticated;
grant execute on function public.pprt_consolider_departement()
  to service_role;

revoke all on function public.pprt_perimetres_carte(double precision[], text[], integer)
  from public, anon, authenticated;
grant execute on function public.pprt_perimetres_carte(double precision[], text[], integer)
  to service_role;

revoke all on function public.risques_industriels_carte(double precision[], text[], text[], boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.risques_industriels_carte(double precision[], text[], text[], boolean, integer, integer)
  to service_role;

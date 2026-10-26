-- sql/284 — retrait de `croisements_zone` (sql/273) : la radio et le trafic d'une zone de l'espace, lus par le bloc
-- « Dans cette zone » de l'étape ④ (lot 4, T13). Le bloc, la route `GET /api/zones/[id]/croisements`, l'appel Angular
-- et leurs tests ont été retirés le 2026-10-26 (retours du 26/10, T5, décision de Vincent). Plus aucun code de ce
-- dépôt n'appelle la fonction ; React ne l'a jamais appelée.
--
-- ⛔ NON APPLIQUÉE avant le merge dans feat/angular-lot0 (arbitrage A-9 du plan
-- docs/superpowers/plans/2026-10-26-carte-retours-26-10.md). La base locale est PARTAGÉE : d'autres worktrees montent
-- encore ④ avec ce bloc et appellent la fonction pendant qu'on travaille ; la supprimer maintenant casserait leurs
-- appels (CLAUDE.md, § Troncature PostgREST : « on ne fait pas de DROP »). Elle s'applique au merge, en même temps que
-- le retrait de l'entrée `croisements_zone` de `types/database.types.ts` (types générés : ils suivent la base).
--
-- Signature lue dans sql/273 (`revoke … on function public.croisements_zone(uuid, uuid, integer)`). Aucune autre
-- fonction ni vue n'en dépend. Rejouable (`if exists`).
--
-- Application (au merge seulement) :
--   docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/284_retrait_croisements_zone.sql

drop function if exists public.croisements_zone(uuid, uuid, integer);

notify pgrst, 'reload schema';

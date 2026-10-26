-- =============================================================================
-- 283 — index (categorie, code_postal) sur poi_france (retours du 26/10, T1)
-- =============================================================================
--
-- `POST /api/map/pois` accepte désormais un `code_postal` (filtre « code postal » de l'étape ①). La lecture
-- `categorie = … AND code_postal = …` n'avait que l'index sur `categorie` : 16 470 buffers et 370 ms pour l'ICPE
-- d'un seul code postal (97 454 sites en métropole parcourus). Mesure après index : voir ARCHITECTURE.md
-- (§ /api/map/pois) et le rapport de la tâche.
--
-- ⚠ À exécuter HORS transaction : `CREATE INDEX CONCURRENTLY` ne bloque pas les écritures de la table, mais
-- PostgreSQL le refuse dans un bloc `BEGIN … COMMIT` (et donc dans `psql --single-transaction`). Additif et
-- rejouable (`IF NOT EXISTS`). Aucun DROP.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_poi_france_categorie_cp
  ON public.poi_france (categorie, code_postal);

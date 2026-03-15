-- ═══════════════════════════════════════════════════════════════════════════
-- 026_carreaux_filosofi_colonnes_directes.sql
--
-- Ajoute des colonnes générées STORED aux 5 métriques Filosofi les plus
-- utilisées dans les calculs de couverture.
-- Élimine le parsing JSONB à la requête (50μs × 500k carreaux = 25s → <1s).
--
-- Note : ADD COLUMN GENERATED ALWAYS AS ... STORED déclenche une réécriture
-- de table (2.3M lignes) — exécuter hors heure de pointe, dure ~2-5 min.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE carreaux_filosofi
  ADD COLUMN IF NOT EXISTS ind       NUMERIC GENERATED ALWAYS AS ((metadata->>'ind')::numeric)       STORED,
  ADD COLUMN IF NOT EXISTS ind_18_24 NUMERIC GENERATED ALWAYS AS ((metadata->>'ind_18_24')::numeric) STORED,
  ADD COLUMN IF NOT EXISTS ind_25_39 NUMERIC GENERATED ALWAYS AS ((metadata->>'ind_25_39')::numeric) STORED,
  ADD COLUMN IF NOT EXISTS ind_40_54 NUMERIC GENERATED ALWAYS AS ((metadata->>'ind_40_54')::numeric) STORED,
  ADD COLUMN IF NOT EXISTS ind_inc   NUMERIC GENERATED ALWAYS AS ((metadata->>'ind_inc')::numeric)   STORED;

-- Index partiel pour accélérer les SUM (optionnel, utile si Supabase l'optimise)
-- CREATE INDEX CONCURRENTLY idx_carreaux_ind ON carreaux_filosofi (ind) WHERE ind IS NOT NULL;

COMMENT ON COLUMN carreaux_filosofi.ind       IS 'Population totale — extrait de metadata, stocké pour performance';
COMMENT ON COLUMN carreaux_filosofi.ind_18_24 IS '18-24 ans — extrait de metadata, stocké pour performance';
COMMENT ON COLUMN carreaux_filosofi.ind_25_39 IS '25-39 ans — extrait de metadata, stocké pour performance';
COMMENT ON COLUMN carreaux_filosofi.ind_40_54 IS '40-54 ans — extrait de metadata, stocké pour performance';
COMMENT ON COLUMN carreaux_filosofi.ind_inc   IS 'Pop. inconnue — extrait de metadata, stocké pour performance';

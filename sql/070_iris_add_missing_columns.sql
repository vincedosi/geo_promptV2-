-- Migration 070 — Ajout des colonnes core manquantes dans la table iris
-- Ces colonnes sont définies dans db-columns.ts (lib/iris-crawler/db-columns.ts)
-- mais n'existaient pas encore en base.
--
-- Revenus Filosofi complémentaires
ALTER TABLE iris ADD COLUMN IF NOT EXISTS rev_d1        NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS rev_d9        NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS taux_pauvrete NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS indice_gini   NUMERIC;
-- Emploi (RP)
ALTER TABLE iris ADD COLUMN IF NOT EXISTS nb_emplois    NUMERIC;
ALTER TABLE iris ADD COLUMN IF NOT EXISTS taux_emploi   NUMERIC;

-- Vérification après migration :
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'iris' AND table_schema = 'public'
-- ORDER BY column_name;

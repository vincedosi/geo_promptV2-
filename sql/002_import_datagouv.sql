-- ============================================================================
-- GENESIS — Migration 002 : Import data.gouv.fr POIs
-- Aucune nouvelle table nécessaire — la table poi avec trigger auto_set_geom
-- et la vue poi_france suffisent. Ce script ajoute uniquement :
--   • Un index sur la colonne source (filtre/suppression imports data.gouv)
--   • Une fonction RPC pour compter les POIs existants par catégorie+source
--     (utilisée par l'UI pour prévenir les doublons avant import)
-- ============================================================================
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL)
-- ============================================================================

-- ─── 1. Index sur source (requêtes de comptage/suppression rapides) ─────────
CREATE INDEX IF NOT EXISTS idx_poi_france_source
  ON poi_france (source)
  WHERE source IS NOT NULL;

-- ─── 2. Index composite catégorie+source (pour la vérification pré-import) ──
CREATE INDEX IF NOT EXISTS idx_poi_france_categorie_source
  ON poi_france (categorie, source);

-- ─── 3. Fonction RPC : compter les POIs par catégorie et source ─────────────
-- Utilisée par l'UI pour afficher "X POIs déjà en base" avant import
CREATE OR REPLACE FUNCTION count_poi_by_categorie_source(
  p_categorie TEXT,
  p_source    TEXT DEFAULT 'data_gouv'
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM poi_france
  WHERE categorie = p_categorie
    AND source    = p_source;
$$;

-- ─── Vérification post-migration ────────────────────────────────────────────
-- SELECT count_poi_by_categorie_source('bornes_recharge', 'data_gouv');
-- SELECT COUNT(*) FROM poi_france WHERE source = 'data_gouv';

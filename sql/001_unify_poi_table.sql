-- ============================================================================
-- GENESIS — Migration 001 : Unification table POI
-- Renomme poi_france → poi, ajoute index sur categorie, vérifie geom PostGIS
-- ============================================================================
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL)
-- IMPORTANT: faire un backup avant exécution !
-- ============================================================================

BEGIN;

-- ─── 1. Supprimer la contrainte FK poi_france_categorie_fkey si elle existe ──
ALTER TABLE IF EXISTS poi_france
  DROP CONSTRAINT IF EXISTS poi_france_categorie_fkey;

-- ─── 2. Renommer la table poi_france → poi ──────────────────────────────────
-- Si la table "poi" existe déjà (peu probable), on la supprime d'abord
DROP TABLE IF EXISTS poi CASCADE;

ALTER TABLE poi_france RENAME TO poi;

-- ─── 3. Vérifier/ajouter la colonne geom (PostGIS geometry) ─────────────────
-- La colonne geom existe déjà (auto_set_geom trigger), on s'assure juste qu'elle est là
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'poi' AND column_name = 'geom'
  ) THEN
    -- Activer PostGIS si pas encore fait
    CREATE EXTENSION IF NOT EXISTS postgis;
    -- Ajouter la colonne geom
    ALTER TABLE poi ADD COLUMN geom geometry(Point, 4326);
    -- Remplir depuis lat/lng existants
    UPDATE poi SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geom IS NULL;
  END IF;
END $$;

-- ─── 4. Index sur categorie (recherche rapide par type de POI) ──────────────
DROP INDEX IF EXISTS idx_poi_france_categorie;
DROP INDEX IF EXISTS idx_poi_categorie;
CREATE INDEX idx_poi_categorie ON poi (categorie);

-- ─── 5. Index spatial sur geom (requêtes PostGIS) ──────────────────────────
DROP INDEX IF EXISTS idx_poi_france_geom;
DROP INDEX IF EXISTS idx_poi_geom;
CREATE INDEX idx_poi_geom ON poi USING GIST (geom);

-- ─── 6. Index sur ville (recherches ILIKE fréquentes) ───────────────────────
DROP INDEX IF EXISTS idx_poi_france_ville;
DROP INDEX IF EXISTS idx_poi_ville;
CREATE INDEX idx_poi_ville ON poi (ville);

-- ─── 7. Recréer le trigger auto_set_geom sur la nouvelle table ──────────────
-- D'abord, supprimer l'ancien trigger s'il existe
DROP TRIGGER IF EXISTS auto_set_geom ON poi;
DROP TRIGGER IF EXISTS auto_set_geom ON poi_france;

-- Créer/remplacer la fonction trigger
CREATE OR REPLACE FUNCTION fn_auto_set_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attacher le trigger à la table poi
CREATE TRIGGER auto_set_geom
  BEFORE INSERT OR UPDATE ON poi
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_set_geom();

-- ─── 8. Mettre à jour la FK de poi_categories (optionnel, soft reference) ───
-- On ne recrée PAS la FK constraint pour rester flexible avec des centaines de catégories.
-- La validation se fait côté application (dictionnaire dynamique).

-- ─── 9. Mettre à jour les fonctions RPC PostGIS qui référencent poi_france ──
CREATE OR REPLACE FUNCTION panneaux_near_poi(
  p_categorie TEXT,
  p_rayon_m INTEGER DEFAULT 500,
  p_meta_cle TEXT DEFAULT NULL,
  p_meta_valeur TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  panneau_id UUID,
  panneau_ref TEXT,
  panneau_lat DOUBLE PRECISION,
  panneau_lng DOUBLE PRECISION,
  poi_id UUID,
  poi_nom TEXT,
  distance_m DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pa.id AS panneau_id,
    pa.reference_panneau AS panneau_ref,
    pa.lat AS panneau_lat,
    pa.lng AS panneau_lng,
    p.id AS poi_id,
    p.nom AS poi_nom,
    ST_Distance(pa.geom::geography, p.geom::geography) AS distance_m
  FROM panneaux_affichage pa
  CROSS JOIN LATERAL (
    SELECT po.id, po.nom, po.geom
    FROM poi po
    WHERE po.categorie = p_categorie
      AND (p_meta_cle IS NULL OR (po.metadata->>p_meta_cle) = p_meta_valeur)
      AND ST_DWithin(pa.geom::geography, po.geom::geography, p_rayon_m)
    ORDER BY ST_Distance(pa.geom::geography, po.geom::geography)
    LIMIT 1
  ) p
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 10. Créer une vue poi_france pour compatibilité temporaire ─────────────
-- Permet aux anciennes requêtes de continuer à fonctionner pendant la transition
CREATE OR REPLACE VIEW poi_france AS SELECT * FROM poi;

COMMIT;

-- ============================================================================
-- Vérification post-migration (à lancer après)
-- ============================================================================
-- SELECT count(*) FROM poi;
-- SELECT DISTINCT categorie FROM poi ORDER BY categorie;
-- SELECT * FROM poi LIMIT 5;
-- \d poi   -- pour vérifier la structure

-- =============================================================================
-- 044_carreaux_1km.sql
--
-- Crée la table carreaux_1km : agrégation des carreaux 200m en mailles 1km.
-- Chaque maille 1km regroupe ~25 carreaux 200m (grille 5×5).
--
-- Méthode :
--   - ST_SnapToGrid(centroid, 1000) sur geom_3857 → identifiant de la maille
--   - ST_Expand(snap_pt, 500) → carré 1km×1km en 3857
--   - Agrégation SUM / AVG pondérée sur les indicateurs du JSONB metadata
--
-- Prérequis : migration 043 exécutée (geom_3857 peuplé sur carreaux_filosofi)
-- Durée estimée : ~2-5 min (2,3M lignes → ~250k mailles 1km)
-- =============================================================================

DROP TABLE IF EXISTS carreaux_1km;

CREATE TABLE carreaux_1km AS
SELECT
  -- Identifiant de la maille (coordonnées du centre en 3857, arrondi à 1km)
  ST_SnapToGrid(ST_Centroid(geom_3857), 1000)::geometry(Point, 3857) AS snap_pt,
  -- Géométrie : carré 1km×1km centré sur snap_pt
  ST_Expand(
    ST_SnapToGrid(ST_Centroid(geom_3857), 1000),
    500
  )::geometry(Polygon, 3857) AS geom_3857,
  -- Population
  SUM(COALESCE((metadata->>'ind')::numeric,       0))::integer AS population_totale,
  SUM(COALESCE((metadata->>'ind_inc')::numeric,   0))::integer AS population_inconnue,
  SUM(COALESCE((metadata->>'ind_0_3')::numeric,   0))::integer AS ind_0_3,
  SUM(COALESCE((metadata->>'ind_4_5')::numeric,   0))::integer AS ind_4_5,
  SUM(COALESCE((metadata->>'ind_6_10')::numeric,  0))::integer AS ind_6_10,
  SUM(COALESCE((metadata->>'ind_11_17')::numeric, 0))::integer AS ind_11_17,
  SUM(COALESCE((metadata->>'ind_18_24')::numeric, 0))::integer AS ind_18_24,
  SUM(COALESCE((metadata->>'ind_25_39')::numeric, 0))::integer AS ind_25_39,
  SUM(COALESCE((metadata->>'ind_40_54')::numeric, 0))::integer AS ind_40_54,
  SUM(COALESCE((metadata->>'ind_55_64')::numeric, 0))::integer AS ind_55_64,
  SUM(COALESCE((metadata->>'ind_65_79')::numeric, 0))::integer AS ind_65_79,
  SUM(COALESCE((metadata->>'ind_80p')::numeric,   0))::integer AS ind_80p,
  -- Ménages
  SUM(COALESCE((metadata->>'men')::numeric,       0))::integer AS menages_total,
  SUM(COALESCE((metadata->>'men_pauv')::numeric,  0))::integer AS menages_pauvres,
  SUM(COALESCE((metadata->>'men_1ind')::numeric,  0))::integer AS menages_1_personne,
  SUM(COALESCE((metadata->>'men_5ind')::numeric,  0))::integer AS menages_5_plus,
  SUM(COALESCE((metadata->>'men_prop')::numeric,  0))::integer AS menages_proprietaires,
  SUM(COALESCE((metadata->>'men_fmp')::numeric,   0))::integer AS familles_monoparentales,
  SUM(COALESCE((metadata->>'men_mais')::numeric,  0))::integer AS menages_maison,
  SUM(COALESCE((metadata->>'men_coll')::numeric,  0))::integer AS menages_collectif,
  AVG(COALESCE((metadata->>'men_surf')::numeric,  0))::numeric(6,1) AS surface_moyenne,
  -- Revenu médian : moyenne pondérée par population (évite la moyenne naïve)
  CASE
    WHEN SUM(COALESCE((metadata->>'ind')::numeric, 0)) > 0
    THEN (
      SUM(
        COALESCE((metadata->>'ind_snv')::numeric, 0) *
        COALESCE((metadata->>'ind')::numeric, 0)
      ) / NULLIF(SUM(COALESCE((metadata->>'ind')::numeric, 0)), 0)
    )::integer
    ELSE 0
  END AS revenu_median,
  -- Logements
  SUM(COALESCE((metadata->>'log_av45')::numeric,  0))::integer AS logements_avant_1945,
  SUM(COALESCE((metadata->>'log_45_70')::numeric, 0))::integer AS logements_1945_1970,
  SUM(COALESCE((metadata->>'log_70_90')::numeric, 0))::integer AS logements_1970_1990,
  SUM(COALESCE((metadata->>'log_ap90')::numeric,  0))::integer AS logements_apres_1990,
  SUM(COALESCE((metadata->>'log_soc')::numeric,   0))::integer AS logements_sociaux,
  SUM(COALESCE((metadata->>'log_inc')::numeric,   0))::integer AS logements_inconnus
FROM carreaux_filosofi
WHERE resolution = '200m'
  AND geom_3857 IS NOT NULL
GROUP BY ST_SnapToGrid(ST_Centroid(geom_3857), 1000);

-- Index spatial GiST sur geom_3857 (même pattern que carreaux_filosofi)
CREATE INDEX idx_carreaux_1km_geom_3857 ON carreaux_1km USING GIST (geom_3857);

-- Stats pour le planificateur
ANALYZE carreaux_1km;

-- Permissions
GRANT SELECT ON carreaux_1km TO authenticated, service_role;

COMMENT ON TABLE carreaux_1km IS
'Carreaux Filosofi agrégés à 1km². Créés depuis carreaux_filosofi (200m) par ST_SnapToGrid.
~250k mailles. Utilisés par get_tile pour z10-12 (évite les tuiles trop denses en 200m).';

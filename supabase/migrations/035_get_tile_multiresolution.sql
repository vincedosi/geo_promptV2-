-- =============================================================================
-- 035_get_tile_multiresolution.sql
--
-- Remplace get_tile(z,x,y) par une version multi-résolution :
--   z >= 10  → carreaux_filosofi  200m   (comportement actuel)
--   z  8-9   → carreaux_2km       2km    (~75k cellules)
--   z  6-7   → carreaux_5km       5km    (~17k cellules)
--   z  < 6   → tuile vide (204 géré côté API)
--
-- Prérequis : migration 034 exécutée (carreaux_2km + carreaux_5km peuplées)
-- Colonnes exposées : noms matchant CARREAUX_INDICATEURS dans le frontend
-- =============================================================================

-- Supprime les versions précédentes (signatures variées)
DROP FUNCTION IF EXISTS get_tile(INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_tile(z INTEGER, x INTEGER, y INTEGER);

CREATE OR REPLACE FUNCTION get_tile(z INTEGER, x INTEGER, y INTEGER)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
  v_bounds  BOX2D;
  v_mvt     BYTEA;
BEGIN
  v_bounds := ST_TileEnvelope(z, x, y);

  -- ── z >= 10 : carreaux 200m natifs ──────────────────────────────────────────
  IF z >= 10 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(geom, v_bounds, 4096, 0, true)     AS geom,
        idcar,
        COALESCE((metadata->>'ind')::numeric,       0)  AS population_totale,
        COALESCE((metadata->>'ind_0_3')::numeric,   0)  AS ind_0_3,
        COALESCE((metadata->>'ind_4_5')::numeric,   0)  AS ind_4_5,
        COALESCE((metadata->>'ind_6_10')::numeric,  0)  AS ind_6_10,
        COALESCE((metadata->>'ind_11_17')::numeric, 0)  AS ind_11_17,
        COALESCE((metadata->>'ind_18_24')::numeric, 0)  AS ind_18_24,
        COALESCE((metadata->>'ind_25_39')::numeric, 0)  AS ind_25_39,
        COALESCE((metadata->>'ind_40_54')::numeric, 0)  AS ind_40_54,
        COALESCE((metadata->>'ind_55_64')::numeric, 0)  AS ind_55_64,
        COALESCE((metadata->>'ind_65_79')::numeric, 0)  AS ind_65_79,
        COALESCE((metadata->>'ind_80p')::numeric,   0)  AS ind_80p,
        COALESCE((metadata->>'ind_inc')::numeric,   0)  AS population_inconnue,
        COALESCE((metadata->>'ind_snv')::numeric,   0)  AS revenu_median,
        COALESCE((metadata->>'men')::numeric,        0) AS menages_total,
        COALESCE((metadata->>'men_pauv')::numeric,  0)  AS menages_pauvres,
        COALESCE((metadata->>'men_1ind')::numeric,  0)  AS menages_1_personne,
        COALESCE((metadata->>'men_5ind')::numeric,  0)  AS menages_5_plus,
        COALESCE((metadata->>'men_prop')::numeric,  0)  AS menages_proprietaires,
        COALESCE((metadata->>'men_fmp')::numeric,   0)  AS familles_monoparentales,
        COALESCE((metadata->>'men_mais')::numeric,  0)  AS menages_maison,
        COALESCE((metadata->>'men_coll')::numeric,  0)  AS menages_collectif,
        COALESCE((metadata->>'men_surf')::numeric,  0)  AS surface_moyenne,
        COALESCE((metadata->>'log_av45')::numeric,  0)  AS logements_avant_1945,
        COALESCE((metadata->>'log_45_70')::numeric, 0)  AS logements_1945_1970,
        COALESCE((metadata->>'log_70_90')::numeric, 0)  AS logements_1970_1990,
        COALESCE((metadata->>'log_ap90')::numeric,  0)  AS logements_apres_1990,
        COALESCE((metadata->>'log_soc')::numeric,   0)  AS logements_sociaux,
        COALESCE((metadata->>'log_inc')::numeric,   0)  AS logements_inconnus
      FROM carreaux_filosofi
      WHERE geom && v_bounds
        AND resolution = '200m'
      LIMIT 2000
    ) q;

  -- ── z 8-9 : carreaux 2km ────────────────────────────────────────────────────
  ELSIF z >= 8 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(geom, v_bounds, 4096, 0, true) AS geom,
        id                    AS idcar,
        COALESCE(ind,       0) AS population_totale,
        COALESCE(ind_0_3,   0) AS ind_0_3,
        COALESCE(ind_4_5,   0) AS ind_4_5,
        COALESCE(ind_6_10,  0) AS ind_6_10,
        COALESCE(ind_11_17, 0) AS ind_11_17,
        COALESCE(ind_18_24, 0) AS ind_18_24,
        COALESCE(ind_25_39, 0) AS ind_25_39,
        COALESCE(ind_40_54, 0) AS ind_40_54,
        COALESCE(ind_55_64, 0) AS ind_55_64,
        COALESCE(ind_65_79, 0) AS ind_65_79,
        COALESCE(ind_80p,   0) AS ind_80p,
        COALESCE(ind_inc,   0) AS population_inconnue,
        COALESCE(ind_snv,   0) AS revenu_median,
        COALESCE(men,       0) AS menages_total,
        COALESCE(men_pauv,  0) AS menages_pauvres,
        COALESCE(men_1ind,  0) AS menages_1_personne,
        COALESCE(men_5ind,  0) AS menages_5_plus,
        COALESCE(men_prop,  0) AS menages_proprietaires,
        COALESCE(men_fmp,   0) AS familles_monoparentales,
        COALESCE(men_mais,  0) AS menages_maison,
        COALESCE(men_coll,  0) AS menages_collectif,
        COALESCE(men_surf,  0) AS surface_moyenne,
        COALESCE(log_av45,  0) AS logements_avant_1945,
        COALESCE(log_45_70, 0) AS logements_1945_1970,
        COALESCE(log_70_90, 0) AS logements_1970_1990,
        COALESCE(log_ap90,  0) AS logements_apres_1990,
        COALESCE(log_soc,   0) AS logements_sociaux,
        COALESCE(log_inc,   0) AS logements_inconnus
      FROM carreaux_2km
      WHERE geom && v_bounds
    ) q;

  -- ── z 6-7 : carreaux 5km ────────────────────────────────────────────────────
  ELSE
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(geom, v_bounds, 4096, 0, true) AS geom,
        id                    AS idcar,
        COALESCE(ind,       0) AS population_totale,
        COALESCE(ind_0_3,   0) AS ind_0_3,
        COALESCE(ind_4_5,   0) AS ind_4_5,
        COALESCE(ind_6_10,  0) AS ind_6_10,
        COALESCE(ind_11_17, 0) AS ind_11_17,
        COALESCE(ind_18_24, 0) AS ind_18_24,
        COALESCE(ind_25_39, 0) AS ind_25_39,
        COALESCE(ind_40_54, 0) AS ind_40_54,
        COALESCE(ind_55_64, 0) AS ind_55_64,
        COALESCE(ind_65_79, 0) AS ind_65_79,
        COALESCE(ind_80p,   0) AS ind_80p,
        COALESCE(ind_inc,   0) AS population_inconnue,
        COALESCE(ind_snv,   0) AS revenu_median,
        COALESCE(men,       0) AS menages_total,
        COALESCE(men_pauv,  0) AS menages_pauvres,
        COALESCE(men_1ind,  0) AS menages_1_personne,
        COALESCE(men_5ind,  0) AS menages_5_plus,
        COALESCE(men_prop,  0) AS menages_proprietaires,
        COALESCE(men_fmp,   0) AS familles_monoparentales,
        COALESCE(men_mais,  0) AS menages_maison,
        COALESCE(men_coll,  0) AS menages_collectif,
        COALESCE(men_surf,  0) AS surface_moyenne,
        COALESCE(log_av45,  0) AS logements_avant_1945,
        COALESCE(log_45_70, 0) AS logements_1945_1970,
        COALESCE(log_70_90, 0) AS logements_1970_1990,
        COALESCE(log_ap90,  0) AS logements_apres_1990,
        COALESCE(log_soc,   0) AS logements_sociaux,
        COALESCE(log_inc,   0) AS logements_inconnus
      FROM carreaux_5km
      WHERE geom && v_bounds
    ) q;
  END IF;

  RETURN v_mvt;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tile(INTEGER, INTEGER, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION get_tile IS
'Tuiles MVT multi-résolution pour carreaux Filosofi.
z>=10 : carreaux_filosofi 200m | z8-9 : carreaux_2km | z6-7 : carreaux_5km
Colonnes exposées : noms matchant CARREAUX_INDICATEURS (frontend)
Prérequis : migration 034 exécutée pour carreaux_2km + carreaux_5km';

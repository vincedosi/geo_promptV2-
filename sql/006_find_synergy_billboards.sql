-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — find_synergy_billboards : Panneaux × POI × Démographie (v3)
-- À exécuter dans Supabase SQL Editor.
--
-- Prérequis :
--   - Table panneaux_affichage (id, lat, lng, reference_panneau, regie,
--                               type_panneau, ville, actif)
--   - Table poi_france (id, categorie, geom GEOMETRY SRID:4326)
--   - Table carreaux_filosofi (idcar, millesime, geom GEOMETRY SRID:4326, metadata JSONB)
--   - Index GIST sur poi_france.geom
--   - Index GIST sur carreaux_filosofi.geom
--
-- Optimisations v3 :
--   - Paramètre ville (obligatoire) → filtre LOWER(p.ville) pour réduire le scope
--   - CTE panneau_near_poi : buffer calculé une seule fois
--   - CTE scored : ST_Intersection calculé une seule fois
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION find_synergy_billboards(
  poi_category      text,
  max_distance_m    integer,
  target_demo_col   text,
  min_audience      numeric DEFAULT 0,
  buffer_radius_m   integer DEFAULT 300,
  ville             text    DEFAULT NULL   -- filtre ville sur panneaux_affichage.ville
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql        text;
  v_result     jsonb;
  v_latest_mil text;
  v_ville_cond text;
BEGIN
  -- Sanitize JSONB key name
  IF target_demo_col !~ '^[a-zA-Z][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid demographic column name: %', target_demo_col;
  END IF;

  -- Latest millesime
  SELECT MAX(millesime) INTO v_latest_mil FROM carreaux_filosofi;
  IF v_latest_mil IS NULL THEN
    RETURN '{"error": "No carreaux data available — import INSEE Filosofi data first."}'::jsonb;
  END IF;

  -- Ville condition (optional but strongly recommended for performance)
  IF ville IS NOT NULL AND ville <> '' THEN
    v_ville_cond := format('AND LOWER(p.ville) = LOWER(%L)', ville);
  ELSE
    v_ville_cond := '';
  END IF;

  v_sql := format($q$
    WITH panneau_near_poi AS (
      SELECT DISTINCT
        p.id,
        COALESCE(p.reference_panneau, p.id::text) AS reference_panneau,
        p.regie,
        p.type_panneau,
        p.ville,
        p.lat::float8,
        p.lng::float8,
        ST_Buffer(
          ST_SetSRID(ST_MakePoint(p.lng::float8, p.lat::float8), 4326)::geography,
          %s
        )::geometry AS panneau_buf
      FROM panneaux_affichage p
      WHERE p.actif = true
        AND p.lat IS NOT NULL AND p.lng IS NOT NULL
        AND p.lat <> 0 AND p.lng <> 0
        %s
        AND EXISTS (
          SELECT 1 FROM poi_france poi
          WHERE LOWER(poi.categorie) = LOWER(%L)
            AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(p.lng::float8, p.lat::float8), 4326)::geography,
              poi.geom::geography,
              %s
            )
        )
    ),
    scored AS (
      SELECT
        p.id::text,
        p.reference_panneau,
        p.regie,
        p.type_panneau,
        p.ville,
        p.lat,
        p.lng,
        ROUND(
          SUM(
            COALESCE((c.metadata->>%L)::numeric, 0)
            * ST_Area(ST_Intersection(p.panneau_buf, c.geom))
            / NULLIF(ST_Area(c.geom), 0)
          )::numeric,
          0
        ) AS audience_score
      FROM panneau_near_poi p
      JOIN carreaux_filosofi c
        ON c.millesime = %L
        AND (c.metadata->>%L) IS NOT NULL
        AND ST_Intersects(p.panneau_buf, c.geom)
      GROUP BY p.id, p.reference_panneau, p.regie, p.type_panneau, p.ville, p.lat, p.lng
    )
    SELECT COALESCE(jsonb_agg(r ORDER BY r.audience_score DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM scored
      WHERE audience_score >= %s
      ORDER BY audience_score DESC
      LIMIT 10
    ) r
  $q$,
    buffer_radius_m,   -- (1) ST_Buffer radius
    v_ville_cond,      -- (2) ville filter (raw SQL fragment)
    poi_category,      -- (3) POI category
    max_distance_m,    -- (4) ST_DWithin distance
    target_demo_col,   -- (5) SUM key
    v_latest_mil,      -- (6) millesime
    target_demo_col,   -- (7) IS NOT NULL key
    min_audience       -- (8) threshold
  );

  EXECUTE v_sql INTO v_result;
  RETURN COALESCE(v_result, '[]'::jsonb);

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION find_synergy_billboards(text, integer, text, numeric, integer, text)
  TO authenticated, service_role;

-- Test rapide avec ville
-- SELECT find_synergy_billboards('lycee', 500, 'Ind_18_24', 0, 300, 'Brest');

-- ═══════════════════════════════════════════════════════════════════════════
-- 042_cte_coverage_per_group.sql
--
-- Réécriture de calculate_coverage_per_group — CTE au lieu de temp table.
--
-- PROBLÈME avec migration 041 (temp table) :
--   Supabase utilise PgBouncer en mode TRANSACTION par défaut.
--   En mode transaction, chaque requête peut atterrir sur une connexion différente.
--   Les tables temporaires sont liées à une SESSION PostgreSQL.
--   → Le plan mis en cache référence l'OID de la temp table de la session précédente.
--   → Erreur : "could not open relation with OID XXXXX"
--
-- SOLUTION (migration 042) :
--   Remplacer CREATE TEMP TABLE + index GIST par une CTE WITH.
--   Pas de DDL, pas de temp table, pas de problème de session/OID.
--   Pour UN seul groupe (usage actuel), la CTE est équivalente en perf.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS calculate_coverage_per_group(JSONB, TEXT);

CREATE OR REPLACE FUNCTION calculate_coverage_per_group(
  p_groups JSONB,
  p_column TEXT DEFAULT 'ind'
)
RETURNS TABLE(group_id TEXT, coverage BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH groups_geom AS (
    SELECT
      grp->>'id' AS group_id,
      ST_MakeValid(
        ST_Simplify(
          ST_UnaryUnion(
            ST_Collect(
              ARRAY(
                SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326))
                FROM   jsonb_array_elements_text(grp->'geometries') g
                WHERE  g IS NOT NULL
              )
            )
          ),
          0.005
        )
      ) AS geom
    FROM jsonb_array_elements(p_groups) grp
    WHERE grp->>'id' IS NOT NULL
  )
  SELECT
    gg.group_id::TEXT,
    COALESCE(
      SUM(
        CASE p_column
          WHEN 'ind'       THEN COALESCE(cf.ind,       (cf.metadata->>'ind')::numeric)
          WHEN 'ind_18_24' THEN COALESCE(cf.ind_18_24, (cf.metadata->>'ind_18_24')::numeric)
          WHEN 'ind_25_39' THEN COALESCE(cf.ind_25_39, (cf.metadata->>'ind_25_39')::numeric)
          WHEN 'ind_40_54' THEN COALESCE(cf.ind_40_54, (cf.metadata->>'ind_40_54')::numeric)
          ELSE (cf.metadata->>p_column)::numeric
        END
      ),
      0
    )::BIGINT AS coverage
  FROM groups_geom gg
  LEFT JOIN carreaux_filosofi cf
    ON  cf.geom && gg.geom
    AND ST_Intersects(
          COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
          gg.geom
        )
  WHERE gg.geom IS NOT NULL
  GROUP BY gg.group_id
  ORDER BY 2 DESC;
$$;

COMMENT ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) IS
  'v3 — CTE (pas de temp table) : compatible PgBouncer transaction mode, pas de OID error';

GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO authenticated;

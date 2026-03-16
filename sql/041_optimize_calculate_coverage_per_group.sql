-- ═══════════════════════════════════════════════════════════════════════════
-- 041_optimize_calculate_coverage_per_group.sql
--
-- Optimisation majeure de calculate_coverage_per_group :
--
-- AVANT (v1) :
--   Boucle PL/pgSQL : N itérations × (ST_UnaryUnion + requête spatiale)
--   → 18 scans séquentiels de carreaux_filosofi (2.3M lignes) = timeout
--   → ST_Centroid(cf.geom) calculé en runtime si geom_centroid NULL
--
-- APRÈS (v2) :
--   1. Toutes les géométries unifiées dans UNE table temporaire (avec index GIST)
--   2. UN seul JOIN spatial carreaux × groupes (index des deux côtés)
--   3. Utilise cf.ind (colonne STORED de migration 026) pour le cas 'ind'
--   4. statement_timeout = '120s' (au lieu de '5min' qui ne suffisait pas)
--
-- Gains attendus : 10-20× plus rapide (1 scan au lieu de 18)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS calculate_coverage_per_group(JSONB, TEXT);

CREATE OR REPLACE FUNCTION calculate_coverage_per_group(
  p_groups JSONB,
  p_column TEXT DEFAULT 'ind'
)
RETURNS TABLE(group_id TEXT, coverage BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Timeout généreux : 120s pour un gros dataset (remplace SET LOCAL '5min')
  SET LOCAL statement_timeout = '120s';

  -- ── 1. Construire la table temporaire avec les géométries unifiées ─────────
  --    Une ligne par groupe, géométrie = union de tous ses paliers
  DROP TABLE IF EXISTS _cov_grp_tmp;

  CREATE TEMP TABLE _cov_grp_tmp AS
  SELECT
    grp->>'id'  AS group_id,
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
        0.005   -- ~500m : moins agressif que 0.01, meilleure précision
      )
    ) AS geom
  FROM jsonb_array_elements(p_groups) grp
  WHERE grp->>'id' IS NOT NULL;

  -- Index GIST sur la table temporaire (permet un nested-loop join efficace)
  CREATE INDEX ON _cov_grp_tmp USING GIST(geom);
  ANALYZE _cov_grp_tmp;

  -- ── 2. UN seul JOIN spatial pour TOUS les groupes ─────────────────────────
  --    Utilise les index GIST des deux côtés :
  --      cf.geom       → idx_carreaux_filosofi_geom       (migration 003)
  --      _cov_grp_tmp  → index créé juste au-dessus
  RETURN QUERY
  SELECT
    gg.group_id::TEXT,
    COALESCE(
      SUM(
        CASE p_column
          -- Colonne STORED (migration 026) : ~10× plus rapide que JSONB parsing
          WHEN 'ind'      THEN COALESCE(cf.ind,       (cf.metadata->>'ind')::numeric)
          WHEN 'ind_18_24' THEN COALESCE(cf.ind_18_24, (cf.metadata->>'ind_18_24')::numeric)
          WHEN 'ind_25_39' THEN COALESCE(cf.ind_25_39, (cf.metadata->>'ind_25_39')::numeric)
          WHEN 'ind_40_54' THEN COALESCE(cf.ind_40_54, (cf.metadata->>'ind_40_54')::numeric)
          -- Fallback JSONB pour toutes les autres colonnes
          ELSE (cf.metadata->>p_column)::numeric
        END
      ),
      0
    )::BIGINT AS coverage
  FROM _cov_grp_tmp gg
  LEFT JOIN carreaux_filosofi cf
    ON  cf.geom && gg.geom               -- bbox pré-filtre (index GIST cf.geom)
    AND ST_Intersects(                   -- test précis point-dans-polygone
          COALESCE(
            cf.geom_centroid,            -- colonne indexée si migration 016 faite
            ST_SetSRID(ST_Centroid(cf.geom), 4326)  -- fallback si NULL
          ),
          gg.geom
        )
  WHERE gg.geom IS NOT NULL
  GROUP BY gg.group_id
  ORDER BY 2 DESC;

  -- Nettoyage
  DROP TABLE IF EXISTS _cov_grp_tmp;
END;
$$;

COMMENT ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) IS
  'v2 — Couverture par groupe : 1 JOIN spatial (temp table + GIST) au lieu de N boucles';

GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO authenticated;

-- ── Bonus : s'assurer que l'index geom_centroid existe ───────────────────────
-- Si la migration 016 n'a pas été exécutée, l'index manque.
-- Crée-le ICI (bloquant ~2-5min sur 2.3M lignes) :
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carreaux_filosofi_geom_centroid
--   ON carreaux_filosofi USING GIST(geom_centroid);
--
-- IMPORTANT : décommenter et exécuter cette ligne SÉPARÉMENT dans Supabase
-- (l'UI affichera "timeout" mais l'opération continue en arrière-plan)

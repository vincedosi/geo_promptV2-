-- ═══════════════════════════════════════════════════════════════════════════
-- 043_plpgsql_loop_no_temptable.sql
--
-- 3ème réécriture de calculate_coverage_per_group.
--
-- HISTORIQUE DES PROBLÈMES :
--
--   Migration 034 (PL/pgSQL loop) :
--     ✓ Pas de temp table → pas d'OID error
--     ✗ N itérations × scan séquentiel → timeout pour 18 groupes
--
--   Migration 041 (temp table + JOIN unique) :
--     ✓ Rapide pour N groupes (1 seul scan)
--     ✗ Temp table incompatible PgBouncer transaction mode → OID error
--        "could not open relation with OID XXXXX"
--
--   Migration 042 (CTE) :
--     ✓ Pas de temp table → pas d'OID error
--     ✗ Planner ne connaît pas la taille de la géom CTE à la compilation
--        → choisit seq scan de 2.3M lignes au lieu du GIST → > 30s
--
--   Migration 043 (PL/pgSQL loop + enable_seqscan=off) :
--     ✓ Pas de temp table → pas d'OID error
--     ✓ Variable PL/pgSQL runtime → planner utilise GIST sur cf.geom
--     ✓ enable_seqscan=off : garantit usage GIST même si statistiques mauvaises
--     ✓ Rapide pour 1-3 groupes (notre usage : UN appel par CIRFA)
--
-- POURQUOI PL/pgSQL FORCE LE GIST :
--   En PL/pgSQL, la requête est planifiée avec v_geom comme paramètre ($1).
--   PostgreSQL utilise ALWAYS le GIST pour `cf.geom && $1` car le coût
--   d'un index GIST pour un bbox inconnu est toujours < seq scan 2.3M lignes.
--   enable_seqscan=off le garantit même en cas d'estimations statistics corrompues.
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
DECLARE
  v_row  JSONB;
  v_id   TEXT;
  v_geom geometry;
  v_cov  BIGINT;
BEGIN
  -- Force l'usage du GIST index sur cf.geom pour le bbox operator &&
  -- Sans ça, le planner peut choisir seq scan si statistiques dégradées
  SET LOCAL enable_seqscan = off;

  -- Timeout par groupe — JS AbortController à 30s, SQL à 25s pour avoir
  -- un message d'erreur propre ("canceling statement") avant le abort JS
  SET LOCAL statement_timeout = '25s';

  FOR v_row IN SELECT jsonb_array_elements(p_groups) LOOP
    v_id := v_row->>'id';
    IF v_id IS NULL THEN CONTINUE; END IF;

    -- ── Union des géométries du groupe ──────────────────────────────────
    SELECT ST_MakeValid(
      ST_Simplify(
        ST_UnaryUnion(
          ST_Collect(
            ARRAY(
              SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326))
              FROM   jsonb_array_elements_text(v_row->'geometries') g
              WHERE  g IS NOT NULL
            )
          )
        ),
        0.005  -- ~500m — bonne précision, réduit la complexité polygone
      )
    )
    INTO v_geom;

    IF v_geom IS NULL THEN
      group_id := v_id; coverage := 0; RETURN NEXT; CONTINUE;
    END IF;

    -- ── Croisement spatial avec carreaux_filosofi ────────────────────────
    -- cf.geom && v_geom   → GIST index idx_carreaux_filosofi_geom (bbox pré-filtre)
    -- ST_Intersects(...)  → test précis centroïde-dans-polygone
    SELECT COALESCE(SUM(
      CASE p_column
        -- Colonnes STORED (migration 026) : x10 vs parsing JSONB
        WHEN 'ind'       THEN COALESCE(cf.ind,       (cf.metadata->>'ind')::numeric)
        WHEN 'ind_18_24' THEN COALESCE(cf.ind_18_24, (cf.metadata->>'ind_18_24')::numeric)
        WHEN 'ind_25_39' THEN COALESCE(cf.ind_25_39, (cf.metadata->>'ind_25_39')::numeric)
        WHEN 'ind_40_54' THEN COALESCE(cf.ind_40_54, (cf.metadata->>'ind_40_54')::numeric)
        ELSE (cf.metadata->>p_column)::numeric
      END
    ), 0)::BIGINT
    INTO v_cov
    FROM carreaux_filosofi cf
    WHERE cf.geom && v_geom   -- GIST bbox pré-filtre (rapide)
      AND ST_Intersects(
            COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
            v_geom
          );

    group_id := v_id;
    coverage := COALESCE(v_cov, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) IS
  'v4 — PL/pgSQL loop sans temp table (compatible PgBouncer), enable_seqscan=off force GIST';

GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION calculate_coverage_per_group(JSONB, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 028_rpc_populate_carreaux_columns.sql
--
-- Fonction de remplissage par batch — appelée depuis Inngest step.run().
-- Met à jour max p_batch_size lignes (ind IS NULL) par appel.
-- Retourne le nombre de lignes mises à jour (0 = terminé).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION populate_carreaux_columns(
  p_batch_size INT DEFAULT 100000
)
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  UPDATE carreaux_filosofi
  SET
    ind       = (metadata->>'ind')::numeric,
    ind_18_24 = (metadata->>'ind_18_24')::numeric,
    ind_25_39 = (metadata->>'ind_25_39')::numeric,
    ind_40_54 = (metadata->>'ind_40_54')::numeric,
    ind_inc   = (metadata->>'ind_inc')::numeric
  WHERE id IN (
    SELECT id FROM carreaux_filosofi
    WHERE ind IS NULL
    LIMIT p_batch_size
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION populate_carreaux_columns(INT) TO service_role;

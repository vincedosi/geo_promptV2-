-- ── Migration 067 : RPC merge_iris_indicators_batch ─────────────────────────
-- Merge additif de la colonne JSONB indicators pour un batch de lignes IRIS.
-- Utilisé après l'upsert des colonnes core pour ajouter les indicateurs secondaires.
--
-- Entrée : tableau JSON [{code_iris: "012345678", indicators: {...}}, ...]
-- Comportement : iris.indicators = COALESCE(iris.indicators, '{}') || new_indicators
--                → les nouvelles clés s'ajoutent, les existantes sont écrasées,
--                  les clés absentes du nouvel import sont CONSERVÉES (pas de reset).

CREATE OR REPLACE FUNCTION public.merge_iris_indicators_batch(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.iris AS t
  SET indicators = COALESCE(t.indicators, '{}') || (r.ind)::JSONB
  FROM (
    SELECT
      (elem->>'code_iris')::TEXT       AS code_iris,
      elem->'indicators'               AS ind
    FROM jsonb_array_elements(p_rows) AS elem
    WHERE (elem->>'code_iris') IS NOT NULL
      AND elem->'indicators' IS NOT NULL
      AND jsonb_typeof(elem->'indicators') = 'object'
      AND elem->'indicators' != '{}'::jsonb
  ) AS r
  WHERE t.code_iris = r.code_iris;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Accès service_role uniquement
REVOKE ALL ON FUNCTION public.merge_iris_indicators_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_iris_indicators_batch(JSONB) TO service_role;

COMMENT ON FUNCTION public.merge_iris_indicators_batch IS
  'Merge additif de iris.indicators pour un batch. '
  'p_rows: [{code_iris, indicators: {...}}]. '
  'Opérateur || : conserve les clés existantes non présentes dans le nouvel import.';

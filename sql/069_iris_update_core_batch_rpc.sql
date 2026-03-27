-- ── Migration 069 : RPC update_iris_core_batch ────────────────────────────────
-- UPDATE uniquement (jamais INSERT) — évite les violations NOT NULL sur les
-- colonnes obligatoires (code_commune, nom_iris, etc.) lors des imports partiels.
-- Utilisé pour enrichir les colonnes core d'IRIS existants depuis des CSV INSEE.
--
-- Entrée : [{code_iris, population?, rev_median?, ...}]  (seules les clés présentes sont mises à jour)
-- Comportement : CASE WHEN r ? 'col' THEN new_val ELSE old_val END
--               → les colonnes absentes du JSON conservent leur valeur actuelle

CREATE OR REPLACE FUNCTION public.update_iris_core_batch(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.iris AS t
  SET
    population       = CASE WHEN r ? 'population'       THEN (r->>'population')::INTEGER       ELSE t.population       END,
    pop_0_14         = CASE WHEN r ? 'pop_0_14'         THEN (r->>'pop_0_14')::INTEGER         ELSE t.pop_0_14         END,
    pop_15_29        = CASE WHEN r ? 'pop_15_29'        THEN (r->>'pop_15_29')::INTEGER        ELSE t.pop_15_29        END,
    pop_30_44        = CASE WHEN r ? 'pop_30_44'        THEN (r->>'pop_30_44')::INTEGER        ELSE t.pop_30_44        END,
    pop_45_59        = CASE WHEN r ? 'pop_45_59'        THEN (r->>'pop_45_59')::INTEGER        ELSE t.pop_45_59        END,
    pop_60_74        = CASE WHEN r ? 'pop_60_74'        THEN (r->>'pop_60_74')::INTEGER        ELSE t.pop_60_74        END,
    pop_75_plus      = CASE WHEN r ? 'pop_75_plus'      THEN (r->>'pop_75_plus')::INTEGER      ELSE t.pop_75_plus      END,
    nb_menages       = CASE WHEN r ? 'nb_menages'       THEN (r->>'nb_menages')::INTEGER       ELSE t.nb_menages       END,
    rev_median       = CASE WHEN r ? 'rev_median'       THEN (r->>'rev_median')::FLOAT         ELSE t.rev_median       END,
    taux_chomage     = CASE WHEN r ? 'taux_chomage'     THEN (r->>'taux_chomage')::FLOAT       ELSE t.taux_chomage     END,
    taux_proprio     = CASE WHEN r ? 'taux_proprio'     THEN (r->>'taux_proprio')::FLOAT       ELSE t.taux_proprio     END,
    nb_diplome_aucun = CASE WHEN r ? 'nb_diplome_aucun' THEN (r->>'nb_diplome_aucun')::INTEGER ELSE t.nb_diplome_aucun END,
    nb_diplome_bac   = CASE WHEN r ? 'nb_diplome_bac'   THEN (r->>'nb_diplome_bac')::INTEGER   ELSE t.nb_diplome_bac   END,
    nb_diplome_sup   = CASE WHEN r ? 'nb_diplome_sup'   THEN (r->>'nb_diplome_sup')::INTEGER   ELSE t.nb_diplome_sup   END,
    taux_diplome_sup = CASE WHEN r ? 'taux_diplome_sup' THEN (r->>'taux_diplome_sup')::FLOAT   ELSE t.taux_diplome_sup END,
    nb_csp_cadre     = CASE WHEN r ? 'nb_csp_cadre'     THEN (r->>'nb_csp_cadre')::INTEGER     ELSE t.nb_csp_cadre     END,
    nb_csp_employe   = CASE WHEN r ? 'nb_csp_employe'   THEN (r->>'nb_csp_employe')::INTEGER   ELSE t.nb_csp_employe   END,
    nb_csp_ouvrier   = CASE WHEN r ? 'nb_csp_ouvrier'   THEN (r->>'nb_csp_ouvrier')::INTEGER   ELSE t.nb_csp_ouvrier   END
  FROM jsonb_array_elements(p_rows) AS r
  WHERE t.code_iris = (r->>'code_iris')::TEXT
    AND (r->>'code_iris') IS NOT NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_iris_core_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_iris_core_batch(JSONB) TO service_role;

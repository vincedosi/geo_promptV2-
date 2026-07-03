-- ── Migration 069 : RPC update_iris_core_batch ────────────────────────────────
-- ⚠️ PÉRIMÉ — remplacé par sql/081_update_iris_core_batch_v2.sql (définition
-- live : + rev_d1/rev_d9/taux_pauvrete/indice_gini/nb_emplois/taux_emploi
-- + indicateurs dérivés v2). Conservé pour l'historique. NE PAS RÉAPPLIQUER.
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
    nb_csp_ouvrier   = CASE WHEN r ? 'nb_csp_ouvrier'   THEN (r->>'nb_csp_ouvrier')::INTEGER   ELSE t.nb_csp_ouvrier   END,
    -- Indicateurs dérivés v2
    densite_pop               = CASE WHEN r ? 'densite_pop'               THEN (r->>'densite_pop')::FLOAT               ELSE t.densite_pop               END,
    indice_jeunesse           = CASE WHEN r ? 'indice_jeunesse'           THEN (r->>'indice_jeunesse')::FLOAT           ELSE t.indice_jeunesse           END,
    part_pop_etrangere        = CASE WHEN r ? 'part_pop_etrangere'        THEN (r->>'part_pop_etrangere')::FLOAT        ELSE t.part_pop_etrangere        END,
    part_pop_moins_18         = CASE WHEN r ? 'part_pop_moins_18'         THEN (r->>'part_pop_moins_18')::FLOAT         ELSE t.part_pop_moins_18         END,
    part_pop_65_plus          = CASE WHEN r ? 'part_pop_65_plus'          THEN (r->>'part_pop_65_plus')::FLOAT          ELSE t.part_pop_65_plus          END,
    part_residences_principales = CASE WHEN r ? 'part_residences_principales' THEN (r->>'part_residences_principales')::FLOAT ELSE t.part_residences_principales END,
    part_appartements         = CASE WHEN r ? 'part_appartements'         THEN (r->>'part_appartements')::FLOAT         ELSE t.part_appartements         END,
    part_logements_sociaux    = CASE WHEN r ? 'part_logements_sociaux'    THEN (r->>'part_logements_sociaux')::FLOAT    ELSE t.part_logements_sociaux    END,
    part_menages_emmenages_2ans = CASE WHEN r ? 'part_menages_emmenages_2ans' THEN (r->>'part_menages_emmenages_2ans')::FLOAT ELSE t.part_menages_emmenages_2ans END,
    part_familles_monoparentales = CASE WHEN r ? 'part_familles_monoparentales' THEN (r->>'part_familles_monoparentales')::FLOAT ELSE t.part_familles_monoparentales END,
    part_couples_avec_enfants = CASE WHEN r ? 'part_couples_avec_enfants' THEN (r->>'part_couples_avec_enfants')::FLOAT ELSE t.part_couples_avec_enfants END,
    part_actifs_marche_velo   = CASE WHEN r ? 'part_actifs_marche_velo'   THEN (r->>'part_actifs_marche_velo')::FLOAT   ELSE t.part_actifs_marche_velo   END,
    part_actifs_transport_commun = CASE WHEN r ? 'part_actifs_transport_commun' THEN (r->>'part_actifs_transport_commun')::FLOAT ELSE t.part_actifs_transport_commun END,
    part_hommes_actifs        = CASE WHEN r ? 'part_hommes_actifs'        THEN (r->>'part_hommes_actifs')::FLOAT        ELSE t.part_hommes_actifs        END,
    part_femmes_actives       = CASE WHEN r ? 'part_femmes_actives'       THEN (r->>'part_femmes_actives')::FLOAT       ELSE t.part_femmes_actives       END,
    part_sans_diplome         = CASE WHEN r ? 'part_sans_diplome'         THEN (r->>'part_sans_diplome')::FLOAT         ELSE t.part_sans_diplome         END,
    nb_emplois_commune        = CASE WHEN r ? 'nb_emplois_commune'        THEN (r->>'nb_emplois_commune')::FLOAT        ELSE t.nb_emplois_commune        END
  FROM jsonb_array_elements(p_rows) AS r
  WHERE t.code_iris = (r->>'code_iris')::TEXT
    AND (r->>'code_iris') IS NOT NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_iris_core_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_iris_core_batch(JSONB) TO service_role;

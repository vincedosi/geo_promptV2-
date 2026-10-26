-- =============================================================================
-- 282 — poi_france.region : « PACA » réécrit au nom du référentiel (retours du 26/10, T1)
-- =============================================================================
--
-- Six CIRFA (Toulon, Avignon, Marseille, Nice, Gap, Digne-les-Bains) portaient la région « PACA ». Le filtre par
-- région de `POST /api/map/pois` cherche les écritures du référentiel (`ecrituresDeLaRegion` :
-- « Provence-Alpes-Côte d'Azur » et sa variante sans accent) : choisir la région 93 rendait ZÉRO CIRFA, sans erreur.
--
-- C'est le même défaut que le point 19 de docs/audit/QUICK_WINS.md (`poi_france.departement` à trois formats) :
-- une colonne de localisation remplie différemment selon l'import. On corrige la donnée, pas la route — un alias
-- « PACA » dans `ecrituresDeLaRegion` aurait gardé l'écart en base. ⚠ Un RÉIMPORT de la source CIRFA réintroduirait
-- l'écart tant que l'import ne normalise pas la région.
--
-- Rejouable : la seconde exécution ne trouve plus de ligne « PACA » et le dit. Aucun DROP (base partagée).
DO $$
DECLARE
  v_nom text;
  v_n   integer;
BEGIN
  SELECT nom_region INTO v_nom FROM public.ref_regions WHERE code_region = '93';
  IF v_nom IS NULL THEN
    RAISE EXCEPTION 'ref_regions : région 93 absente, réécriture impossible';
  END IF;

  UPDATE public.poi_france SET region = v_nom WHERE region = 'PACA';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'sql/282 : % POI « PACA » réécrits en « % »', v_n, v_nom;
END
$$;

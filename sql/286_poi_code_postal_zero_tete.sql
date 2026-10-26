-- =============================================================================
-- 286 — poi_france.code_postal : le zéro de tête rendu aux CP des départements 01 à 09 (retours du 26/10, relecture 1, I-1)
-- =============================================================================
--
-- 16 POI (6 CIRFA, 10 BMW) portaient un code postal à 4 chiffres (`6300` Nice, `5000` Gap, `6250` Mougins…) : un
-- import l'avait lu comme un NOMBRE. Le filtre « code postal » de `POST /api/map/pois` (sql/283, T1) compare à 5
-- chiffres : ① code postal 06300 rendait ZÉRO CIRFA, sans erreur. Même défaut de colonne hétérogène que sql/282 et que
-- le point 19 de docs/audit/QUICK_WINS.md ; on corrige la donnée. ⚠ Un réimport de ces sources le réintroduirait tant
-- que l'import ne lit pas le CP comme du texte.
--
-- Rejouable : la seconde exécution ne trouve plus de CP à 4 chiffres et le dit. Aucun DROP (base partagée).
DO $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.poi_france SET code_postal = lpad(code_postal, 5, '0') WHERE code_postal ~ '^[0-9]{4}$';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'sql/286 : % codes postaux à 4 chiffres complétés d''un zéro de tête', v_n;
END
$$;

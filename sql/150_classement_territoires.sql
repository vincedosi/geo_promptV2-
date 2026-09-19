-- ============================================================================
-- sql/150 — Classement de territoires sur N'IMPORTE QUEL indicateur
-- ============================================================================
-- But : repondre a « les 10 villes ou les 15-29 ans pesent le plus, en volume
-- et en part » sans figer ni l'indicateur, ni le palier, ni le tri dans le
-- code. Les colonnes d'`iris` sont DYNAMIQUES (regle CLAUDE.md) : la fonction
-- decouvre l'indicateur dans `information_schema` et refuse tout ce qui n'est
-- pas une colonne numerique du palier demande.
--
-- Trois pieges mesures en base le 2026-09-12, que cette migration ferme.
--
--   1. LE POURCENTAGE SANS PLANCHER EST DU BRUIT. Sans seuil de population, le
--      classement en part rend Montferrat (1 720 habitants, 51,2 % de 15-29
--      ans) avant Lille. D'ou `p_plancher_population`.
--
--   2. PARIS, LYON ET MARSEILLE N'EXISTENT PAS comme communes entieres dans
--      `iris_agg_commune` : seuls leurs 45 arrondissements y sont (3 511 679
--      habitants cumules). Les codes 75056 / 69123 / 13055 sont ABSENTS — donc
--      aucun double comptage, mais un classement brut mettait Toulouse
--      premiere (166 790) alors que Paris entiere en compte 513 373.
--      `p_regrouper_arrondissements` reconstitue les trois villes.
--
--   3. SOMMER UN TAUX N'A AUCUN SENS, et c'est ce que faisait la premiere
--      version de cette fonction : regroupee, Marseille rendait un taux de
--      chomage de 234,4 — la somme de ses seize arrondissements. L'agregation
--      suit desormais `classe_iris()` (sql/138), source unique du projet :
--        effectif   -> SOMME
--        proportion -> MOYENNE PONDEREE par la population
--        densite    -> RECALCULEE sur les surfaces
--      Et la colonne `part` ne vaut que pour un effectif : une proportion EST
--      deja un pourcentage, une densite est un rapport a une surface. Un tri
--      par part sur autre chose qu'un effectif leve une erreur explicite
--      plutot que de rendre une colonne de zeros.
--
-- La correspondance arrondissement -> commune mere est une DONNEE (45 lignes
-- derivees des codes reellement presents), pas un CASE en dur : `ref_communes`
-- ne porte aucun lien vers la commune mere.
-- ============================================================================

-- ── Correspondance arrondissement -> commune mere ───────────────────────────
CREATE TABLE IF NOT EXISTS public.communes_arrondissements (
  code_arrondissement text PRIMARY KEY,
  code_commune_mere   text NOT NULL,
  nom_commune_mere    text NOT NULL
);

ALTER TABLE public.communes_arrondissements ENABLE ROW LEVEL SECURITY;

-- Seed derive des codes REELLEMENT presents, pas d'une liste tapee a la main.
-- Les trois seules communes a arrondissements de France (loi PLM, 1982) :
-- Paris 751xx (20), Lyon 693 81-89 (9), Marseille 132xx (16).
INSERT INTO public.communes_arrondissements (code_arrondissement, code_commune_mere, nom_commune_mere)
SELECT c.code,
       CASE
         WHEN c.code LIKE '751%' THEN '75056'
         WHEN c.code LIKE '693%' THEN '69123'
         WHEN c.code LIKE '132%' THEN '13055'
       END,
       CASE
         WHEN c.code LIKE '751%' THEN 'Paris'
         WHEN c.code LIKE '693%' THEN 'Lyon'
         WHEN c.code LIKE '132%' THEN 'Marseille'
       END
FROM public.iris_agg_commune c
WHERE c.nom ILIKE '%Arrondissement%'
  AND (c.code LIKE '751%' OR c.code LIKE '693%' OR c.code LIKE '132%')
ON CONFLICT (code_arrondissement) DO NOTHING;

-- ── Le classement ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.classer_territoires(text, text, text, integer, integer, boolean);

CREATE FUNCTION public.classer_territoires(
  p_indicateur                text,
  p_palier                    text    DEFAULT 'commune',
  p_tri                       text    DEFAULT 'volume',
  p_plancher_population       integer DEFAULT 0,
  p_limite                    integer DEFAULT 10,
  p_regrouper_arrondissements boolean DEFAULT true
) RETURNS TABLE (
  code       text,
  nom        text,
  population numeric,
  valeur     numeric,
  part       numeric,
  classe     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_table   text;
  v_limite  integer := LEAST(GREATEST(COALESCE(p_limite, 10), 1), 100);
  v_seuil   integer := GREATEST(COALESCE(p_plancher_population, 0), 0);
  v_classe  text;
  v_agg     text;
  v_part    text;
  v_ordre   text;
  v_sql     text;
BEGIN
  -- Palier : liste fermee, c'est un nom de TABLE qui part en SQL dynamique.
  v_table := CASE p_palier
    WHEN 'commune'     THEN 'iris_agg_commune'
    WHEN 'departement' THEN 'iris_agg_departement'
    ELSE NULL
  END;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'palier inconnu : % (attendu : commune ou departement)', p_palier;
  END IF;

  IF p_tri NOT IN ('volume', 'part') THEN
    RAISE EXCEPTION 'tri inconnu : % (attendu : volume ou part)', p_tri;
  END IF;

  -- L'indicateur doit etre une colonne NUMERIQUE EXISTANTE du palier demande.
  -- C'est la seule barriere entre un argument texte et du SQL dynamique.
  -- Verifie : classer_territoires('population; drop table iris --') leve
  -- « indicateur inconnu ou non numerique ».
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_table AND column_name = p_indicateur
      AND data_type IN ('integer','bigint','numeric','real','double precision','smallint')
  ) THEN
    RAISE EXCEPTION 'indicateur inconnu ou non numerique au palier % : %', p_palier, p_indicateur;
  END IF;

  -- CLASSE DE L'INDICATEUR — source unique du projet (classe_iris, sql/138),
  -- derivee du NOM et jamais d'une liste en dur.
  v_classe := public.classe_iris(p_indicateur);

  v_agg := CASE v_classe
    WHEN 'effectif'   THEN 'SUM(valeur)'
    WHEN 'proportion' THEN 'SUM(valeur * population) / NULLIF(SUM(population), 0)'
    WHEN 'densite'    THEN 'SUM(valeur * superficie) / NULLIF(SUM(superficie), 0)'
    ELSE 'SUM(valeur)'
  END;

  v_part := CASE WHEN v_classe = 'effectif'
                 THEN 'ROUND(100.0 * valeur / NULLIF(population, 0), 1)'
                 ELSE 'NULL::numeric' END;

  IF p_tri = 'part' AND v_classe <> 'effectif' THEN
    RAISE EXCEPTION 'tri par part impossible : % est de classe % et s''exprime deja en valeur relative — trier par volume',
      p_indicateur, v_classe;
  END IF;

  v_ordre := CASE p_tri WHEN 'part' THEN 'part' ELSE 'valeur' END;

  IF p_palier = 'commune' AND p_regrouper_arrondissements THEN
    v_sql := format($q$
      WITH brut AS (
        SELECT COALESCE(a.code_commune_mere, t.code) AS code,
               COALESCE(a.nom_commune_mere,  t.nom)  AS nom,
               t.population::numeric                 AS population,
               t.%1$I::numeric                        AS valeur,
               t.superficie_km2::numeric              AS superficie
        FROM public.%2$I t
        LEFT JOIN public.communes_arrondissements a ON a.code_arrondissement = t.code
        WHERE t.population IS NOT NULL AND t.%1$I IS NOT NULL
      ), groupe AS (
        SELECT code, MIN(nom) AS nom, SUM(population) AS population, %3$s AS valeur
        FROM brut GROUP BY code
      ), calcul AS (
        SELECT code, nom, population, valeur, %4$s AS part FROM groupe
      )
      SELECT code, nom, population, valeur, part, %6$L::text AS classe
      FROM calcul WHERE population >= %5$s
      ORDER BY %7$s DESC NULLS LAST LIMIT %8$s
    $q$, p_indicateur, v_table, v_agg, v_part, v_seuil, v_classe, v_ordre, v_limite);
  ELSE
    v_sql := format($q$
      WITH base AS (
        SELECT t.code, t.nom, t.population::numeric AS population, t.%1$I::numeric AS valeur
        FROM public.%2$I t
        WHERE t.population IS NOT NULL AND t.%1$I IS NOT NULL AND t.population >= %3$s
      ), calcul AS (
        SELECT code, nom, population, valeur, %4$s AS part FROM base
      )
      SELECT code, nom, population, valeur, part, %5$L::text AS classe
      FROM calcul ORDER BY %6$s DESC NULLS LAST LIMIT %7$s
    $q$, p_indicateur, v_table, v_seuil, v_part, v_classe, v_ordre, v_limite);
  END IF;

  RETURN QUERY EXECUTE v_sql;
END;
$fn$;

REVOKE ALL ON FUNCTION public.classer_territoires(text, text, text, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classer_territoires(text, text, text, integer, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.classer_territoires(text, text, text, integer, integer, boolean) IS
  'Classe les territoires d''un palier sur n''importe quel indicateur numerique. '
  'Agregation selon classe_iris (effectif=somme, proportion=moyenne ponderee par '
  'la population, densite=recalculee sur les surfaces). sql/150.';

-- ============================================================================
-- CONTROLES joues le 2026-09-12 (a rejouer apres tout import IRIS)
-- ============================================================================
-- classer_territoires('pop_15_29','commune','volume',0,10,true)
--   -> Paris 513 373 (24,3 %) · Marseille 170 198 · Toulouse 166 790 · Lyon 151 839
-- classer_territoires('pop_15_29','commune','part',50000,5,true)
--   -> Lille 36,8 % · Nancy 36,4 % · Poitiers 36,0 % · Rennes 34,1 % · Rouen 33,4 %
--      (des villes universitaires — signal que le volume seul ne donne pas)
-- classer_territoires('taux_chomage','commune','volume',50000,5,true)
--   -> Saint-Laurent-du-Maroni 44,9 · part NULL · classe proportion
--      (avant correction : Marseille 234,4 — la somme de 16 arrondissements)
-- classer_territoires('population; drop table iris --')  -> EXCEPTION
-- ============================================================================

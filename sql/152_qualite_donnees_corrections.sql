-- ============================================================================
-- sql/152_qualite_donnees_corrections.sql — corrections de relecture (2026-09-13)
--
-- La page /admin/qualite-donnees a ete relue par un agent independant le jour
-- de sa livraison. Verdict : elle tenait ses promesses techniques (cout annonce
-- exact, injection fermee, droits corrects) mais RASSURAIT A TORT sur trois
-- points mesures, et une quatrieme fonction allait casser d'elle-meme.
--
-- C'est le defaut que cette page prétend combattre, trouve dans la page
-- elle-meme. D'ou ces corrections, et surtout d'ou les tests qui les
-- asservissent desormais (tests/unit/qualite/verdicts.test.ts) : la livraison
-- initiale n'en avait AUCUN.
--
-- F1 — POLLEN ET ATMO ETAIENT DECLARES « ok » SANS AUCUN CONTROLE.
--   Aucune branche du CASE ne les atteignait : `m.n_lignes = 0` vaut NULL et
--   non TRUE quand la ligne de journal n'existe pas, et les autres branches
--   ne visaient que `iris_column`. Ils tombaient donc dans le `ELSE 'ok'`.
--   La page annoncait « les 19 indicateurs actifs pointent vers des donnees
--   exploitables » JUSTE AU-DESSUS d'un encadre annoncant leur source figee
--   depuis 72 jours : elle se contredisait elle-meme, et c'est la
--   contradiction rassurante qui s'affichait en premier.
--   Deux verdicts ajoutes : `perime` et `non_verifie`. « Je n'ai pas regarde »
--   et « j'ai regarde, tout va bien » ne se disent plus du meme mot.
--
-- F2 — PLANTAGE PROGRAMME A 50 COLONNES.
--   `jsonb_build_object` construisait 2 arguments par colonne ; PostgreSQL
--   plafonne a 100 arguments par fonction. Mesure : 41 colonnes = 82 arguments,
--   soit NEUF colonnes de marge — et `iris_indicator_registry` declare 51
--   indicateurs pour 41 colonnes presentes, donc les dix manquantes sont
--   exactement ce qu'un prochain import doit apporter. La fonction ecrite pour
--   survivre aux colonnes dynamiques serait morte au premier import qui en
--   ajoute. Remplace par une concatenation `||` (aucun plafond), toujours en
--   UN SEUL balayage.
--
-- F8 — LA COUVERTURE ETAIT COMPTEE EN LIGNES, PAS EN POPULATION.
--   `iris` melange 16 404 vrais IRIS urbains et 33 044 communes-IRIS rurales :
--   un ratio de lignes ne dit rien de l'audience, et l'audience est ce qu'on
--   achete. Mesure : `rev_median` couvre 29 % des lignes mais 57 % des
--   habitants. Et le cas symetrique est pire — une colonne renseignee sur les
--   seules communes rurales ferait 67 % des lignes pour 40 % de la population,
--   donc « ok ». Le verdict se fonde desormais sur `pop_couverte`.
--
-- F9 — SEUIL DE COUVERTURE CP EN DUR.
--   `n_cp < 3000` = 48 % des 6 187 codes postaux : un indicateur couvrant la
--   moitie de la France passait « ok ». Le seul repere reel disponible,
--   `abstention_pres_2022` a 6 186/6 187, montre qu'une materialisation saine
--   couvre ~100 %. Le seuil se derive maintenant de `ref_codes_postaux`.
--
-- F3 — TOLERANCES 75 A 3 000 FOIS PLUS LARGES QUE LE BRUIT OBSERVE.
--   A 0,5 % sur la population, l'invariant laissait disparaitre 338 802
--   habitants — la Corse entiere — sans broncher. Resserrees a 0,01 % et 0,1 %.
--
-- F4 — LES INVARIANTS NE REGARDAIENT JAMAIS LA COUVERTURE.
--   Chaque moyenne ponderee porte un FILTER sur les lignes renseignees. Un
--   import qui ferait tomber `rev_median` de 14 480 a 3 000 IRIS laisserait la
--   moyenne des survivants a quelques euros de l'attendu : vert, 80 % de la
--   donnee disparue. `n_renseignes` et `pop_couverte` sont desormais rendus.
--
-- F6 — NOUVEL INVARIANT DE CASCADE, ET IL A TROUVE UN VRAI DEFAUT.
--   « Chaque palier agrege doit redonner la population d'iris. » Au premier
--   lancement : ROMPU aux deux paliers, -91 189 habitants. Cause trouvee et
--   corrigee en sql/153. Le palier departement est desormais EXACT ; le palier
--   commune garde un ecart structurel de 80 253 habitants (82 IRIS dont la
--   commune est absente de `ref_communes`), que cet invariant mesure en continu
--   au lieu de le laisser dans une note de documentation.
--
-- F7 — FAUX POSITIF PROGRAMME. `civic_health_cache` est un cache A LA DEMANDE ;
--   lui poser une cadence quotidienne le marquait perime apres un week-end sans
--   consultation. Un outil qui crie au loup sur une non-anomalie perd la
--   credibilite dont il a besoin pour les vraies alertes.
--
-- F10 — TRI SUR DU TEXTE. `'9' > '72'` : une source 9 jours en retard passait
--   AVANT une source 72 jours en retard. Tri numerique.
--
-- F12 — `derniere_ingestion` (updated_at) ajoutee a cote de `derniere_donnee`
--   (max(date_ech)) : la seconde est un horizon de PREVISION, pas une preuve
--   d'ingestion. Si l'ingest ecrivait un jour J+1, l'age deviendrait negatif et
--   la source ne pourrait plus JAMAIS etre signalee perimee, meme ingest muet.
--
-- LIMITE CONNUE, NON CORRIGEE : la liste des sources de `qualite_fraicheur`
-- reste ecrite a la main, contrairement a la regle du fichier sql/149. Deux
-- paliers de la cascade IRIS y ont ete ajoutes, mais la derivation complete
-- (registre de sources) reste a faire.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.qualite_colonnes_iris()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_cols text[];
  v_sql  text;
  v_res  jsonb;
  v_n    bigint;
  v_pop  bigint;
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'iris'
    AND data_type IN ('integer','numeric','double precision','real','bigint','smallint')
    AND column_name NOT IN ('centroid_lat','centroid_lng')
    AND column_name NOT LIKE '%\_id';

  IF v_cols IS NULL THEN
    RETURN jsonb_build_object('n_lignes', 0, 'population_totale', 0, 'colonnes', '{}'::jsonb);
  END IF;

  -- Concatenation par || et NON un jsonb_build_object variadique : PostgreSQL
  -- plafonne a 100 arguments par fonction, soit 50 colonnes (F2).
  SELECT 'SELECT ' || string_agg(
      format(
        'jsonb_build_object(%L, jsonb_build_object('
        || '''renseignes'', count(%I),'
        || ' ''non_nuls'', count(*) FILTER (WHERE %I IS NOT NULL AND %I <> 0),'
        || ' ''pop_couverte'', coalesce(sum(population) FILTER (WHERE %I IS NOT NULL), 0)))',
        c, c, c, c, c),
      E' ||\n       ') || ', count(*), coalesce(sum(population),0) FROM public.iris'
    INTO v_sql
  FROM unnest(v_cols) AS c;

  EXECUTE v_sql INTO v_res, v_n, v_pop;

  RETURN jsonb_build_object('n_lignes', v_n, 'population_totale', v_pop, 'colonnes', v_res);
END $fn$;

COMMENT ON FUNCTION public.qualite_colonnes_iris() IS
  'Remplissage de CHAQUE colonne numerique d iris, en UN SEUL balayage (sql/149, corrige sql/152). Concatenation par || et non un jsonb_build_object variadique : PostgreSQL plafonne a 100 arguments par fonction, soit 50 colonnes, et iris en compte deja 41 — la fonction ecrite pour survivre aux colonnes dynamiques serait morte au premier import qui en ajoute dix. Rend aussi pop_couverte : une couverture comptee en LIGNES ne dit rien de l audience, puisque iris melange 16404 vrais IRIS urbains et 33044 communes-IRIS rurales.';

CREATE OR REPLACE FUNCTION public.qualite_indicateurs()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_cols   jsonb;
  v_n_iris bigint;
  v_pop    bigint;
  v_n_cp   bigint;
  v_res    jsonb;
BEGIN
  v_cols   := public.qualite_colonnes_iris();
  v_n_iris := (v_cols->>'n_lignes')::bigint;
  v_pop    := (v_cols->>'population_totale')::bigint;
  v_n_cp   := (SELECT count(*) FROM public.ref_codes_postaux);

  SELECT jsonb_agg(x ORDER BY (x->>'gravite')::int DESC, x->>'label')
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
      'indicator_code', r.indicator_code,
      'label',          r.label,
      'famille',        r.famille,
      'data_source',    r.data_source,
      'data_column',    r.data_column,
      'n_source',       CASE WHEN r.data_source = 'iris_column'
                             THEN ((v_cols->'colonnes'->r.data_column)->>'renseignes')::bigint END,
      'n_total_source', CASE WHEN r.data_source = 'iris_column' THEN v_n_iris END,
      'part_population', CASE WHEN r.data_source = 'iris_column' AND v_pop > 0
                              THEN round((((v_cols->'colonnes'->r.data_column)->>'pop_couverte')::numeric
                                          / v_pop) * 100, 1) END,
      'n_cp',            m.n_lignes,
      'n_cp_reference',  v_n_cp,
      'cp_calcules_le',  m.computed_at,
      'age_source_jours', src.age_jours,
      'verdict', s.verdict,
      'gravite', CASE s.verdict
                   WHEN 'colonne_absente' THEN 4
                   WHEN 'source_vide'     THEN 4
                   WHEN 'perime'          THEN 3
                   WHEN 'non_verifie'     THEN 2
                   WHEN 'partiel'         THEN 1
                   ELSE 0 END
    ) AS x
    FROM public.cible_indicator_registry r
    LEFT JOIN public.indicator_cp_materializations m ON m.indicator_code = r.indicator_code
    CROSS JOIN LATERAL (
      SELECT CASE r.data_source
               WHEN 'pollen' THEN (SELECT (current_date - max(date_ech)) FROM public.pollen_map_daily)
               WHEN 'atmo'   THEN (SELECT (current_date - max(date_ech)) FROM public.atmo_map_daily)
             END AS age_jours
    ) src
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN r.data_source = 'iris_column' AND (v_cols->'colonnes'->r.data_column) IS NULL
          THEN 'colonne_absente'
        WHEN r.data_source = 'iris_column'
             AND coalesce(((v_cols->'colonnes'->r.data_column)->>'renseignes')::bigint, 0) = 0
          THEN 'source_vide'
        WHEN m.n_lignes = 0 THEN 'source_vide'
        -- F1 : une source quotidienne figee n est PAS « ok ».
        WHEN r.data_source IN ('pollen','atmo') AND src.age_jours IS NULL
          THEN 'source_vide'
        WHEN r.data_source IN ('pollen','atmo') AND src.age_jours > 3
          THEN 'perime'
        -- F1 : jamais materialise et non mesurable ici = NON VERIFIE, pas « ok ».
        WHEN r.data_source <> 'iris_column' AND m.indicator_code IS NULL
          THEN 'non_verifie'
        -- F8 : la couverture qui compte est celle de la POPULATION.
        WHEN r.data_source = 'iris_column' AND v_pop > 0
             AND ((v_cols->'colonnes'->r.data_column)->>'pop_couverte')::numeric / v_pop < 0.8
          THEN 'partiel'
        -- F9 : seuil derive du referentiel, plus un 3000 en dur.
        WHEN m.n_lignes IS NOT NULL AND v_n_cp > 0
             AND m.n_lignes::numeric / v_n_cp < 0.9
          THEN 'partiel'
        ELSE 'ok'
      END AS verdict
    ) s
    WHERE r.active
  ) q;

  RETURN jsonb_build_object(
    'n_iris', v_n_iris, 'population_totale', v_pop, 'n_cp_reference', v_n_cp,
    'indicateurs', COALESCE(v_res, '[]'::jsonb));
END $fn$;

COMMENT ON FUNCTION public.qualite_indicateurs() IS
  'Quels indicateurs ACTIFS du registre pointent vers du vide, du partiel, du perime ou du non verifie (sql/149, corrige sql/152). Trois faux negatifs fermes : pollen/atmo etaient declares « ok » sans AUCUN controle (aucune branche ne les atteignait, m.n_lignes = 0 valant NULL et non TRUE) ; la couverture etait comptee en LIGNES alors qu iris melange 16404 IRIS urbains et 33044 communes rurales, donc elle est desormais mesuree en POPULATION ; et le seuil de couverture CP etait un 3000 en dur, il se derive maintenant de ref_codes_postaux.';

CREATE OR REPLACE FUNCTION public.qualite_invariants()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  WITH base AS (
    SELECT
      sum(population)::numeric AS pop,
      count(*)::numeric        AS n_iris,
      sum(coalesce(pop_0_14,0) + coalesce(pop_15_29,0) + coalesce(pop_30_44,0)
        + coalesce(pop_45_59,0) + coalesce(pop_60_74,0) + coalesce(pop_75_plus,0))::numeric AS pop_tranches,
      (sum(taux_proprio::numeric * population) FILTER (WHERE taux_proprio IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE taux_proprio IS NOT NULL), 0))::numeric AS proprio,
      count(*) FILTER (WHERE taux_proprio IS NOT NULL)::numeric AS n_proprio,
      (sum(part_logements_sociaux::numeric * population) FILTER (WHERE part_logements_sociaux IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE part_logements_sociaux IS NOT NULL), 0))::numeric AS social,
      count(*) FILTER (WHERE part_logements_sociaux IS NOT NULL)::numeric AS n_social,
      (sum(rev_median::numeric * population) FILTER (WHERE rev_median IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE rev_median IS NOT NULL), 0))::numeric AS revenu,
      count(*) FILTER (WHERE rev_median IS NOT NULL)::numeric AS n_revenu,
      sum(population) FILTER (WHERE rev_median IS NOT NULL)::numeric AS pop_revenu
    FROM public.iris
  ), attendus(cle, libelle, attendu, tolerance, unite, mesure, n_renseignes, pop_couverte) AS (
    SELECT 'population', 'Population France (somme des IRIS)', 67760552::numeric, 0.0001::numeric, 'hab',
           b.pop, b.n_iris, b.pop FROM base b
    UNION ALL SELECT 'proprietaires', 'Part de proprietaires', 58.60::numeric, 0.001::numeric, '%',
           b.proprio, b.n_proprio, NULL::numeric FROM base b
    UNION ALL SELECT 'logements_sociaux', 'Part de logements sociaux', 14.97::numeric, 0.001::numeric, '%',
           b.social, b.n_social, NULL::numeric FROM base b
    UNION ALL SELECT 'revenu_median', 'Revenu median pondere', 23097::numeric, 0.001::numeric, 'EUR',
           b.revenu, b.n_revenu, b.pop_revenu FROM base b
    UNION ALL SELECT 'somme_tranches_age', 'Somme des tranches d age vs population', b.pop, 0.0001::numeric, 'hab',
           b.pop_tranches, b.n_iris, NULL::numeric FROM base b
    -- F6 : les deux paliers de la cascade IRIS doivent redonner la population.
    -- Au premier lancement : ROMPUS tous les deux, -91 189 habitants. Cause
    -- trouvee et corrigee en sql/153 pour le palier departement ; le palier
    -- commune garde un ecart structurel de 80 253 habitants (82 IRIS dont la
    -- commune est absente de ref_communes), desormais MESURE en continu au lieu
    -- de vivre dans une note de documentation.
    UNION ALL SELECT 'palier_departement', 'Population du palier departement vs IRIS', b.pop, 0.0001::numeric, 'hab',
           (SELECT sum(population)::numeric FROM public.iris_agg_departement), NULL::numeric, NULL::numeric FROM base b
    UNION ALL SELECT 'palier_commune', 'Population du palier commune vs IRIS', b.pop, 0.0001::numeric, 'hab',
           (SELECT sum(population)::numeric FROM public.iris_agg_commune), NULL::numeric, NULL::numeric FROM base b
  )
  SELECT jsonb_build_object('mesure_le', now(), 'controles', jsonb_agg(c ORDER BY (c->>'ok')::boolean, c->>'libelle'))
  FROM (
    SELECT jsonb_build_object(
      'cle', a.cle, 'libelle', a.libelle, 'unite', a.unite,
      'attendu', round(a.attendu, 2),
      'mesure', round(a.mesure, 2),
      'ecart_absolu', round(a.mesure - a.attendu, 2),
      'ecart_relatif', round(abs(a.mesure - a.attendu) / nullif(a.attendu, 0), 6),
      'tolerance', a.tolerance,
      'n_renseignes', a.n_renseignes,
      'pop_couverte', a.pop_couverte,
      'ok', coalesce(abs(a.mesure - a.attendu) / nullif(a.attendu, 0) <= a.tolerance, false)
    ) AS c
    FROM attendus a
  ) s;
$fn$;

COMMENT ON FUNCTION public.qualite_invariants() IS
  'Invariants metier chiffres (sql/149, corrige sql/152). Tolerances resserrees au bruit REELLEMENT observe : a 0,5 %, l ancienne version laissait disparaitre 338 802 habitants — la Corse entiere — sans broncher. Rend aussi la COUVERTURE de chaque moyenne ponderee : sans elle, un import qui ferait tomber rev_median de 14480 a 3000 IRIS laisserait la moyenne des survivants a quelques euros de l attendu, donc vert, 80 % de la donnee disparue. Et deux invariants de cascade : chaque palier agrege doit redonner la population d iris. ATTENTION : ces invariants ne filtrent PAS is_true_iris, contrairement a la regle generale de CLAUDE.md, et c est VOULU — sur les 16404 vrais IRIS la population tombe a 40443988 et tous les attendus deviennent faux. Ne pas « corriger » ce point.';

CREATE OR REPLACE FUNCTION public.qualite_fraicheur()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  -- F10 : tri NUMERIQUE. Sur du texte, '9' > '72' faisait passer une source
  -- 9 jours en retard AVANT une source 72 jours en retard.
  SELECT jsonb_build_object('mesure_le', now(),
    'sources', jsonb_agg(s ORDER BY (s->>'age_jours')::int DESC NULLS LAST))
  FROM (
    SELECT jsonb_build_object(
      'table', 'pollen_map_daily', 'libelle', 'Pollen par code postal',
      'derniere_donnee', (SELECT max(date_ech) FROM public.pollen_map_daily),
      -- F12 : max(date_ech) est un horizon de PREVISION, pas une preuve
      -- d ingestion. Si l ingest ecrivait un jour J+1, l age deviendrait
      -- negatif et la source ne pourrait plus JAMAIS etre signalee perimee.
      'derniere_ingestion', (SELECT max(updated_at)::date FROM public.pollen_map_daily),
      'n_lignes', (SELECT count(*) FROM public.pollen_map_daily),
      'cadence_attendue_jours', 1,
      'alimentation', 'cron Inngest civic-daily-ingest (05h30 Europe/Paris)',
      'age_jours', (SELECT (current_date - max(date_ech)) FROM public.pollen_map_daily)
    ) AS s
    UNION ALL SELECT jsonb_build_object(
      'table', 'atmo_map_daily', 'libelle', 'Qualite de l air par code postal',
      'derniere_donnee', (SELECT max(date_ech) FROM public.atmo_map_daily),
      'derniere_ingestion', (SELECT max(updated_at)::date FROM public.atmo_map_daily),
      'n_lignes', (SELECT count(*) FROM public.atmo_map_daily),
      'cadence_attendue_jours', 1,
      'alimentation', 'cron Inngest civic-daily-ingest (05h30 Europe/Paris)',
      'age_jours', (SELECT (current_date - max(date_ech)) FROM public.atmo_map_daily)
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'indicator_cp_values', 'libelle', 'Indicateurs par code postal',
      'derniere_donnee', (SELECT max(computed_at)::date FROM public.indicator_cp_values),
      'derniere_ingestion', (SELECT max(computed_at)::date FROM public.indicator_cp_values),
      'n_lignes', (SELECT count(*) FROM public.indicator_cp_values),
      'cadence_attendue_jours', NULL,
      'alimentation', 'materialisation a la demande (lib/analyses/indicateurs.ts)',
      'age_jours', (SELECT (current_date - max(computed_at)::date) FROM public.indicator_cp_values)
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'civic_health_cache', 'libelle', 'Cache ATMO + pollen par commune',
      'derniere_donnee', (SELECT max(fetched_at)::date FROM public.civic_health_cache),
      'derniere_ingestion', (SELECT max(fetched_at)::date FROM public.civic_health_cache),
      'n_lignes', (SELECT count(*) FROM public.civic_health_cache),
      -- F7 : cache A LA DEMANDE, donc AUCUNE cadence attendue. Lui en poser une
      -- le marquait perime apres un week-end sans consultation — un outil qui
      -- crie au loup sur une non-anomalie perd la credibilite dont il a besoin
      -- pour les vraies alertes.
      'cadence_attendue_jours', NULL,
      'alimentation', 'cache TTL 24 h a la demande — aucune cadence attendue',
      'age_jours', (SELECT (current_date - max(fetched_at)::date) FROM public.civic_health_cache)
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'iris_agg_departement', 'libelle', 'Palier departement de la cascade IRIS',
      'derniere_donnee', NULL, 'derniere_ingestion', NULL,
      'n_lignes', (SELECT count(*) FROM public.iris_agg_departement),
      'cadence_attendue_jours', NULL,
      'alimentation', 'construire_iris_agg — a rejouer apres tout import IRIS',
      'age_jours', NULL
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'iris_bornes_echelle', 'libelle', 'Bornes nationales de l echelle IRIS',
      'derniere_donnee', NULL, 'derniere_ingestion', NULL,
      'n_lignes', (SELECT count(*) FROM public.iris_bornes_echelle),
      'cadence_attendue_jours', NULL,
      'alimentation', 'construire_iris_bornes — a rejouer apres tout import IRIS',
      'age_jours', NULL
    )
  ) t;
$fn$;

COMMENT ON FUNCTION public.qualite_fraicheur() IS
  'Age de chaque source a cadence attendue (sql/149, corrige sql/152). Le champ alimentation evite LE contresens : une table figee alimentee par un cron signale un cron qui ne tourne pas, pas une donnee absente a la source. Tri NUMERIQUE — sur le texte, « 9 jours » passait avant « 72 jours ». civic_health_cache n a plus de cadence attendue : c est un cache a la demande, et le marquer perime apres un week-end sans consultation etait un faux positif. LIMITE CONNUE : la liste des sources est encore ecrite a la main, contrairement a la regle du fichier sql/149.';

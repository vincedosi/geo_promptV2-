-- ============================================================================
-- sql/149_qualite_donnees.sql — état des données manquantes (2026-09-13)
--
-- Rend mesurable ce qui ne lève aucune erreur. C'est le silence de ces trous
-- qui les rend coûteux : une donnée absente se lit comme un RÉSULTAT, et
-- oriente un achat média. Six relevés en une seule journée de travail sur les
-- scores, dont `part_couples_enfants` — actif au registre donc proposé à
-- l'utilisateur, et pointant sur une colonne vide sur les 49 448 IRIS.
--
-- QUATRE FAMILLES, jamais mélangées :
--   absente   → la colonne source ne contient rien
--   partielle → elle ne couvre qu'une part du territoire
--   périmée   → la donnée existe mais date
--   fausse    → elle existe, est fraîche, et ment
--
-- RÈGLE DE CONSTRUCTION : aucune liste de colonnes écrite à la main. Tout se
-- dérive d'`information_schema` et de `cible_indicator_registry`. Les colonnes
-- d'`iris` sont dynamiques (CLAUDE.md) : une liste tapée serait périmée au
-- prochain import, en silence — le problème même que ces fonctions résolvent,
-- réintroduit dans l'outil qui le résout.
--
-- RÈGLE D'I/O : une vérification à la fois, et le résultat est PERSISTÉ.
-- Le balayage des colonnes d'`iris` coûte ~220 Mo de lecture et 1,4 s (mesuré) ;
-- recalculé à chaque affichage, sur un Nano plafonné à 5 Mo/s et 250 IOPS, ce
-- serait l'incident du 28/03 rejoué — par l'outil censé prévenir ce genre de
-- défaut.
-- ============================================================================

-- ── 1. Remplissage des colonnes d'iris — UN SEUL balayage ──────────────────
--
-- `get_iris_fill_status` (préexistante) fait la même chose avec un COUNT PAR
-- COLONNE, soit ~40 balayages d'`iris` (~8,8 Go). Elle confond aussi une
-- colonne vide avec une colonne légitimement pleine de zéros, son test étant
-- `IS NOT NULL AND > 0`. Ici : un seul balayage, et `renseignes` (NOT NULL)
-- distingué de `non_nuls`.
CREATE OR REPLACE FUNCTION public.qualite_colonnes_iris()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_cols text[];
  v_sql  text;
  v_res  jsonb;
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'iris'
    AND data_type IN ('integer','numeric','double precision','real','bigint','smallint')
    AND column_name NOT IN ('centroid_lat','centroid_lng')
    AND column_name NOT LIKE '%_id';

  IF v_cols IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT format(
    'SELECT jsonb_build_object(%s) FROM public.iris',
    string_agg(
      format('%L, jsonb_build_object(''renseignes'', count(%I), ''non_nuls'', count(*) FILTER (WHERE %I IS NOT NULL AND %I <> 0))', c, c, c, c),
      ', ')
  ) INTO v_sql
  FROM unnest(v_cols) AS c;

  EXECUTE v_sql INTO v_res;

  RETURN jsonb_build_object(
    'n_lignes', (SELECT count(*) FROM public.iris),
    'colonnes', v_res
  );
END $fn$;

COMMENT ON FUNCTION public.qualite_colonnes_iris() IS
  'Taux de remplissage de CHAQUE colonne numerique d iris, en UN SEUL balayage (sql/149). Se distingue de get_iris_fill_status, qui fait un COUNT par colonne (~40 balayages) et confond une colonne vide avec une colonne pleine de zeros : ici renseignes (NOT NULL) et non_nuls sont rendus separement. Colonnes decouvertes dans information_schema — jamais une liste ecrite a la main, les colonnes d iris sont dynamiques.';

-- ── 2. Indicateurs du registre pointant vers du vide ───────────────────────
--
-- LA vérification la plus rentable du lot : une seule requête, et elle aurait
-- attrapé `part_couples_enfants` avant qu'un score ne soit calculé dessus.
CREATE OR REPLACE FUNCTION public.qualite_indicateurs()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_cols    jsonb;
  v_n_iris  bigint;
  v_res     jsonb;
BEGIN
  v_cols   := public.qualite_colonnes_iris();
  v_n_iris := (v_cols->>'n_lignes')::bigint;

  SELECT jsonb_agg(x ORDER BY x->>'verdict' DESC, x->>'label')
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
      'indicator_code', r.indicator_code,
      'label',          r.label,
      'famille',        r.famille,
      'data_source',    r.data_source,
      'data_column',    r.data_column,
      'n_source',       CASE WHEN r.data_source = 'iris_column'
                             THEN ((v_cols->'colonnes'->r.data_column)->>'renseignes')::bigint
                             ELSE NULL END,
      'n_total_source', CASE WHEN r.data_source = 'iris_column' THEN v_n_iris ELSE NULL END,
      'n_cp',           m.n_lignes,
      'cp_calcules_le', m.computed_at,
      'verdict', CASE
        WHEN r.data_source = 'iris_column' AND (v_cols->'colonnes'->r.data_column) IS NULL
          THEN 'colonne_absente'
        WHEN r.data_source = 'iris_column'
             AND COALESCE(((v_cols->'colonnes'->r.data_column)->>'renseignes')::bigint, 0) = 0
          THEN 'source_vide'
        WHEN m.n_lignes = 0 THEN 'source_vide'
        WHEN r.data_source = 'iris_column'
             AND ((v_cols->'colonnes'->r.data_column)->>'renseignes')::numeric / NULLIF(v_n_iris, 0) < 0.5
          THEN 'partiel'
        WHEN m.n_lignes IS NOT NULL AND m.n_lignes < 3000 THEN 'partiel'
        ELSE 'ok'
      END
    ) AS x
    FROM public.cible_indicator_registry r
    LEFT JOIN public.indicator_cp_materializations m ON m.indicator_code = r.indicator_code
    WHERE r.active
  ) s;

  RETURN jsonb_build_object('n_iris', v_n_iris, 'indicateurs', COALESCE(v_res, '[]'::jsonb));
END $fn$;

COMMENT ON FUNCTION public.qualite_indicateurs() IS
  'Quels indicateurs ACTIFS du registre pointent vers une colonne vide, partielle ou absente (sql/149). C est la verification la plus rentable du lot : elle aurait attrape part_couples_enfants — 0 renseigne sur 49448 IRIS, actif au registre donc propose a l utilisateur — avant qu un score ne soit calcule dessus.';

-- ── 3. Fraîcheur des sources à cadence attendue ────────────────────────────
--
-- `alimentation` évite LE contresens de cette famille : une table figée
-- alimentée par un cron ne dit pas que la source est muette, mais que le cron
-- ne tourne pas. Étiqueter un trou de déploiement en trou de données enverrait
-- chercher au mauvais endroit.
CREATE OR REPLACE FUNCTION public.qualite_fraicheur()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  SELECT jsonb_build_object('mesure_le', now(), 'sources', jsonb_agg(s ORDER BY s->>'age_jours' DESC NULLS FIRST))
  FROM (
    SELECT jsonb_build_object(
      'table', 'pollen_map_daily', 'libelle', 'Pollen par code postal',
      'derniere_donnee', (SELECT max(date_ech) FROM public.pollen_map_daily),
      'n_lignes', (SELECT count(*) FROM public.pollen_map_daily),
      'cadence_attendue_jours', 1,
      'alimentation', 'cron Inngest civic-daily-ingest (05h30 Europe/Paris)',
      'age_jours', (SELECT (current_date - max(date_ech)) FROM public.pollen_map_daily)
    ) AS s
    UNION ALL SELECT jsonb_build_object(
      'table', 'atmo_map_daily', 'libelle', 'Qualite de l air par code postal',
      'derniere_donnee', (SELECT max(date_ech) FROM public.atmo_map_daily),
      'n_lignes', (SELECT count(*) FROM public.atmo_map_daily),
      'cadence_attendue_jours', 1,
      'alimentation', 'cron Inngest civic-daily-ingest (05h30 Europe/Paris)',
      'age_jours', (SELECT (current_date - max(date_ech)) FROM public.atmo_map_daily)
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'indicator_cp_values', 'libelle', 'Indicateurs par code postal',
      'derniere_donnee', (SELECT max(computed_at)::date FROM public.indicator_cp_values),
      'n_lignes', (SELECT count(*) FROM public.indicator_cp_values),
      'cadence_attendue_jours', NULL,
      'alimentation', 'materialisation a la demande (lib/analyses/indicateurs.ts)',
      'age_jours', (SELECT (current_date - max(computed_at)::date) FROM public.indicator_cp_values)
    )
    UNION ALL SELECT jsonb_build_object(
      'table', 'civic_health_cache', 'libelle', 'Cache ATMO + pollen par commune',
      'derniere_donnee', (SELECT max(fetched_at)::date FROM public.civic_health_cache),
      'n_lignes', (SELECT count(*) FROM public.civic_health_cache),
      'cadence_attendue_jours', 1,
      'alimentation', 'cache TTL 24 h a la demande',
      'age_jours', (SELECT (current_date - max(fetched_at)::date) FROM public.civic_health_cache)
    )
  ) t;
$fn$;

COMMENT ON FUNCTION public.qualite_fraicheur() IS
  'Age de chaque source a cadence attendue (sql/149). Le champ alimentation est la pour eviter LE contresens : une table figee alimentee par un cron Inngest ne signale pas une donnee manquante a la source, mais un cron qui ne tourne pas. Etiqueter un trou de deploiement en trou de donnees enverrait chercher au mauvais endroit.';

-- ============================================================================
-- 4. Invariants metier, valides contre l'INSEE
--
-- Seule famille qui detecte une donnee FAUSSE. Les quatre premieres valeurs
-- sont exactement celles qui ont valide la cascade IRIS (ARCHITECTURE.md) ; la
-- cinquieme est structurelle : les six tranches d'age doivent redonner la
-- population.
--
-- Mesure du 2026-09-13 : les cinq passent. Population EXACTEMENT 67 760 552,
-- somme des tranches d'age a 366 personnes pres (0,001 %, arrondis INSEE).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.qualite_invariants()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $fn$
  WITH base AS (
    SELECT
      sum(population)::numeric AS pop,
      sum(coalesce(pop_0_14,0) + coalesce(pop_15_29,0) + coalesce(pop_30_44,0)
        + coalesce(pop_45_59,0) + coalesce(pop_60_74,0) + coalesce(pop_75_plus,0))::numeric AS pop_tranches,
      sum(taux_proprio * population) FILTER (WHERE taux_proprio IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE taux_proprio IS NOT NULL), 0) AS proprio,
      sum(part_logements_sociaux * population) FILTER (WHERE part_logements_sociaux IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE part_logements_sociaux IS NOT NULL), 0) AS social,
      sum(rev_median * population) FILTER (WHERE rev_median IS NOT NULL)
        / nullif(sum(population) FILTER (WHERE rev_median IS NOT NULL), 0) AS revenu
    FROM public.iris
  ), attendus(cle, libelle, attendu, tolerance, unite) AS (
    VALUES
      ('population',       'Population France (somme des IRIS)', 67760552::numeric, 0.005::numeric, 'hab'),
      ('proprietaires',    'Part de proprietaires',                  58.60::numeric, 0.02::numeric,  '%'),
      ('logements_sociaux','Part de logements sociaux',              14.97::numeric, 0.02::numeric,  '%'),
      ('revenu_median',    'Revenu median pondere',                  23097::numeric, 0.02::numeric,  'EUR')
  )
  SELECT jsonb_build_object('mesure_le', now(), 'controles', jsonb_agg(c ORDER BY c->>'ok'))
  FROM (
    SELECT jsonb_build_object(
      'cle', a.cle, 'libelle', a.libelle, 'unite', a.unite,
      'attendu', a.attendu,
      'mesure', round(m.valeur::numeric, 2),
      'ecart_relatif', round(abs(m.valeur::numeric - a.attendu) / nullif(a.attendu, 0), 5),
      'tolerance', a.tolerance,
      'ok', abs(m.valeur::numeric - a.attendu) / nullif(a.attendu, 0) <= a.tolerance
    ) AS c
    FROM attendus a
    JOIN LATERAL (
      SELECT CASE a.cle
        WHEN 'population'        THEN b.pop
        WHEN 'proprietaires'     THEN b.proprio
        WHEN 'logements_sociaux' THEN b.social
        ELSE b.revenu END AS valeur
      FROM base b
    ) m ON true

    UNION ALL
    SELECT jsonb_build_object(
      'cle', 'somme_tranches_age', 'libelle', 'Somme des tranches d age vs population',
      'unite', 'hab',
      'attendu', b.pop, 'mesure', b.pop_tranches,
      'ecart_relatif', round(abs(b.pop_tranches - b.pop) / nullif(b.pop, 0), 5),
      'tolerance', 0.01::numeric,
      'ok', abs(b.pop_tranches - b.pop) / nullif(b.pop, 0) <= 0.01
    )
    FROM base b
  ) s;
$fn$;

COMMENT ON FUNCTION public.qualite_invariants() IS
  'Invariants metier chiffres, valides contre l INSEE (sql/149) : population 67760552, proprietaires 58,60 %, logements sociaux 14,97 %, revenu median 23097 EUR — les memes que ceux ayant valide la cascade IRIS — plus un invariant structurel (somme des six tranches d age = population). Seule famille qui detecte une donnee FAUSSE, par opposition a absente, partielle ou perimee.';

-- ============================================================================
-- Releves persistes
--
-- Rouvrir la page lit CETTE table, jamais les tables sources : la verification
-- des colonnes iris coute ~220 Mo de lecture et 1,4 s (mesure). Recalculee a
-- chaque affichage, sur un Nano plafonne a 5 Mo/s et 250 IOPS, ce serait
-- l'incident du 28/03 rejoue — par l'outil cense prevenir ce genre de defaut.
-- L'utilisateur voit la donnee ET sa date, et decide de relancer.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.qualite_releves (
  verification text PRIMARY KEY,
  releve       jsonb       NOT NULL,
  calcule_le   timestamptz NOT NULL DEFAULT now(),
  duree_ms     integer
);

COMMENT ON TABLE public.qualite_releves IS
  'Dernier releve de chaque verification de qualite des donnees (sql/149). Rouvrir la page lit CETTE table, jamais les tables sources : la verification des colonnes iris coute ~220 Mo de lecture, recalculee a chaque affichage ce serait l incident du 28/03 rejoue. L utilisateur voit la donnee ET sa date, et decide de relancer.';

-- Deny-all : les routes passent en service_role, comme les autres tables de service.
ALTER TABLE public.qualite_releves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.qualite_colonnes_iris() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualite_colonnes_iris() TO service_role;
REVOKE ALL ON FUNCTION public.qualite_indicateurs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualite_indicateurs() TO service_role;
REVOKE ALL ON FUNCTION public.qualite_fraicheur() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualite_fraicheur() TO service_role;
REVOKE ALL ON FUNCTION public.qualite_invariants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualite_invariants() TO service_role;

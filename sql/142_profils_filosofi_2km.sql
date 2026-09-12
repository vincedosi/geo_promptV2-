-- sql/142 — Profilage Filosofi sur le palier 2 km (EXPERIMENTAL, non substitue).
-- Applique le 2026-09-12 (MCP Supabase).
--
-- ── LE PROBLEME, MESURE ────────────────────────────────────────────────────
-- `compute_filosofi_profiles_batch` coute 19 818 ms pour 5 POI (EXPLAIN
-- ANALYZE, BMW 30 min voiture) : ~4 s par POI, 15 852 lectures disque, avec
-- debordement en temp. Un clustering de 254 POI depasse 17 minutes ; un
-- clustering national se compte en heures. C'est cette phase qui a fait
-- depasser un delai de 9 minutes lors de la validation.
--
-- La cause n'est pas la geometrie, c'est le JSONB : la fonction joint
-- `carreaux_filosofi` (2,3 M lignes, 4,6 Go) et extrait VINGT-SIX champs de
-- `metadata` par carreau, chacun detoaste, parse puis caste. Meme goulot que
-- sur les tuiles (ARCHITECTURE.md : « son jsonb de 806 o/ligne impose un
-- plancher d'environ 4 s par tuile froide »).
--
-- ── LA VARIANTE ────────────────────────────────────────────────────────────
-- `carreaux_2km` porte EXACTEMENT les memes grandeurs en COLONNES TYPEES —
-- 122 018 lignes, aucun jsonb. Pour un isochrone de 15 a 30 minutes, une maille
-- de 2 km est une approximation acceptable : la fonction d'origine teste deja
-- l'appartenance par le CENTROIDE du carreau, elle est donc deja discrete.
--
-- ── RESULTATS MESURES (memes 5 POI) ────────────────────────────────────────
--   vitesse   19 818 ms -> 2 543 ms          (7,8x)
--   disque    15 852 -> 2 636 lectures       (6x), plus de debordement temp
--
--   ecart sur les variables, moyenne / max :
--     revenu_moyen        0,52 % / 0,95 %      pct_55_79    0,59 % / 1,34 %
--     pct_0_17            0,61 % / 1,74 %      pct_18_39    0,70 % / 2,00 %
--     pct_40_54           0,71 % / 1,59 %      taux_pauvrete 2,04 % / 3,91 %
--     surface_moyenne     2,24 % / 3,53 %      taux_isoles  2,91 % / 5,46 %
--     taux_proprietaires  3,30 % / 5,36 %      taux_collectif 7,85 % / 14,16 %
--     population_totale  11,79 % / 21,80 %   <-- le seul ecart important
--
-- ── CE QUE CA VEUT DIRE ────────────────────────────────────────────────────
-- Les SEIZE variables du modele (FEATURE_NAMES) sont toutes des RATIOS, et
-- derivent de moins de 3,5 % sauf `taux_collectif`. `population_totale`, seule
-- grandeur a deriver fortement, N'EST PAS une variable du modele : elle est
-- affichee (`poi_clusters.population_totale_couverte`).
--
-- Recommandation (docs/PLAN_CLUSTERING.md) : profiler au 2 km, et recalculer
-- la population au 200 m A LA DEMANDE, pour le seul POI consulte. On paie 4 s
-- une fois a la consultation au lieu de 4 s x N a chaque entrainement.
--
-- CETTE FONCTION NE REMPLACE RIEN pour l'instant. Substituer un palier
-- d'agregation change les resultats : ce n'est pas un choix a faire en silence.
--
-- Seule difference de schema : `carreaux_2km` n'a pas de colonne `log`
-- (logements totaux). Elle se reconstitue par somme des tranches, `log_inc`
-- compris — l'omettre sous-estimerait le denominateur de taux_hlm et
-- taux_ancien.

CREATE OR REPLACE FUNCTION public.compute_filosofi_profiles_batch_2km(
  p_entries jsonb,
  p_secret_stat numeric DEFAULT 11
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH
  entries AS (
    SELECT (e->>'poi_id') AS poi_id, (e->>'cache_key') AS cache_key
    FROM jsonb_array_elements(p_entries) AS e
    WHERE (e->>'poi_id') IS NOT NULL AND (e->>'cache_key') IS NOT NULL
  ),
  isos AS (
    SELECT entries.poi_id,
           ST_MakeValid(COALESCE(ic.geom_simplified, ic.geom)) AS iso_geom
    FROM entries
    JOIN isochrones_cache ic ON ic.cache_key = entries.cache_key
    WHERE COALESCE(ic.geom_simplified, ic.geom) IS NOT NULL
  ),
  pairs AS (
    SELECT isos.poi_id, c.*,
      (p_secret_stat <= 0 OR COALESCE(c.ind, 0) > p_secret_stat) AS ok
    FROM isos
    JOIN carreaux_2km c
      ON c.geom && isos.iso_geom
     AND ST_Intersects(ST_Centroid(c.geom), isos.iso_geom)
  ),
  agg AS (
    SELECT poi_id,
      COUNT(*) FILTER (WHERE ok)::int AS n_carreaux, COUNT(*)::int AS n_total,
      SUM(COALESCE(ind,0))      FILTER (WHERE ok) AS v_ind,
      SUM(COALESCE(ind_0_3,0))  FILTER (WHERE ok) AS v_0_3,
      SUM(COALESCE(ind_4_5,0))  FILTER (WHERE ok) AS v_4_5,
      SUM(COALESCE(ind_6_10,0)) FILTER (WHERE ok) AS v_6_10,
      SUM(COALESCE(ind_11_17,0))FILTER (WHERE ok) AS v_11_17,
      SUM(COALESCE(ind_18_24,0))FILTER (WHERE ok) AS v_18_24,
      SUM(COALESCE(ind_25_39,0))FILTER (WHERE ok) AS v_25_39,
      SUM(COALESCE(ind_40_54,0))FILTER (WHERE ok) AS v_40_54,
      SUM(COALESCE(ind_55_64,0))FILTER (WHERE ok) AS v_55_64,
      SUM(COALESCE(ind_65_79,0))FILTER (WHERE ok) AS v_65_79,
      SUM(COALESCE(ind_80p,0))  FILTER (WHERE ok) AS v_80p,
      SUM(COALESCE(ind_snv,0))  FILTER (WHERE ok) AS v_snv,
      SUM(COALESCE(men,0))      FILTER (WHERE ok) AS v_men,
      SUM(COALESCE(men_pauv,0)) FILTER (WHERE ok) AS v_pauv,
      SUM(COALESCE(men_prop,0)) FILTER (WHERE ok) AS v_prop,
      SUM(COALESCE(men_coll,0)) FILTER (WHERE ok) AS v_coll,
      SUM(COALESCE(men_mais,0)) FILTER (WHERE ok) AS v_mais,
      SUM(COALESCE(log_soc,0))  FILTER (WHERE ok) AS v_log_soc,
      SUM(COALESCE(men_1ind,0)) FILTER (WHERE ok) AS v_1ind,
      SUM(COALESCE(men_5ind,0)) FILTER (WHERE ok) AS v_5ind,
      SUM(COALESCE(men_fmp,0))  FILTER (WHERE ok) AS v_fmp,
      SUM(COALESCE(log_av45,0) + COALESCE(log_45_70,0) + COALESCE(log_70_90,0)
        + COALESCE(log_ap90,0) + COALESCE(log_inc,0)) FILTER (WHERE ok) AS v_log,
      SUM(COALESCE(log_av45,0)) FILTER (WHERE ok) AS v_av45,
      SUM(COALESCE(log_ap90,0)) FILTER (WHERE ok) AS v_ap90,
      SUM(COALESCE(men_surf,0)) FILTER (WHERE ok) AS v_surf
    FROM pairs GROUP BY poi_id
  ),
  profiles AS (
    SELECT poi_id,
      jsonb_build_object(
        'n_carreaux', n_carreaux, 'n_carreaux_total', n_total,
        'cov_rate', ROUND(n_carreaux::numeric / NULLIF(n_total, 0), 4),
        'population_totale', v_ind,
        'pct_0_17',  ROUND(COALESCE((v_0_3+v_4_5+v_6_10+v_11_17)/NULLIF(v_ind,0),0)::numeric,4),
        'pct_18_39', ROUND(COALESCE((v_18_24+v_25_39)/NULLIF(v_ind,0),0)::numeric,4),
        'pct_40_54', ROUND(COALESCE(v_40_54/NULLIF(v_ind,0),0)::numeric,4),
        'pct_55_79', ROUND(COALESCE((v_55_64+v_65_79)/NULLIF(v_ind,0),0)::numeric,4),
        'pct_80p',   ROUND(COALESCE(v_80p/NULLIF(v_ind,0),0)::numeric,4),
        'revenu_moyen', ROUND(COALESCE((v_snv/NULLIF(v_ind,0))/20000.0,0)::numeric,4),
        'taux_pauvrete',      ROUND(COALESCE(v_pauv/NULLIF(v_men,0),0)::numeric,4),
        'taux_proprietaires', ROUND(COALESCE(v_prop/NULLIF(v_men,0),0)::numeric,4),
        'taux_collectif',     ROUND(COALESCE(v_coll/NULLIF(v_coll+v_mais,0),0)::numeric,4),
        'taux_hlm',           ROUND(COALESCE(v_log_soc/NULLIF(v_log,0),0)::numeric,4),
        'taux_isoles',        ROUND(COALESCE(v_1ind/NULLIF(v_men,0),0)::numeric,4),
        'taux_grandes_fam',   ROUND(COALESCE(v_5ind/NULLIF(v_men,0),0)::numeric,4),
        'taux_mono_parental', ROUND(COALESCE(v_fmp/NULLIF(v_men,0),0)::numeric,4),
        'taux_ancien',     ROUND(COALESCE(v_av45/NULLIF(v_log,0),0)::numeric,4),
        'taux_recent',     ROUND(COALESCE(v_ap90/NULLIF(v_log,0),0)::numeric,4),
        'surface_moyenne', ROUND(COALESCE(v_surf/NULLIF(v_men,0),0)::numeric,2)
      ) AS profile
    FROM agg WHERE n_carreaux > 0 AND v_ind > 0
  )
SELECT COALESCE(jsonb_object_agg(poi_id, profile), '{}'::jsonb) FROM profiles;
$function$;

REVOKE ALL ON FUNCTION public.compute_filosofi_profiles_batch_2km(jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_filosofi_profiles_batch_2km(jsonb, numeric) TO service_role;

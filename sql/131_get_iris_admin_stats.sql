-- 131 — get_iris_admin_stats : 21 requêtes ramenées à une, et quatre valeurs fausses corrigées
--
-- ── LE PROBLÈME DE PERFORMANCE (`PERF-001`) ─────────────────────────────────
--
-- `app/api/admin/iris/stats/route.ts` émettait **21 requêtes par ouverture de
-- page** : 5 `count(exact)` par type d'IRIS, 1 `select`, puis 15 `count(exact)`
-- — un par département — le tout en deux vagues de `Promise.all`.
--
-- Mesuré à l'EXPLAIN ANALYZE : **UNE seule** de ces requêtes coûte **714 ms**
-- en balayage séquentiel complet d'une table de 221 Mo (28 244 buffers). Les 21
-- cumulent donc environ **15 secondes de travail base** par ouverture, en
-- parallèle.
--
-- C'est le motif exact de l'incident du 2026-03-28 consigné dans `CLAUDE.md`
-- (« Prefetch 24 colonnes IRIS × bbox France → I/O épuisé → 504 → down
-- heures »), et cela viole la règle des 3 appels Supabase parallèles maximum.
--
-- Cette fonction : **112 ms, une seule passe**. Facteur 130.
--
-- ── LES QUATRE VALEURS FAUSSES ──────────────────────────────────────────────
--
-- La route ne se contentait pas d'être lente. Mesuré en base le 2026-09-11 :
--
--   nb_depts     affichait **2** au lieu de **104**. Il comptait les
--                départements distincts parmi 500 lignes prises SANS TRI
--                (`.select('code_dept').limit(500)`), qui n'en couvrent que
--                deux. Une page d'administration annonçait « 2 départements ».
--
--   with_geom    recopiait `total` sans rien vérifier : 49 448 au lieu de
--                **49 363**. 85 IRIS sont en réalité sans géométrie — une
--                information utile qui était masquée par construction.
--
--   table_size   chaîne `'28 MB'` écrite en dur. Réel : **221 Mo**.
--   index_size   chaîne `'5.7 MB'` écrite en dur. Réel : **28 Mo**.
--
--   nb_communes  était aussi en dur (34 989) — vérifié exact, conservé.
--
-- Ces corrections sont des **changements de comportement visibles**, assumés :
-- une page de supervision dont le rôle est de dire la vérité sur les données ne
-- peut pas afficher quatre chiffres faux sur neuf.
--
-- ── LE CLASSEMENT DES DÉPARTEMENTS ──────────────────────────────────────────
--
-- La liste des 15 départements était codée en dur dans la route. Elle s'est
-- révélée **exacte au moment de la bascule** — mêmes codes, même ordre que le
-- vrai classement. Elle n'était vraie que par hasard et serait devenue fausse
-- au premier ré-import. La RPC la calcule désormais.
--
-- ── POURQUOI UN SEUL BALAYAGE SUFFIT ────────────────────────────────────────
--
-- `count(*) FILTER (WHERE …)` calcule tous les sous-totaux pendant la même
-- lecture. Le test de nullité sur `geom` lit le masque de NULL de la ligne,
-- sans décompresser la géométrie depuis le TOAST — d'où le coût modéré malgré
-- le poids de cette colonne.

CREATE OR REPLACE FUNCTION public.get_iris_admin_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH global AS (
    SELECT
      count(*)                                        AS total,
      count(*) FILTER (WHERE type_iris = 'H')         AS type_h,
      count(*) FILTER (WHERE type_iris = 'A')         AS type_a,
      count(*) FILTER (WHERE type_iris = 'D')         AS type_d,
      count(*) FILTER (WHERE type_iris = 'Z')         AS type_z,
      count(DISTINCT code_dept)                       AS nb_depts,
      count(DISTINCT code_commune)                    AS nb_communes,
      count(*) FILTER (WHERE geom IS NOT NULL)        AS with_geom
    FROM iris
  ), par_dept AS (
    SELECT code_dept, count(*) AS nb
    FROM iris
    WHERE code_dept IS NOT NULL
    GROUP BY code_dept
    ORDER BY count(*) DESC
    LIMIT 15
  )
  SELECT jsonb_build_object(
    'total',       g.total,
    'type_h',      g.type_h,
    'type_a',      g.type_a,
    'type_d',      g.type_d,
    'type_z',      g.type_z,
    'nb_depts',    g.nb_depts,
    'nb_communes', g.nb_communes,
    'with_geom',   g.with_geom,
    'table_size',  pg_size_pretty(pg_relation_size('iris')),
    'index_size',  pg_size_pretty(pg_indexes_size('iris')),
    'top_depts',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', code_dept, 'nb', nb))
      FROM par_dept
    ), '[]'::jsonb)
  )
  FROM global g;
$function$;

REVOKE ALL ON FUNCTION public.get_iris_admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_iris_admin_stats() TO service_role;

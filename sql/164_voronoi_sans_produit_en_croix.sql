-- ============================================================================
-- sql/164 — get_voronoi_by_category : supprimer le produit en croix (2026-09-13)
--
-- Point 9 de docs/audit/QUICK_WINS.md. L'audit concluait « mettre le Voronoï
-- derrière une file d'attente, un calcul à la fois par organisation », sur la
-- foi de 79 718 ms de moyenne et 6 277 170 blocs disque.
--
-- La file d'attente reste souhaitable, mais elle traitait le SYMPTÔME. La
-- fonction est quadratique, et pour une raison qui se corrige.
--
-- ── Ce que faisait la boucle ───────────────────────────────────────────────
--
-- Pour CHAQUE cellule de Voronoï, un `CROSS JOIN LATERAL` cherchait le POI le
-- plus proche du centroïde :
--
--     WHERE categorie ILIKE cat_name ...
--     ORDER BY ST_Distance(ST_MakePoint(lng, lat), ST_Centroid(cellule))
--     LIMIT 1
--
-- Deux choses y interdisent tout index :
--   1. `ILIKE` ne peut pas se servir de `idx_poi_france_categorie` ;
--   2. `ST_MakePoint(lng, lat)` construit un point à la volée, donc l'index
--      GiST sur `geom` ne peut pas servir non plus.
--
-- Résultat : un **balayage parallèle complet de `poi_france` par cellule**.
--
-- ── Mesure d'UNE itération, la même dans les deux formes ───────────────────
--
-- | forme                                   | plan               | blocs  | temps   |
-- |-----------------------------------------|--------------------|-------:|--------:|
-- | `ILIKE` + `ST_Distance(ST_MakePoint())`  | Parallel Seq Scan  | 18 930 | 342,8 ms|
-- | `= ANY` + `geom <->`                     | Index Scan         | **25** | **0,33 ms** |
--
-- **757 fois moins de blocs, 1 039 fois plus rapide — par cellule.** Et la
-- fonction en fait une par point : 101 pour les cirfa, 5 584 pour les lycées.
-- À 18 930 blocs pièce, les lycées représentaient à eux seuls ~830 Go de
-- lecture pour un seul appel. Le `EXPLAIN ANALYZE` de la version d'origine
-- expire même sur les 101 cirfa.
--
-- ── Pourquoi le résultat est IDENTIQUE, et pas seulement « équivalent » ────
--
-- `geom <-> centroïde` remplace `ST_Distance(ST_MakePoint(lng, lat), centroïde)`
-- seulement si `geom` vaut exactement ce point. Vérifié avant d'écrire :
-- `geom` est renseignée sur les **290 877** lignes et **aucune** ne s'écarte de
-- ses `lat`/`lng` de plus de 1e-6. Le trigger `auto_set_geom` la maintient.
--
-- `ILIKE` devient `= ANY(tableau)` et non `=` tout court : si deux catégories
-- ne différaient que par la casse, un `=` n'en verrait qu'une. On collecte donc
-- les valeurs canoniques correspondantes UNE fois — un seul balayage au lieu
-- d'un par cellule — puis on compare par égalité, ce qui rend l'index utilisable.
--
-- ── TROIS correctifs, et le décisif n'est pas celui qu'on croit ────────────
--
-- 1. `ILIKE` par cellule -> valeurs canoniques résolues UNE fois, puis `= ANY`.
-- 2. `ST_Distance(ST_MakePoint(...))` -> `geom <->`, qui sait lire l'index.
-- 3. **`AS MATERIALIZED` sur la CTE des cellules découpées.** Depuis
--    PostgreSQL 12, une CTE est INLINÉE par défaut : `ST_Intersection` était
--    donc recalculée à CHAQUE référence à `vc.poly` — trois fois par cellule,
--    à 8,8 ms pièce contre une frontière de 45 781 sommets. Sans ce mot-clé,
--    les deux premiers correctifs ne suffisaient pas : la fonction expirait
--    encore sur 95 points.
--
-- Décomposition du pipeline sur les cirfa (95 cellules) :
--   collecte des points     31 ms
--   union de la frontière  268 ms
--   Voronoï                  3 ms
--   découpe, une passe     557 ms
--
-- Résultat mesuré, fonction complète :
--
--   | catégorie | cellules | avant        | après     |
--   |-----------|---------:|--------------|----------:|
--   | cirfa     |       95 | expire >30 s | **0,7 s** |
--   | bmw       |      175 | —            | **13,3 s**|
--   | lycee     |    4 653 | 80 à 108 s * | **31,1 s**|
--
--   * mesure de l'audit : 79 718 ms de moyenne, 108 555 ms au pire.
--
-- ── CE QUI RESTE LENT, et pourquoi la file d'attente garde son sens ────────
--
-- Le gain est de 43x sur une petite catégorie mais de **2,6x seulement** sur
-- les lycées. La différence dit où est passé le goulot : sur 4 653 cellules,
-- ce n'est plus la boucle mais la DÉCOUPE elle-même — 4 653 intersections
-- contre une frontière de 45 781 sommets, incompressibles à géométrie égale.
--
-- Le levier suivant serait de simplifier le polygone de découpe
-- (`ST_SimplifyPreserveTopology`). Il n'est PAS tiré ici : il change le tracé
-- des côtes rendu à l'écran, donc c'est un arbitrage produit, pas une
-- optimisation neutre. Tant qu'il n'est pas pris, la file d'attente que
-- demande le point 9 reste justifiée pour les grosses catégories : 31 s
-- d'occupation restent 31 s.
--
-- Le reste est inchangé au caractère près : accrochage à la grille, polygone de
-- découpe, filtres ville/région/département, bornes métropole, LIMIT 5000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_voronoi_by_category(
  cat_name            text,
  metropolitaine      boolean DEFAULT true,
  filtre_ville        text DEFAULT NULL::text,
  filtre_region       text DEFAULT NULL::text,
  filtre_departement  text DEFAULT NULL::text
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  pts_geom    GEOMETRY;
  n_points    INTEGER;
  clip_geom   GEOMETRY;
  has_filtre  BOOLEAN;
  cats        TEXT[];
BEGIN
  has_filtre := (filtre_ville IS NOT NULL OR filtre_region IS NOT NULL OR filtre_departement IS NOT NULL);

  -- 0. Resoudre UNE fois les valeurs canoniques de categorie.
  --    C'est ce qui remplace l'ILIKE par cellule : un balayage au lieu de N.
  SELECT array_agg(DISTINCT categorie) INTO cats
  FROM poi_france
  WHERE categorie ILIKE cat_name;

  IF cats IS NULL OR array_length(cats, 1) IS NULL THEN
    RAISE NOTICE '[voronoi] % : aucune categorie correspondante', cat_name;
    RETURN;
  END IF;

  -- 1. Collecter les points avec ST_SnapToGrid (stabilite zones denses)
  SELECT
    ST_Collect(
      ST_SnapToGrid(ST_SetSRID(ST_MakePoint(lng::FLOAT8, lat::FLOAT8), 4326), 0.0001)
    ),
    COUNT(*)
  INTO pts_geom, n_points
  FROM poi_france
  WHERE categorie = ANY(cats)
    AND lat BETWEEN -90  AND 90
    AND lng BETWEEN -180 AND 180
    AND (filtre_ville        IS NULL OR ville        ILIKE '%' || filtre_ville       || '%')
    AND (filtre_region       IS NULL OR region       ILIKE '%' || filtre_region      || '%')
    AND (filtre_departement  IS NULL OR departement  ILIKE '%' || filtre_departement || '%'
                                     OR code_departement = filtre_departement)
    AND (has_filtre OR NOT metropolitaine
         OR (lat BETWEEN 41.0 AND 52.0 AND lng BETWEEN -6.0 AND 10.0));

  IF pts_geom IS NULL OR n_points < 2 THEN
    RAISE NOTICE '[voronoi] % : % point(s)', cat_name, COALESCE(n_points, 0);
    RETURN;
  END IF;

  -- 2. Polygone de clipping
  IF metropolitaine THEN
    SELECT ST_Union(geom) INTO clip_geom FROM france_borders WHERE nom = 'france_metropolitaine';
    IF clip_geom IS NULL THEN
      clip_geom := ST_MakeEnvelope(-6.0, 41.0, 10.0, 52.0, 4326);
      RAISE NOTICE '[voronoi] WARN: france_borders vide, fallback bbox';
    END IF;
  ELSE
    clip_geom := ST_Expand(ST_Envelope(pts_geom), 0.5);
  END IF;

  -- 3. Voronoi -> ST_Dump -> ST_Intersection(clip) -> plus proche POI par cellule
  RETURN QUERY
  WITH
  voronoi_raw AS (
    SELECT (ST_Dump(
      ST_VoronoiPolygons(pts_geom, 0.0, clip_geom)
    )).geom AS raw_poly
  ),
  -- MATERIALIZED n'est pas decoratif : depuis PostgreSQL 12 une CTE est
  -- INLINEE par defaut, donc `ST_Intersection` etait recalculee a CHAQUE
  -- reference a `vc.poly` — trois fois par cellule (GeoJSON, centroide, test
  -- de vacuite), a 8,8 ms piece contre une frontiere de 45 781 sommets.
  -- C'est le correctif le plus rentable des trois.
  voronoi_clipped AS MATERIALIZED (
    SELECT ST_Intersection(raw_poly, clip_geom) AS poly
    FROM voronoi_raw
    WHERE
      ST_IsValid(raw_poly)
      -- Rejet bon marche par boite englobante AVANT l'intersection couteuse.
      AND raw_poly && clip_geom
  )
  SELECT json_build_object(
    'type',     'Feature',
    'geometry', ST_AsGeoJSON(vc.poly)::JSON,
    'properties', json_build_object(
      'id',        p.poi_id,
      'nom',       p.nom,
      'categorie', p.cat,
      'adresse',   p.adresse,
      'ville',     p.poi_ville,
      'lat',       p.poi_lat,
      'lng',       p.poi_lng
    )
  )
  FROM voronoi_clipped vc
  CROSS JOIN LATERAL (
    SELECT
      id::TEXT        AS poi_id,
      nom,
      categorie       AS cat,
      adresse,
      ville           AS poi_ville,
      lat::FLOAT8     AS poi_lat,
      lng::FLOAT8     AS poi_lng
    FROM poi_france
    WHERE categorie = ANY(cats)
      AND lat BETWEEN -90  AND 90
      AND lng BETWEEN -180 AND 180
      AND (filtre_ville       IS NULL OR ville       ILIKE '%' || filtre_ville      || '%')
      AND (filtre_region      IS NULL OR region      ILIKE '%' || filtre_region     || '%')
      AND (filtre_departement IS NULL OR departement ILIKE '%' || filtre_departement || '%'
                                      OR code_departement = filtre_departement)
      AND (has_filtre OR NOT metropolitaine
           OR (lat BETWEEN 41.0 AND 52.0 AND lng BETWEEN -6.0 AND 10.0))
    -- `geom <-> centroide` et non `ST_Distance(ST_MakePoint(lng, lat), ...)` :
    -- meme distance (verifie : 0 ecart sur 290 877 lignes), mais celle-ci sait
    -- se servir de l'index.
    ORDER BY geom <-> ST_Centroid(vc.poly)
    LIMIT 1
  ) p
  WHERE NOT ST_IsEmpty(vc.poly)
  LIMIT 5000;

  RAISE NOTICE '[voronoi] % -> % cellules', cat_name, n_points;
END;
$function$;

COMMENT ON FUNCTION public.get_voronoi_by_category(text, boolean, text, text, text) IS
  'Voronoi par categorie de POI (sql/164). La boucle LATERAL cherchait le POI le plus proche avec ILIKE + ST_Distance(ST_MakePoint(...)), deux formes qui interdisent tout index : un balayage complet de poi_france PAR CELLULE. Mesure d une iteration : 18 930 blocs et 342,8 ms avant, 25 blocs et 0,33 ms apres. Les valeurs canoniques de categorie sont resolues UNE fois, et la distance passe par geom (verifie identique a lat/lng sur les 290 877 lignes).';

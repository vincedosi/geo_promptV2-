-- =============================================================================
-- 137 — Tuiles MVT des IRIS, servies depuis Postgres (TER-001)
-- Appliqué le 2026-09-11 via MCP Supabase (apply_migration).
-- =============================================================================
--
-- ── Le défaut corrigé ───────────────────────────────────────────────────────
--
-- La carte chargeait `pmtiles:///iris_france.pmtiles`, 361 Mo posés dans
-- `public/`. Ce fichier est exclu par `.gitignore` ET par `.vercelignore` : il
-- n'est jamais parti en production, où l'URL répond la page 404 de Next —
-- vérifié octet par octet, on reçoit `<!DOCTYP` au lieu de `PMTiles\x03`.
-- L'autre chemin documenté, la GitHub Release `iris-pmtiles-latest`, existe
-- bien mais renvoie 404 en anonyme : le dépôt est privé.
--
-- La couche IRIS ne s'affichait donc que sur le poste du développeur. Aucune
-- erreur visible — MapLibre échoue en silence sur une source vide.
--
-- ── Trois décisions, chacune mesurée ────────────────────────────────────────
--
-- 1. PLANCHER À z9. Règle de lisibilité déjà retenue pour les carreaux : une
--    maille se lit entre 10 et 40 px. À 46° de latitude :
--
--      z5 : 31 149 IRIS par tuile, 1 694 kB — un IRIS d'1 km fait 0,6 px
--      z6 : 16 066 IRIS,             879 kB —                      1,2 px
--      z9 :                                                        9,4 px ← plancher
--      z10:    692 IRIS,              39 kB —                       19 px
--
--    Sous z9, on transportait jusqu'à 1,7 Mo pour un rendu où aucun IRIS n'est
--    distinguable. La RPC rend NULL, et la route répond 204.
--
-- 2. DEUX paliers de géométrie, pas trois. Les colonnes `geom_z7` et `geom_z10`
--    existent toutes deux, mais mesure faite : sur 984 183 points, `geom_z7` en
--    garde 73,2 % et `geom_z10` **98,8 %**. La seconde est une copie de
--    `geom_3857` à 1,2 % près — s'en servir ajouterait une branche pour rien.
--
-- 3. AUCUN filtre `is_true_iris` ici. `CLAUDE.md` demande ce filtre « pour
--    toute analyse statistique », et c'est juste — mais l'appliquer à
--    l'AFFICHAGE effacerait toute la France rurale : mesuré sur une tuile z10
--    centrée sur 2,29°E / 46,44°N, **50 IRIS présents, ZÉRO avec
--    `is_true_iris`**. Dans ces communes, l'IRIS est la commune entière.
--    La colonne est néanmoins ÉMISE, parce que la couche porte un filtre
--    optionnel qui s'en sert.
--
-- ── Colonnes : découvertes, jamais écrites ──────────────────────────────────
--
-- Les colonnes socio-démo d'`iris` sont DYNAMIQUES (`CLAUDE.md`). La liste est
-- lue dans `information_schema` à chaque appel. Elle doit être complète :
-- `applyIrisColor` colore par `['get', <colonne>]`, donc l'indicateur choisi
-- doit être PRÉSENT dans la tuile. C'est aussi ce qui permet la 3D sans second
-- appel réseau.
--
-- Mesures après création (Paris) : z9 231 kB / 83 ms · z10 154 kB · z12 43 kB ·
-- z13 19 kB.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_iris_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounds geometry := ST_TileEnvelope(z, x, y);
  v_geom   text;
  v_cols   text;
  v_sql    text;
  v_out    bytea;
BEGIN
  IF z IS NULL OR z < 9 THEN
    RETURN NULL;
  END IF;

  v_geom := CASE WHEN z <= 11 THEN 'geom_z7' ELSE 'geom_3857' END;

  -- Colonnes numeriques ET booleennes. Les booleennes ne sont pas un detail :
  -- `is_true_iris` porte le filtre « vrais IRIS uniquement » de la couche.
  -- Sans elle dans la tuile, ce filtre ne matcherait plus rien et la carte
  -- deviendrait vide des qu'on l'active.
  SELECT string_agg(format('i.%I', column_name), ', ' ORDER BY column_name)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name  = 'iris'
    AND data_type IN ('integer','bigint','numeric','double precision','real','smallint','boolean')
    AND column_name NOT IN ('centroid_lat','centroid_lng');

  IF v_cols IS NULL THEN
    RETURN NULL;
  END IF;

  -- `superficie_km2` : la MEME propriete que portent les carreaux (sql/122),
  -- pour que la couche IRIS reutilise telle quelle l'expression de hauteur 3D —
  -- un relief qui se lit pareil sur les deux couches.
  --
  -- Calculee, pas stockee : l'aire en 3857 est gonflee par la projection d'un
  -- facteur 1/cos²(latitude), que `centroid_lat` permet de corriger. Verifie sur
  -- six IRIS tires au hasard contre `ST_Area(geom::geography)` : ecart de 0,03 a
  -- 0,09 %. C'est de l'arithmetique sur des colonnes deja lues — lire `geom`
  -- rien que pour son aire couterait une colonne de plus par ligne.
  v_sql := format(
    'SELECT ST_AsMVT(t, ''iris'') FROM ('
    || ' SELECT ST_AsMVTGeom(i.%I, $1, 4096, 64, true) AS geom,'
    || ' i.code_iris, i.nom_iris, i.nom_commune,'
    || ' (ST_Area(i.geom_3857) / 1e6 * power(cos(radians(i.centroid_lat)), 2))::numeric AS superficie_km2,'
    || ' %s'
    || ' FROM public.iris i WHERE i.%I && $1 AND i.centroid_lat IS NOT NULL'
    || ') t',
    v_geom, v_cols, v_geom);

  EXECUTE v_sql INTO v_out USING v_bounds;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_iris_tile(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_iris_tile(integer, integer, integer) TO service_role;

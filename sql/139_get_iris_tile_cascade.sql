-- sql/139 — `get_iris_tile` devient une CASCADE, calquee sur `get_tile` (carreaux).
-- Applique le 2026-09-12 (MCP Supabase). Depend de sql/138.
--
-- Avant : plancher z9, NULL en dessous. Apres :
--
--   z4-z6   iris_agg_departement     104 mailles
--   z7-z8   iris_agg_commune      34 921 mailles
--   z >= 9  iris                  49 448 mailles   (geom_z7 sous z12, geom_3857 au-dessus)
--
-- Sous z4 on rend NULL — meme plancher que les carreaux.
--
-- POIDS MESURE (octets bruts, avant gzip), 2026-09-12 :
--   z4 France entiere  101 355      z7 Paris (le pire)  783 551
--   z5 France          115 463      z8 Paris            353 524
--   z6 Paris            97 432      z8 Bretagne         122 621
--                                   z9 Paris            827 012
--
-- La France ENTIERE tient donc dans une tuile de 100 kB. La plus lourde reste
-- la z9 parisienne, deja servie avant ce changement.
--
-- PLAN POSTGIS (EXPLAIN ANALYZE, palier commune, tuile 7/64/44) :
--   Bitmap Index Scan sur idx_iris_agg_commune_geom · 2 686 mailles
--   Execution Time 54,9 ms · Buffers shared hit=685, ZERO lecture disque.
--
-- Chaque feature porte `niveau` ('departement' | 'commune' | 'iris'). Deux
-- raisons, toutes deux vecues :
--   1. le filtre « vrais IRIS uniquement » porte sur `is_true_iris`, qui
--      n'existe QUE au palier IRIS. Sans `niveau`, le filtre ne matcherait
--      aucune feature agregee et viderait la carte des qu'on l'active ;
--   2. l'infobulle doit pouvoir dire ce qu'on regarde. Une valeur
--      departementale presentee comme un IRIS est un mensonge silencieux.
--
-- `superficie_km2` est emis aux TROIS paliers : c'est lui qui rend la cascade
-- lisible, le client normalisant les effectifs en densite/km2. Sans quoi un
-- departement (somme de ~475 IRIS) saturerait toute l'echelle.
--
-- `code_iris` est CONSERVE au palier IRIS : `app/map/page.tsx` filtre dessus
-- pour isoler un IRIS a la selection.
--
-- Note de cout : une premiere version emettait aussi `code`/`nom`/`nb_iris` au
-- palier IRIS, en doublon de `code_iris`/`nom_iris`. Mesure : +90 kB sur la
-- tuile 9/259/176 (788 489 -> 878 456). Une propriete emise sur 3 387 features
-- se paie, meme quand MVT mutualise les valeurs.

CREATE OR REPLACE FUNCTION public.get_iris_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bounds  geometry := ST_TileEnvelope(z, x, y);
  v_table   text;
  v_niveau  text;
  v_geom    text;
  v_cols    text;
  v_sql     text;
  v_out     bytea;
BEGIN
  IF z IS NULL OR z < 4 THEN
    RETURN NULL;
  END IF;

  IF z <= 6 THEN
    v_table := 'iris_agg_departement'; v_niveau := 'departement'; v_geom := 'geom_3857';
  ELSIF z <= 8 THEN
    v_table := 'iris_agg_commune';     v_niveau := 'commune';     v_geom := 'geom_3857';
  ELSE
    v_table := 'iris';                 v_niveau := 'iris';
    v_geom  := CASE WHEN z <= 11 THEN 'geom_z7' ELSE 'geom_3857' END;
  END IF;

  -- Colonnes numeriques ET booleennes, DECOUVERTES : les colonnes socio-demo
  -- d'`iris` sont dynamiques (CLAUDE.md) et les agregats en heritent.
  -- `superficie_km2` et `nb_iris` sont emis a part, jamais deux fois.
  SELECT string_agg(format('t.%I', column_name), ', ' ORDER BY column_name)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name  = v_table
    AND data_type IN ('integer','bigint','numeric','double precision','real','smallint','boolean')
    AND column_name NOT IN ('centroid_lat','centroid_lng','superficie_km2','nb_iris');

  IF v_cols IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_niveau = 'iris' THEN
    v_sql := format(
      'SELECT ST_AsMVT(q, ''iris'') FROM ('
      || ' SELECT ST_AsMVTGeom(t.%I, $1, 4096, 64, true) AS geom,'
      || ' %L::text AS niveau, t.code_iris, t.nom_iris, t.nom_commune,'
      || ' (ST_Area(t.geom_3857) / 1e6 * power(cos(radians(t.centroid_lat)), 2))::numeric AS superficie_km2,'
      || ' %s'
      || ' FROM public.%I t WHERE t.%I && $1 AND t.centroid_lat IS NOT NULL'
      || ') q',
      v_geom, v_niveau, v_cols, v_table, v_geom);
  ELSE
    v_sql := format(
      'SELECT ST_AsMVT(q, ''iris'') FROM ('
      || ' SELECT ST_AsMVTGeom(t.%I, $1, 4096, 64, true) AS geom,'
      || ' %L::text AS niveau, t.code, t.nom, t.nb_iris,'
      || ' t.superficie_km2::numeric AS superficie_km2,'
      || ' %s'
      || ' FROM public.%I t WHERE t.%I && $1'
      || ') q',
      v_geom, v_niveau, v_cols, v_table, v_geom);
  END IF;

  EXECUTE v_sql INTO v_out USING v_bounds;
  RETURN v_out;
END;
$function$;

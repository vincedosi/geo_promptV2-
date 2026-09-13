-- ============================================================================
-- sql/160_get_zone_centroids_depuis_geometrie.sql — la météo par code postal
-- ne rendait AUCUNE zone (2026-09-13)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `get_zone_centroids('cp')` lisait `ref_codes_postaux.centroid_lat` et
-- `centroid_lon`, filtrées `IS NOT NULL`. Ces deux colonnes sont NULL sur les
-- 6 187 lignes de la table — la colonne réellement peuplée est `centroid`
-- (geometry POINT 4326, index GIST), le même piège que celui corrigé pour
-- `/api/civic-indicators/health-map` par sql/144.
--
-- Mesuré avant ce correctif :
--     get_zone_centroids('region')       → 18 lignes
--     get_zone_centroids('departement')  → 104 lignes
--     get_zone_centroids('cp')           → 0 ligne
--
-- Conséquence : `/api/meteo-geo?scale=cp` répondait systématiquement
-- `500 No zones found for scale`. La granularité « Code postal » du
-- configurateur météo, annoncée « ~6 200 zones », n'a jamais pu fonctionner.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- Le palier CP lit `ST_Y(centroid)` / `ST_X(centroid)`. Les paliers région et
-- département gardent leurs colonnes (renseignées), avec le même repli sur la
-- géométrie pour ne pas retomber dans ce piège si un import futur les vide.
-- Le tout reste STABLE et sans écriture. Mesure : 6 187 lignes en 34 ms,
-- 1 505 blocs partagés — une lecture séquentielle de la table, acceptable pour
-- un appel par application de filtre (et mis en cache côté route).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_zone_centroids(p_scale text)
 RETURNS TABLE(code text, nom text, lat double precision, lon double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF p_scale = 'region' THEN
    RETURN QUERY
      SELECT r.code_region::text,
             r.nom_region::text,
             COALESCE(r.centroid_lat, ST_Y(ST_Centroid(r.geom)))::double precision,
             COALESCE(r.centroid_lon, ST_X(ST_Centroid(r.geom)))::double precision
      FROM ref_regions r
      WHERE (r.centroid_lat IS NOT NULL AND r.centroid_lon IS NOT NULL) OR r.geom IS NOT NULL;
  ELSIF p_scale = 'departement' THEN
    RETURN QUERY
      SELECT d.code_dept::text,
             d.nom_dept::text,
             COALESCE(d.centroid_lat, ST_Y(ST_Centroid(d.geom)))::double precision,
             COALESCE(d.centroid_lon, ST_X(ST_Centroid(d.geom)))::double precision
      FROM ref_departements d
      WHERE (d.centroid_lat IS NOT NULL AND d.centroid_lon IS NOT NULL) OR d.geom IS NOT NULL;
  ELSIF p_scale = 'cp' THEN
    -- `centroid_lat` / `centroid_lon` sont NULL sur toute la table : seule la
    -- géométrie `centroid` porte l'information (voir aussi sql/144).
    RETURN QUERY
      SELECT c.code_postal::text,
             c.nom_principal::text,
             COALESCE(c.centroid_lat, ST_Y(c.centroid))::double precision,
             COALESCE(c.centroid_lon, ST_X(c.centroid))::double precision
      FROM ref_codes_postaux c
      WHERE c.centroid IS NOT NULL OR (c.centroid_lat IS NOT NULL AND c.centroid_lon IS NOT NULL);
  ELSE
    RAISE EXCEPTION 'Invalid scale: %. Expected region, departement, or cp.', p_scale;
  END IF;
END;
$function$;

-- 078 — RPC functions updated for many-to-many radio model

-- 1. GeoJSON emitters with m2m radio info
CREATE OR REPLACE FUNCTION get_radio_emetteurs_geojson(
  p_bbox text DEFAULT NULL,
  p_systeme text DEFAULT NULL,
  p_radio_id uuid DEFAULT NULL,
  p_limit int DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
  )
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(e.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', e.id,
        'sta_nm_anfr', e.sta_nm_anfr,
        'nb_radios', COALESCE(rc.nb_radios, 0),
        'radio_principale', rc.radio_principale,
        'systeme', e.systeme,
        'frequence_mhz', CASE WHEN e.frequence_mhz IN (87.5, 108) THEN NULL ELSE e.frequence_mhz END,
        'puissance_w', e.puissance_w,
        'commune', e.commune,
        'departement', e.departement,
        'rayon_couverture_m', e.rayon_couverture_m
      )
    ) AS feature
    FROM emetteurs_radio e
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as nb_radios,
             MIN(r.nom) as radio_principale
      FROM emetteur_radio_stations ers
      JOIN radios r ON r.id = ers.radio_id
      WHERE ers.emetteur_id = e.id
    ) rc ON true
    WHERE e.geom IS NOT NULL
    AND (p_systeme IS NULL OR e.systeme = p_systeme)
    AND (p_radio_id IS NULL OR e.id IN (
      SELECT ers.emetteur_id FROM emetteur_radio_stations ers WHERE ers.radio_id = p_radio_id
    ))
    AND (p_bbox IS NULL OR ST_Intersects(
      e.geom,
      ST_MakeEnvelope(
        split_part(p_bbox, ',', 1)::float,
        split_part(p_bbox, ',', 2)::float,
        split_part(p_bbox, ',', 3)::float,
        split_part(p_bbox, ',', 4)::float,
        4326
      )
    ))
    LIMIT p_limit
  ) f;

  RETURN result;
END;
$$;

-- 2. Count emitters per radio via junction table
CREATE OR REPLACE FUNCTION count_emetteurs_par_radio()
RETURNS TABLE(radio_id uuid, nb bigint)
LANGUAGE sql STABLE AS $$
  SELECT radio_id, COUNT(DISTINCT emetteur_id) as nb
  FROM emetteur_radio_stations
  GROUP BY radio_id;
$$;

-- 3. Updated stats RPC
CREATE OR REPLACE FUNCTION get_radio_stats() RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_emetteurs', (SELECT COUNT(*) FROM emetteurs_radio),
    'emetteurs_fm', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'FM'),
    'emetteurs_dab', (SELECT COUNT(*) FROM emetteurs_radio WHERE systeme = 'DAB+'),
    'total_radios', (SELECT COUNT(*) FROM radios),
    'total_relations', (SELECT COUNT(*) FROM emetteur_radio_stations),
    'emetteurs_matches', (SELECT COUNT(DISTINCT emetteur_id) FROM emetteur_radio_stations),
    'emetteurs_orphelins', (
      SELECT COUNT(*) FROM emetteurs_radio e
      WHERE NOT EXISTS (SELECT 1 FROM emetteur_radio_stations ers WHERE ers.emetteur_id = e.id)
    ),
    'pct_matching', (
      SELECT ROUND(
        (SELECT COUNT(DISTINCT emetteur_id) FROM emetteur_radio_stations)::NUMERIC
        / NULLIF((SELECT COUNT(*) FROM emetteurs_radio), 0) * 100, 1
      )
    ),
    'radios_matchees', (SELECT COUNT(DISTINCT radio_id) FROM emetteur_radio_stations),
    'par_categorie', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(categorie_arcom, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT categorie_arcom, COUNT(*) as cnt FROM radios GROUP BY categorie_arcom) sub
    ),
    'par_portee', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(portee, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT portee, COUNT(*) as cnt FROM radios GROUP BY portee) sub
    ),
    'par_genre', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(genre, 'inconnu'), cnt), '{}'::jsonb)
      FROM (SELECT genre, COUNT(*) as cnt FROM radios GROUP BY genre) sub
    ),
    'derniere_maj_anfr', (SELECT MAX(snapshot_date) FROM emetteurs_radio),
    'archives_count', (SELECT COUNT(*) FROM emetteurs_radio_archive)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Get radios for a single emitter (for detail popup/page)
CREATE OR REPLACE FUNCTION get_radios_for_emetteur(p_emetteur_id uuid)
RETURNS TABLE(
  radio_id uuid,
  nom text,
  categorie_arcom text,
  portee text,
  genre text,
  groupe_media text,
  source text
)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.nom, r.categorie_arcom, r.portee, r.genre, r.groupe_media, ers.source
  FROM emetteur_radio_stations ers
  JOIN radios r ON r.id = ers.radio_id
  WHERE ers.emetteur_id = p_emetteur_id
  ORDER BY r.nom;
$$;

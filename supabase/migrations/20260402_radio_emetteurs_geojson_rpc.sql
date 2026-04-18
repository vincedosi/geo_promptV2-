-- RPC to return radio emitters as GeoJSON FeatureCollection
-- Uses ST_AsGeoJSON for proper geometry + LEFT JOIN radios for names
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
        'radio_id', e.radio_id,
        'radio_nom', r.nom,
        'categorie_arcom', r.categorie_arcom,
        'portee', r.portee,
        'genre', r.genre,
        'groupe_media', r.groupe_media,
        'systeme', e.systeme,
        'frequence_mhz', CASE WHEN e.frequence_mhz IN (87.5, 108) THEN NULL ELSE e.frequence_mhz END,
        'puissance_w', e.puissance_w,
        'commune', e.commune,
        'departement', e.departement,
        'rayon_couverture_m', e.rayon_couverture_m
      )
    ) AS feature
    FROM emetteurs_radio e
    LEFT JOIN radios r ON r.id = e.radio_id
    WHERE e.geom IS NOT NULL
    AND (p_systeme IS NULL OR e.systeme = p_systeme)
    AND (p_radio_id IS NULL OR e.radio_id = p_radio_id)
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

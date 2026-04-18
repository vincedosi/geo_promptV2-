-- 080 — Multi-radio filter + category exclusion for map
-- Updated get_radio_emetteurs_geojson with p_radio_ids[] and p_exclude_categories[]
-- New get_radio_filter_options for dropdown population

CREATE OR REPLACE FUNCTION get_radio_emetteurs_geojson(
  p_bbox text DEFAULT NULL,
  p_systeme text DEFAULT NULL,
  p_radio_id uuid DEFAULT NULL,
  p_limit int DEFAULT 10000,
  p_radio_ids uuid[] DEFAULT NULL,
  p_exclude_categories text[] DEFAULT NULL
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
      SELECT COUNT(*) as nb_radios, MIN(r.nom) as radio_principale
      FROM emetteur_radio_stations ers
      JOIN radios r ON r.id = ers.radio_id
      WHERE ers.emetteur_id = e.id
    ) rc ON true
    WHERE e.geom IS NOT NULL
    AND (p_systeme IS NULL OR e.systeme = p_systeme)
    AND (p_radio_id IS NULL OR e.id IN (
      SELECT ers.emetteur_id FROM emetteur_radio_stations ers WHERE ers.radio_id = p_radio_id
    ))
    AND (p_radio_ids IS NULL OR e.id IN (
      SELECT ers.emetteur_id FROM emetteur_radio_stations ers WHERE ers.radio_id = ANY(p_radio_ids)
    ))
    AND (p_exclude_categories IS NULL OR e.id IN (
      SELECT ers.emetteur_id FROM emetteur_radio_stations ers
      JOIN radios r ON r.id = ers.radio_id
      WHERE ers.emetteur_id = e.id AND r.categorie_arcom IS NOT NULL
      AND r.categorie_arcom != ALL(p_exclude_categories)
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

CREATE OR REPLACE FUNCTION get_radio_filter_options()
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'categories', (
      SELECT jsonb_agg(jsonb_build_object('value', cat, 'label', cat, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT categorie_arcom as cat, COUNT(*) as cnt FROM radios WHERE categorie_arcom IS NOT NULL GROUP BY categorie_arcom) sub
    ),
    'groupes', (
      SELECT jsonb_agg(jsonb_build_object('value', grp, 'label', grp, 'count', cnt) ORDER BY cnt DESC)
      FROM (SELECT groupe_media as grp, COUNT(*) as cnt FROM radios WHERE groupe_media IS NOT NULL AND groupe_media != '' GROUP BY groupe_media) sub
    ),
    'radios_with_emetteurs', (
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'nom', r.nom, 'cat', r.categorie_arcom, 'portee', r.portee, 'groupe', r.groupe_media) ORDER BY r.nom)
      FROM radios r
      WHERE EXISTS (SELECT 1 FROM emetteur_radio_stations ers WHERE ers.radio_id = r.id)
    )
  ) INTO result;
  RETURN result;
END;
$$;

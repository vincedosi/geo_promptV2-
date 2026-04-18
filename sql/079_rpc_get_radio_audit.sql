-- 079 — RPC for radio matching audit dashboard
-- Returns comprehensive audit data: KPIs, per-category breakdown,
-- unmatched radios with diagnostics, source distribution, history

CREATE OR REPLACE FUNCTION get_radio_audit()
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result jsonb;
  v_matchees bigint;
  v_non_matchees bigint;
  v_total bigint;
  v_relations bigint;
BEGIN
  SELECT COUNT(*) INTO v_total FROM radios;
  SELECT COUNT(DISTINCT radio_id) INTO v_matchees FROM emetteur_radio_stations;
  v_non_matchees := v_total - v_matchees;
  SELECT COUNT(*) INTO v_relations FROM emetteur_radio_stations;

  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'matchees', v_matchees,
      'non_matchees', v_non_matchees,
      'total', v_total,
      'pct', CASE WHEN v_total > 0 THEN ROUND(v_matchees::numeric / v_total * 100, 1) ELSE 0 END,
      'relations', v_relations
    ),
    'par_categorie', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.pct ASC), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(r.categorie_arcom, '?') as cat,
          COUNT(DISTINCT r.id) as total,
          COUNT(DISTINCT CASE WHEN ers.id IS NOT NULL THEN r.id END) as matchees,
          COUNT(DISTINCT r.id) - COUNT(DISTINCT CASE WHEN ers.id IS NOT NULL THEN r.id END) as non_matchees,
          ROUND(COUNT(DISTINCT CASE WHEN ers.id IS NOT NULL THEN r.id END)::numeric / NULLIF(COUNT(DISTINCT r.id), 0) * 100, 1) as pct
        FROM radios r
        LEFT JOIN emetteur_radio_stations ers ON ers.radio_id = r.id
        GROUP BY r.categorie_arcom
      ) sub
    ),
    'non_matchees', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.nb_freq_ods DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          r.id,
          r.nom,
          COALESCE(r.categorie_arcom, '?') as cat,
          r.portee,
          jsonb_array_length(COALESCE(r.metadata->'frequences_fm', '[]'::jsonb)) as nb_freq_ods,
          p.nom as parent_nom,
          CASE
            WHEN r.parent_radio_id IS NOT NULL THEN 'Parent detecte: ' || COALESCE(p.nom, '?')
            WHEN r.categorie_arcom = 'C' THEN 'Declinaison locale, parent non detecte'
            WHEN jsonb_array_length(COALESCE(r.metadata->'frequences_fm', '[]'::jsonb)) > 0 THEN 'Absente des sources crawlees'
            ELSE 'Aucune frequence FM connue'
          END as diagnostic
        FROM radios r
        LEFT JOIN radios p ON p.id = r.parent_radio_id
        WHERE NOT EXISTS (
          SELECT 1 FROM emetteur_radio_stations ers WHERE ers.radio_id = r.id
        )
      ) sub
    ),
    'sources', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb)
      FROM (
        SELECT source, COUNT(*) as relations, COUNT(DISTINCT radio_id) as radios
        FROM emetteur_radio_stations GROUP BY source
      ) sub
    ),
    'historique', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.started_at DESC), '[]'::jsonb)
      FROM (
        SELECT id, started_at, completed_at,
          EXTRACT(EPOCH FROM (completed_at - started_at))::int as duration_s,
          stats,
          status
        FROM radio_imports_log
        WHERE type = 'arcom'
        ORDER BY started_at DESC
        LIMIT 3
      ) sub
    )
  ) INTO result;

  RETURN result;
END;
$$;

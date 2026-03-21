-- ============================================================
-- 059 — Smart Prompt : feedback logging + ranking villes
-- ============================================================

-- ------------------------------------------------------------
-- Table : log de toutes les questions Smart Prompt
-- Pour analyser les questions non répondues et améliorer le routeur
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smart_prompt_feedback (
  id           bigserial    PRIMARY KEY,
  message      text         NOT NULL,
  agent        text,                         -- agent routé ('unknown', 'demographie', etc.)
  confidence   float4,                       -- confiance du routeur 0-1
  success      boolean,
  error_msg    text,
  params       jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE smart_prompt_feedback DISABLE ROW LEVEL SECURITY;
GRANT INSERT, SELECT ON smart_prompt_feedback TO service_role;
GRANT USAGE, SELECT ON SEQUENCE smart_prompt_feedback_id_seq TO service_role;

-- Index pour analyses
CREATE INDEX IF NOT EXISTS idx_spf_agent      ON smart_prompt_feedback(agent);
CREATE INDEX IF NOT EXISTS idx_spf_success    ON smart_prompt_feedback(success);
CREATE INDEX IF NOT EXISTS idx_spf_created_at ON smart_prompt_feedback(created_at DESC);

-- ------------------------------------------------------------
-- RPC : log une entrée de feedback Smart Prompt
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_smart_prompt_feedback(
  p_message    text,
  p_agent      text    DEFAULT 'unknown',
  p_confidence float4  DEFAULT 0,
  p_success    boolean DEFAULT false,
  p_error_msg  text    DEFAULT NULL,
  p_params     jsonb   DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO smart_prompt_feedback(message, agent, confidence, success, error_msg, params)
  VALUES (p_message, p_agent, p_confidence, p_success, p_error_msg, p_params)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_smart_prompt_feedback(text,text,float4,boolean,text,jsonb) TO service_role;

-- ------------------------------------------------------------
-- RPC : top N villes par indicateur démographique
-- Utilise les centroïdes des grandes villes (poi_france) + carreaux Filosofi
-- ------------------------------------------------------------
-- v3 : bbox réelle des POIs par ville + buffer → chiffres exacts (pas de rayon fixe biaisé)
-- Paris: bbox POIs 2.255-2.457 + buffer 3km → capture les 4316 carreaux réels ≈ 236k jeunes
CREATE OR REPLACE FUNCTION smart_demographie_top_villes(
  p_indicateur text    DEFAULT 'ind_18_24',
  p_rayon_km   float8  DEFAULT 3,
  p_limit      int     DEFAULT 10
)
RETURNS TABLE(
  rang   int,
  ville  text,
  total  float8,
  lat    float8,
  lng    float8
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_buf float8 := p_rayon_km / 111.0;
BEGIN
  RETURN QUERY
  WITH villes AS (
    -- Top 300 villes par nb de POIs; bbox réelle de la ville via MIN/MAX coords + buffer
    SELECT
      p.ville,
      AVG(p.lat)::float8  AS lat,
      AVG(p.lng)::float8  AS lng,
      MIN(p.lng) - v_buf  AS xmin,
      MAX(p.lng) + v_buf  AS xmax,
      MIN(p.lat) - v_buf  AS ymin,
      MAX(p.lat) + v_buf  AS ymax
    FROM poi_france p
    WHERE p.ville IS NOT NULL
      AND p.lat IS NOT NULL
      AND p.lng IS NOT NULL
    GROUP BY p.ville
    HAVING COUNT(*) >= 10
    ORDER BY COUNT(*) DESC
    LIMIT 300
  ),
  stats AS (
    SELECT
      v.ville, v.lat, v.lng,
      SUM((c.metadata->>p_indicateur)::float) AS total
    FROM villes v
    JOIN LATERAL (
      SELECT c2.metadata
      FROM carreaux_filosofi c2
      WHERE c2.geom && ST_MakeEnvelope(v.xmin, v.ymin, v.xmax, v.ymax, 4326)
        AND (c2.metadata->>p_indicateur)::float > 0
    ) c ON true
    GROUP BY v.ville, v.lat, v.lng
    HAVING SUM((c.metadata->>p_indicateur)::float) > 0
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s.total DESC)::int AS rang,
    s.ville,
    ROUND(s.total::numeric, 0)::float8             AS total,
    s.lat,
    s.lng
  FROM stats s
  ORDER BY s.total DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION smart_demographie_top_villes(text, float8, int) TO service_role;
